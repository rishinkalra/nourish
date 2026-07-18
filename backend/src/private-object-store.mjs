import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, normalize, resolve } from "node:path";
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";

const ENCRYPTED_OBJECT_FORMAT = "nourish-a256gcm-v1";
const ENCRYPTED_OBJECT_CONTENT_TYPE = "application/vnd.project-nourish.encrypted+json";

export class FilePrivateObjectStore {
  constructor({ rootDirectory }) {
    if (!rootDirectory) throw new Error("A private object root is required.");
    this.rootDirectory = resolve(rootDirectory);
  }

  async putJSON({ key, value }) {
    return this.putText({ key, value: `${JSON.stringify(value, null, 2)}\n` });
  }

  async putText({ key, value }) {
    if (typeof value !== "string") throw new Error("Private object text must be a string.");
    const { normalized, destination } = this.#path(key, "key");
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    const temporary = `${destination}.${randomUUID()}.tmp`;
    await writeFile(temporary, value, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await rename(temporary, destination);
    return { key: normalized };
  }

  async getText(key) {
    const { destination } = this.#path(key, "key");
    return readFile(destination, "utf8");
  }

  async deleteObject(key) {
    const { destination } = this.#path(key, "key");
    await rm(destination, { force: true });
  }

  async deletePrefix(prefix) {
    const { destination } = this.#path(prefix, "prefix");
    await rm(destination, { recursive: true, force: true });
  }

  #path(value, label) {
    const key = normalizePrivateObjectKey(value, { label, allowTrailingSlash: label === "prefix" });
    const normalized = normalize(key).replace(/^[/\\]+/, "");
    const destination = resolve(join(this.rootDirectory, normalized));
    if (!destination.startsWith(`${this.rootDirectory}/`) || normalized.includes("..")) {
      throw new Error(`The private object ${label} is invalid.`);
    }
    return { normalized, destination };
  }
}

export class S3PrivateObjectStore {
  constructor({ client, bucket, prefix = "", serverSideEncryption, kmsKeyID, commands } = {}) {
    if (!client?.send) throw new Error("An S3 client is required.");
    if (!bucket) throw new Error("An S3 bucket is required.");
    if (!commands?.PutObjectCommand || !commands?.GetObjectCommand || !commands?.DeleteObjectCommand
        || !commands?.ListObjectsV2Command || !commands?.DeleteObjectsCommand) {
      throw new Error("S3 command constructors are required.");
    }
    this.client = client;
    this.bucket = bucket;
    this.prefix = prefix ? `${normalizePrivateObjectKey(prefix, { label: "storage prefix" })}/` : "";
    this.serverSideEncryption = serverSideEncryption;
    this.kmsKeyID = kmsKeyID;
    this.commands = commands;
  }

  async putJSON({ key, value }) {
    return this.putText({ key, value: `${JSON.stringify(value, null, 2)}\n` });
  }

  async putText({ key, value, contentType: requestedContentType }) {
    if (typeof value !== "string") throw new Error("Private object text must be a string.");
    const normalized = normalizePrivateObjectKey(key);
    const input = {
      Bucket: this.bucket,
      Key: this.#scoped(normalized),
      Body: value,
      ContentType: requestedContentType ?? contentType(normalized),
      CacheControl: "no-store",
    };
    if (this.serverSideEncryption) input.ServerSideEncryption = this.serverSideEncryption;
    if (this.serverSideEncryption === "aws:kms") input.SSEKMSKeyId = this.kmsKeyID;
    await this.client.send(new this.commands.PutObjectCommand(input));
    return { key: normalized };
  }

  async getText(key) {
    const normalized = normalizePrivateObjectKey(key);
    const result = await this.client.send(new this.commands.GetObjectCommand({
      Bucket: this.bucket, Key: this.#scoped(normalized),
    }));
    return bodyText(result?.Body);
  }

  async deleteObject(key) {
    const normalized = normalizePrivateObjectKey(key);
    await this.client.send(new this.commands.DeleteObjectCommand({
      Bucket: this.bucket, Key: this.#scoped(normalized),
    }));
  }

  async deletePrefix(prefix) {
    const normalized = normalizePrivateObjectKey(prefix, { label: "prefix", allowTrailingSlash: true });
    if (!normalized.endsWith("/")) throw new Error("A private object prefix must end with a slash.");
    const scopedPrefix = this.#scoped(normalized);
    let continuationToken;
    do {
      const listed = await this.client.send(new this.commands.ListObjectsV2Command({
        Bucket: this.bucket, Prefix: scopedPrefix, ContinuationToken: continuationToken, MaxKeys: 1_000,
      }));
      const objects = (listed?.Contents ?? [])
        .map((item) => item?.Key)
        .filter((key) => typeof key === "string" && key.startsWith(scopedPrefix))
        .map((Key) => ({ Key }));
      if (objects.length) {
        const deleted = await this.client.send(new this.commands.DeleteObjectsCommand({
          Bucket: this.bucket, Delete: { Objects: objects, Quiet: true },
        }));
        if (deleted?.Errors?.length) throw new Error("S3 reported a private object deletion failure.");
      }
      continuationToken = listed?.IsTruncated ? listed.NextContinuationToken : undefined;
      if (listed?.IsTruncated && !continuationToken) throw new Error("S3 prefix listing did not provide a continuation token.");
    } while (continuationToken);
  }

  #scoped(key) { return `${this.prefix}${key}`; }
}

export class EncryptedPrivateObjectStore {
  constructor({ store, activeKeyID, keys } = {}) {
    if (!store?.putText || !store?.getText || !store?.deleteObject || !store?.deletePrefix) {
      throw new Error("A private object store is required for application encryption.");
    }
    if (!validKeyID(activeKeyID)) throw new Error("A valid active private object encryption key ID is required.");
    const entries = Object.entries(keys ?? {});
    if (!entries.length || !entries.some(([keyID]) => keyID === activeKeyID)) {
      throw new Error("The active private object encryption key is unavailable.");
    }
    for (const [keyID, key] of entries) {
      if (!validKeyID(keyID) || !Buffer.isBuffer(key) || key.length !== 32) {
        throw new Error("Every private object encryption key must be a named 256-bit key.");
      }
    }
    this.store = store;
    this.activeKeyID = activeKeyID;
    this.keys = Object.freeze(Object.fromEntries(entries.map(([keyID, key]) => [keyID, Buffer.from(key)])));
  }

  async putJSON({ key, value }) {
    return this.putText({ key, value: `${JSON.stringify(value, null, 2)}\n` });
  }

  async putText({ key, value }) {
    if (typeof value !== "string") throw new Error("Private object text must be a string.");
    const normalized = normalizePrivateObjectKey(key);
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.keys[this.activeKeyID], iv);
    cipher.setAAD(encryptionAAD(normalized));
    const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    const envelope = `${JSON.stringify({
      format: ENCRYPTED_OBJECT_FORMAT,
      keyID: this.activeKeyID,
      iv: iv.toString("base64"),
      ciphertext: ciphertext.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
    })}\n`;
    await this.store.putText({ key: normalized, value: envelope, contentType: ENCRYPTED_OBJECT_CONTENT_TYPE });
    return { key: normalized };
  }

  async getText(key) {
    const normalized = normalizePrivateObjectKey(key);
    try {
      const envelope = JSON.parse(await this.store.getText(normalized));
      if (!envelope || envelope.format !== ENCRYPTED_OBJECT_FORMAT || !validKeyID(envelope.keyID)
          || typeof envelope.iv !== "string" || typeof envelope.ciphertext !== "string"
          || typeof envelope.tag !== "string") throw new Error("invalid envelope");
      const encryptionKey = this.keys[envelope.keyID];
      if (!encryptionKey) throw new Error("unknown encryption key");
      const iv = strictBase64(envelope.iv, 12);
      const tag = strictBase64(envelope.tag, 16);
      const ciphertext = strictBase64(envelope.ciphertext);
      const decipher = createDecipheriv("aes-256-gcm", encryptionKey, iv);
      decipher.setAAD(encryptionAAD(normalized));
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    } catch {
      const error = new Error("The private object could not be authenticated or decrypted.");
      error.code = "TEMPORARY_FAILURE";
      throw error;
    }
  }

  async deleteObject(key) {
    return this.store.deleteObject(normalizePrivateObjectKey(key));
  }

  async deletePrefix(prefix) {
    return this.store.deletePrefix(normalizePrivateObjectKey(prefix, { label: "prefix", allowTrailingSlash: true }));
  }
}

export async function createPrivateObjectStore(configuration, { sdkLoader = () => import("@aws-sdk/client-s3") } = {}) {
  let store;
  if (configuration?.privateObjectStoreType === "filesystem") {
    store = new FilePrivateObjectStore({ rootDirectory: configuration.privateObjectRoot });
  }
  if (configuration?.privateObjectStoreType === "s3") {
    const sdk = await sdkLoader();
    const client = new sdk.S3Client({
      region: configuration.privateObjectRegion,
      endpoint: configuration.privateObjectEndpoint,
      forcePathStyle: configuration.privateObjectForcePathStyle,
    });
    store = new S3PrivateObjectStore({
      client,
      bucket: configuration.privateObjectBucket,
      prefix: configuration.privateObjectPrefix,
      serverSideEncryption: configuration.privateObjectSSE === "none" ? undefined : configuration.privateObjectSSE,
      kmsKeyID: configuration.privateObjectKMSKeyID,
      commands: sdk,
    });
  }
  store ??= new ConfigurationGatedPrivateObjectStore();
  if (configuration?.privateObjectEncryptionActiveKeyID) {
    return new EncryptedPrivateObjectStore({
      store,
      activeKeyID: configuration.privateObjectEncryptionActiveKeyID,
      keys: configuration.privateObjectEncryptionKeys,
    });
  }
  return store;
}

export class MemoryPrivateObjectStore {
  objects = new Map();

  async putJSON({ key, value }) {
    this.objects.set(key, structuredClone(value));
    return { key };
  }

  async putText({ key, value }) {
    this.objects.set(key, String(value));
    return { key };
  }

  async getText(key) {
    const value = this.objects.get(key);
    if (typeof value !== "string") throw new Error("The private text object is unavailable.");
    return value;
  }

  async deleteObject(key) {
    this.objects.delete(key);
  }

  async deletePrefix(prefix) {
    for (const key of this.objects.keys()) {
      if (key.startsWith(prefix)) this.objects.delete(key);
    }
  }
}

export class ConfigurationGatedPrivateObjectStore {
  async putText() { throw unavailable(); }
  async getText() { throw unavailable(); }
  async deleteObject() { throw unavailable(); }
  async deletePrefix() { throw unavailable(); }
}

export function normalizePrivateObjectKey(value, { label = "key", allowTrailingSlash = false } = {}) {
  const key = String(value ?? "");
  const segments = key.split("/");
  const trailing = allowTrailingSlash && segments.at(-1) === "";
  if (trailing) segments.pop();
  if (!segments.length || key.startsWith("/") || key.includes("\\")
      || segments.some((segment) => !segment || segment === "." || segment === "..")
      || (!allowTrailingSlash && key.endsWith("/"))) {
    throw new Error(`The private object ${label} is invalid.`);
  }
  return trailing ? `${segments.join("/")}/` : segments.join("/");
}

async function bodyText(body) {
  if (!body) throw new Error("The private text object is unavailable.");
  if (typeof body.transformToString === "function") return body.transformToString("utf-8");
  if (typeof body === "string") return body;
  if (body instanceof Uint8Array) return Buffer.from(body).toString("utf8");
  if (body[Symbol.asyncIterator]) {
    const chunks = [];
    for await (const chunk of body) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks).toString("utf8");
  }
  throw new Error("The private text object is unavailable.");
}

function contentType(key) {
  if (key.endsWith(".json")) return "application/json; charset=utf-8";
  if (key.endsWith(".csv")) return "text/csv; charset=utf-8";
  return "text/plain; charset=utf-8";
}

function encryptionAAD(key) {
  return Buffer.from(`project-nourish\0${ENCRYPTED_OBJECT_FORMAT}\0${key}`, "utf8");
}

function validKeyID(value) {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value);
}

function strictBase64(value, expectedLength) {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error("invalid base64");
  }
  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value || (expectedLength !== undefined && decoded.length !== expectedLength)) {
    throw new Error("invalid base64 length");
  }
  return decoded;
}

function unavailable() {
  const error = new Error("Private export storage is not configured.");
  error.code = "TEMPORARY_FAILURE";
  return error;
}
