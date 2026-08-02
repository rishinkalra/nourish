import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

test("the documented staging estimate matches the checked-in billable topology", async () => {
  const [spec, cost] = await Promise.all([
    readFile(resolve(root, ".do/app.staging.yaml"), "utf8"),
    readFile(resolve(root, "docs/DIGITALOCEAN_STAGING_COST.md"), "utf8"),
  ]);

  assert.equal((spec.match(/instance_size_slug: apps-s-1vcpu-1gb-fixed/g) ?? []).length, 0);
  assert.equal((spec.match(/instance_size_slug: apps-s-1vcpu-0\.5gb/g) ?? []).length, 3);
  assert.match(spec, /name: nourish-postgres[\s\S]*version: "16"/);
  assert.doesNotMatch(spec, /production: true|cluster_name:/);
  assert.match(cost, /USD 22\.00 per month/);
  assert.match(cost, /USD 30\/month staging envelope/);
  assert.match(cost, /USD 25/);
  assert.match(cost, /approved by Rishin on 2 August 2026/);
  assert.match(cost, /billing alert is notification-only; it is not a spending cap/);
  assert.match(cost, /must contain disposable test data only/);
});
