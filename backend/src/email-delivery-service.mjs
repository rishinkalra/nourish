import { MemoryMagicLinkDelivery } from "./auth-service.mjs";

const POSTMARK_ENDPOINT = "https://api.postmarkapp.com/email";
const DEFAULT_MAGIC_LINK_PREFIX = "nourish://auth/magic-link?token=";

export class EmailDeliveryError extends Error {
  constructor(message = "Sign-in email delivery is temporarily unavailable.") {
    super(message);
    this.name = "EmailDeliveryError";
    this.code = "TEMPORARY_FAILURE";
    this.status = 503;
    this.retryable = true;
  }
}

export class PostmarkMagicLinkDelivery {
  constructor({
    serverToken,
    from,
    magicLinkPrefix = DEFAULT_MAGIC_LINK_PREFIX,
    fetchImplementation = globalThis.fetch,
    endpoint = POSTMARK_ENDPOINT,
    timeoutMilliseconds = 10_000,
  } = {}) {
    if (typeof serverToken !== "string" || serverToken.length < 20) {
      throw new Error("A Postmark server token is required.");
    }
    if (!validMailbox(from)) throw new Error("A valid magic-link sender address is required.");
    if (!validMagicLinkPrefix(magicLinkPrefix)) throw new Error("The magic-link URL prefix is invalid.");
    if (typeof fetchImplementation !== "function") throw new Error("A fetch implementation is required.");
    const endpointURL = new URL(endpoint);
    if (endpointURL.protocol !== "https:") throw new Error("The email provider endpoint must use HTTPS.");
    this.serverToken = serverToken;
    this.from = from;
    this.magicLinkPrefix = magicLinkPrefix;
    this.fetchImplementation = fetchImplementation;
    this.endpoint = endpointURL.toString();
    this.timeoutMilliseconds = timeoutMilliseconds;
  }

  async send({ email, token, requestID, expiresAt }) {
    if (!validMailbox(email) || !/^[A-Za-z0-9_-]{20,200}$/.test(String(token ?? ""))) {
      throw new EmailDeliveryError();
    }
    const link = `${this.magicLinkPrefix}${encodeURIComponent(token)}`;
    const expiry = new Date(expiresAt);
    const expiryText = Number.isNaN(expiry.getTime())
      ? "15 minutes"
      : expiry.toISOString();
    const payload = {
      From: this.from,
      To: email,
      Subject: "Your Nourish sign-in link",
      TextBody: [
        "Sign in to Nourish",
        "",
        `Open this secure link: ${link}`,
        "",
        `This one-time link expires at ${expiryText}.`,
        "If you did not request it, you can safely ignore this email.",
      ].join("\n"),
      HtmlBody: magicLinkHTML({ link, expiryText }),
      MessageStream: "outbound",
      Tag: "magic-link",
      TrackOpens: false,
      TrackLinks: "None",
      Metadata: { request_id: safeRequestID(requestID) },
    };
    try {
      const response = await this.fetchImplementation(this.endpoint, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "x-postmark-server-token": this.serverToken,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.timeoutMilliseconds),
      });
      if (!response.ok) throw new EmailDeliveryError();
      const result = await response.json();
      if (typeof result?.MessageID !== "string" || !result.MessageID) {
        throw new EmailDeliveryError();
      }
      return { provider: "postmark", providerMessageID: result.MessageID };
    } catch (error) {
      if (error instanceof EmailDeliveryError) throw error;
      throw new EmailDeliveryError();
    }
  }
}

export function createMagicLinkDelivery(configuration, options = {}) {
  if (!configuration?.production && !configuration?.emailProvider) {
    return new MemoryMagicLinkDelivery();
  }
  if (configuration?.emailProvider === "postmark") {
    return new PostmarkMagicLinkDelivery({
      serverToken: configuration.postmarkServerToken,
      from: configuration.emailFrom,
      magicLinkPrefix: configuration.magicLinkPrefix,
      ...options,
    });
  }
  throw new Error("The configured email provider is unsupported.");
}

function magicLinkHTML({ link, expiryText }) {
  const safeLink = escapeHTML(link);
  return `<!doctype html>
<html lang="en">
  <body style="margin:0;background:#f6f4ee;color:#24332b;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
    <div style="max-width:560px;margin:0 auto;padding:40px 24px">
      <p style="font-size:14px;font-weight:700;letter-spacing:.08em;text-transform:uppercase">Nourish</p>
      <h1 style="font-size:28px;line-height:1.2;margin:24px 0 12px">Sign in to your meal plan</h1>
      <p style="font-size:16px;line-height:1.6">Use this one-time link to continue securely.</p>
      <p style="margin:28px 0">
        <a href="${safeLink}" style="display:inline-block;background:#276749;color:#fff;text-decoration:none;padding:14px 22px;border-radius:12px;font-weight:700">Open Nourish</a>
      </p>
      <p style="font-size:14px;line-height:1.6;color:#52645a">This link expires at ${escapeHTML(expiryText)}. If you did not request it, you can safely ignore this email.</p>
    </div>
  </body>
</html>`;
}

function validMailbox(value) {
  if (typeof value !== "string" || value.length > 320) return false;
  const address = "[^<>\\s@]+@[^<>\\s@]+\\.[^<>\\s@]+";
  return new RegExp(`^(?:${address}|[^<>\\r\\n]{1,80}\\s+<${address}>)$`).test(value);
}

function validMagicLinkPrefix(value) {
  if (typeof value !== "string" || value.length > 500 || !value.endsWith("token=")) return false;
  try {
    const url = new URL(value);
    return ["nourish:", "https:"].includes(url.protocol);
  } catch {
    return false;
  }
}

function safeRequestID(value) {
  const normalized = String(value ?? "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80);
  return normalized || "unknown";
}

function escapeHTML(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
