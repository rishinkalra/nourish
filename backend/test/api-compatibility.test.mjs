import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);

test("the frozen v1 compatibility window remains represented by server and native client", async () => {
  const sourceDirectory = new URL("../src/", import.meta.url);
  const sourceFiles = (await readdir(sourceDirectory)).filter((name) => name.endsWith(".mjs"));
  const [baselineText, server, routeTelemetry, client] = await Promise.all([
    readFile(new URL("docs/api_v1_compatibility_baseline.json", root), "utf8"),
    readFile(new URL("backend/src/server.mjs", root), "utf8"),
    readFile(new URL("backend/src/observability.mjs", root), "utf8"),
    readFile(new URL("ios/Sources/NourishAPI/APIContract.swift", root), "utf8"),
  ]);
  const baseline = JSON.parse(baselineText);
  const backendSource = await Promise.all(sourceFiles.map((name) => readFile(new URL(name, sourceDirectory), "utf8")));
  const serverContract = `${server}\n${routeTelemetry}\n${backendSource.join("\n")}`;

  assert.equal(baseline.contractVersion, 1);
  assert.match(server, /x-nourish-api-version", "1"/);
  for (const fragment of baseline.consumerRouteFragments) {
    assert.ok(serverContract.includes(fragment), `server lost v1 route fragment ${fragment}`);
    assert.ok(client.includes(fragment), `native client lost v1 route fragment ${fragment}`);
  }
  for (const code of baseline.errorCodes) {
    assert.ok(serverContract.includes(code), `server lost structured error ${code}`);
    assert.ok(client.includes(code), `native client lost structured error ${code}`);
  }
  for (const field of baseline.errorFields) {
    assert.ok(serverContract.includes(field), `server lost error field ${field}`);
    assert.ok(client.includes(field), `native client lost error field ${field}`);
  }
});
