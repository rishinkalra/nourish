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

  assert.equal((spec.match(/instance_size_slug: apps-s-1vcpu-1gb-fixed/g) ?? []).length, 1);
  assert.equal((spec.match(/instance_size_slug: apps-s-1vcpu-0\.5gb/g) ?? []).length, 2);
  assert.match(spec, /name: nourish-postgres[\s\S]*production: true/);
  assert.match(cost, /USD 35\.15 per month/);
  assert.match(cost, /USD 45\/month staging envelope/);
  assert.match(cost, /billing alert is notification-only; it is not a spending cap/);
  assert.match(cost, /No cloud resource may be created until the account owner explicitly approves/);
});

