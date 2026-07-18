import assert from "node:assert/strict";
import test from "node:test";
import {
  ConfigurationGatedPrivateObjectStore,
  EncryptedPrivateObjectStore,
  MemoryPrivateObjectStore,
  S3PrivateObjectStore,
  createPrivateObjectStore,
} from "../src/private-object-store.mjs";

const commands = Object.fromEntries([
  "PutObjectCommand", "GetObjectCommand", "DeleteObjectCommand", "ListObjectsV2Command", "DeleteObjectsCommand",
].map((name) => [name, class {
  constructor(input) { this.input = input; this.kind = name; }
}]));

test("S3 private storage writes encrypted non-cacheable objects and reads text", async () => {
  const sent = [];
  const client = {
    async send(command) {
      sent.push(command);
      if (command.kind === "GetObjectCommand") {
        return { Body: { async transformToString() { return "private content"; } } };
      }
      return {};
    },
  };
  const store = new S3PrivateObjectStore({
    client, bucket: "private-bucket", prefix: "nourish/staging",
    serverSideEncryption: "aws:kms", kmsKeyID: "alias/nourish-exports", commands,
  });

  await store.putJSON({ key: "account-exports/subject/request.json", value: { safe: true } });
  assert.equal(await store.getText("account-exports/subject/request.json"), "private content");
  await store.deleteObject("account-exports/subject/request.json");

  assert.equal(sent[0].kind, "PutObjectCommand");
  assert.equal(sent[0].input.Key, "nourish/staging/account-exports/subject/request.json");
  assert.equal(sent[0].input.CacheControl, "no-store");
  assert.equal(sent[0].input.ContentType, "application/json; charset=utf-8");
  assert.equal(sent[0].input.ServerSideEncryption, "aws:kms");
  assert.equal(sent[0].input.SSEKMSKeyId, "alias/nourish-exports");
  assert.match(sent[0].input.Body, /"safe": true/);
  assert.equal(sent[2].input.Key, "nourish/staging/account-exports/subject/request.json");
});

test("S3 private storage deletes every page under an exact safe prefix", async () => {
  const sent = [];
  let listCount = 0;
  const client = {
    async send(command) {
      sent.push(command);
      if (command.kind === "ListObjectsV2Command") {
        listCount += 1;
        return listCount === 1
          ? {
            Contents: [{ Key: "tenant/account-exports/hash/one.json" }, { Key: "tenant/account-exports/hash/two.json" }],
            IsTruncated: true, NextContinuationToken: "page-two",
          }
          : { Contents: [{ Key: "tenant/account-exports/hash/three.json" }], IsTruncated: false };
      }
      return {};
    },
  };
  const store = new S3PrivateObjectStore({ client, bucket: "private", prefix: "tenant", commands });
  await store.deletePrefix("account-exports/hash/");

  const lists = sent.filter((command) => command.kind === "ListObjectsV2Command");
  const deletes = sent.filter((command) => command.kind === "DeleteObjectsCommand");
  assert.equal(lists.length, 2);
  assert.equal(lists[1].input.ContinuationToken, "page-two");
  assert.deepEqual(deletes.flatMap((command) => command.input.Delete.Objects.map((item) => item.Key)), [
    "tenant/account-exports/hash/one.json",
    "tenant/account-exports/hash/two.json",
    "tenant/account-exports/hash/three.json",
  ]);
});

test("S3 private storage rejects traversal and incomplete paginated deletion", async () => {
  let calls = 0;
  const store = new S3PrivateObjectStore({
    bucket: "private", commands,
    client: { async send() { calls += 1; return { IsTruncated: true }; } },
  });
  await assert.rejects(store.putText({ key: "../escape.txt", value: "no" }), /invalid/);
  assert.equal(calls, 0);
  await assert.rejects(store.deletePrefix("account-exports/hash/"), /continuation token/);
});

test("S3 private storage fails closed when the provider reports partial deletion", async () => {
  const store = new S3PrivateObjectStore({
    bucket: "private", commands,
    client: {
      async send(command) {
        if (command.kind === "ListObjectsV2Command") {
          return { Contents: [{ Key: "account-exports/hash/one.json" }], IsTruncated: false };
        }
        return { Errors: [{ Key: "account-exports/hash/one.json", Code: "AccessDenied" }] };
      },
    },
  });
  await assert.rejects(store.deletePrefix("account-exports/hash/"), /deletion failure/);
});

test("private object factory selects S3 without embedding static credentials", async () => {
  let clientConfiguration;
  class S3Client {
    constructor(configuration) { clientConfiguration = configuration; }
    async send() { return {}; }
  }
  const store = await createPrivateObjectStore({
    privateObjectStoreType: "s3",
    privateObjectBucket: "private",
    privateObjectRegion: "auto",
    privateObjectEndpoint: "https://objects.example.test",
    privateObjectForcePathStyle: true,
    privateObjectPrefix: "nourish/staging",
    privateObjectSSE: "AES256",
  }, { sdkLoader: async () => ({ S3Client, ...commands }) });
  assert.ok(store instanceof S3PrivateObjectStore);
  assert.deepEqual(clientConfiguration, {
    region: "auto", endpoint: "https://objects.example.test", forcePathStyle: true,
  });
  assert.equal("credentials" in clientConfiguration, false);
});

test("provider-neutral application encryption round-trips text without storing plaintext", async () => {
  const backingStore = new MemoryPrivateObjectStore();
  const store = new EncryptedPrivateObjectStore({
    store: backingStore,
    activeKeyID: "staging-2026-07",
    keys: {
      "staging-2026-06": Buffer.alloc(32, 6),
      "staging-2026-07": Buffer.alloc(32, 7),
    },
  });
  const key = "account-exports/subject/request.json";
  await store.putText({ key, value: "private content" });
  const encrypted = backingStore.objects.get(key);
  assert.doesNotMatch(encrypted, /private content/);
  assert.equal(JSON.parse(encrypted).format, "nourish-a256gcm-v1");
  assert.equal(JSON.parse(encrypted).keyID, "staging-2026-07");
  assert.equal(await store.getText(key), "private content");
});

test("application encryption detects ciphertext tampering and object-key substitution", async () => {
  const backingStore = new MemoryPrivateObjectStore();
  const store = new EncryptedPrivateObjectStore({
    store: backingStore,
    activeKeyID: "active",
    keys: { active: Buffer.alloc(32, 9) },
  });
  await store.putText({ key: "exports/one.txt", value: "one" });
  backingStore.objects.set("exports/two.txt", backingStore.objects.get("exports/one.txt"));
  await assert.rejects(store.getText("exports/two.txt"), (error) => error.code === "TEMPORARY_FAILURE");

  const envelope = JSON.parse(backingStore.objects.get("exports/one.txt"));
  envelope.ciphertext = `${envelope.ciphertext.slice(0, -4)}AAAA`;
  backingStore.objects.set("exports/one.txt", JSON.stringify(envelope));
  await assert.rejects(store.getText("exports/one.txt"), /authenticated or decrypted/);
});

test("application encryption reads objects written with a retained rotation key", async () => {
  const backingStore = new MemoryPrivateObjectStore();
  const oldStore = new EncryptedPrivateObjectStore({
    store: backingStore, activeKeyID: "old", keys: { old: Buffer.alloc(32, 1) },
  });
  await oldStore.putText({ key: "exports/rotation.txt", value: "before rotation" });
  const rotatedStore = new EncryptedPrivateObjectStore({
    store: backingStore,
    activeKeyID: "new",
    keys: { old: Buffer.alloc(32, 1), new: Buffer.alloc(32, 2) },
  });
  assert.equal(await rotatedStore.getText("exports/rotation.txt"), "before rotation");
  await rotatedStore.putText({ key: "exports/new.txt", value: "after rotation" });
  assert.equal(JSON.parse(backingStore.objects.get("exports/new.txt")).keyID, "new");
});

test("S3 storage can omit provider SSE when application encryption is selected", async () => {
  const sent = [];
  const store = new S3PrivateObjectStore({
    client: { async send(command) { sent.push(command); return {}; } },
    bucket: "private", commands,
  });
  await store.putText({ key: "exports/encrypted.json", value: "ciphertext", contentType: "application/encrypted" });
  assert.equal("ServerSideEncryption" in sent[0].input, false);
  assert.equal(sent[0].input.ContentType, "application/encrypted");
});

test("private object factory composes S3-compatible storage with application encryption", async () => {
  const sent = [];
  class S3Client { async send(command) { sent.push(command); return {}; } }
  const store = await createPrivateObjectStore({
    privateObjectStoreType: "s3",
    privateObjectBucket: "private",
    privateObjectRegion: "blr1",
    privateObjectEndpoint: "https://blr1.digitaloceanspaces.com",
    privateObjectSSE: "none",
    privateObjectEncryptionActiveKeyID: "active",
    privateObjectEncryptionKeys: { active: Buffer.alloc(32, 4) },
  }, { sdkLoader: async () => ({ S3Client, ...commands }) });
  assert.ok(store instanceof EncryptedPrivateObjectStore);
  await store.putText({ key: "exports/one.csv", value: "secret,data\n" });
  assert.equal(sent[0].input.ServerSideEncryption, undefined);
  assert.equal(sent[0].input.ContentType, "application/vnd.project-nourish.encrypted+json");
  assert.doesNotMatch(sent[0].input.Body, /secret,data/);
});

test("unconfigured private storage fails deletion closed", async () => {
  await assert.rejects(new ConfigurationGatedPrivateObjectStore().deletePrefix("account-exports/hash/"), /not configured/);
});
