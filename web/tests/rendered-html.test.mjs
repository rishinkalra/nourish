import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the FamilyChef staging preview shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>FamilyChef — Your week, well fed<\/title>/i);
  assert.match(html, /FamilyChef staging preview/i);
  assert.match(html, /\/preview\/index\.html/i);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/i);
});

test("ships the branded prototype and honest staging disclosure", async () => {
  const [preview, packageJson] = await Promise.all([
    readFile(new URL("public/preview/index.html", projectRoot), "utf8"),
    readFile(new URL("package.json", projectRoot), "utf8"),
  ]);

  assert.match(preview, /Staging preview/);
  assert.match(preview, /Sample meal data · not a signed-in account/);
  assert.match(preview, /FamilyChef/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
});
