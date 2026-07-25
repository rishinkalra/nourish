import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);

async function json(path) {
  return JSON.parse(await readFile(new URL(path, root), "utf8"));
}

test("runtime dependencies are privacy-reviewed and tracking stays disabled", async () => {
  const [inventory, packageJSON] = await Promise.all([
    json("docs/privacy_inventory.json"),
    json("backend/package.json"),
  ]);

  assert.equal(inventory.tracking, false);
  assert.equal(inventory.advertisingDataSale, false);
  assert.deepEqual(
    Object.keys(packageJSON.dependencies).sort(),
    [...inventory.approvedRuntimePackages.node].sort(),
  );
  assert.deepEqual(inventory.approvedRuntimePackages.swiftRemotePackages, []);
  assert.ok(inventory.vendors.every((vendor) => vendor.status.length >= 20));
});

test("iOS privacy manifest is bundled and matches the recorded collection boundary", async () => {
  const [inventory, manifest, project] = await Promise.all([
    json("docs/privacy_inventory.json"),
    readFile(new URL("ios/NourishApp/NourishApp/PrivacyInfo.xcprivacy", root), "utf8"),
    readFile(new URL("ios/NourishApp/NourishApp.xcodeproj/project.pbxproj", root), "utf8"),
  ]);

  assert.match(manifest, /<key>NSPrivacyTracking<\/key>\s*<false\/>/);
  assert.match(manifest, /NSPrivacyAccessedAPICategoryUserDefaults/);
  assert.match(manifest, /<string>CA92\.1<\/string>/);
  for (const type of [
    "EmailAddress",
    "Health",
    "UserID",
    "PurchaseHistory",
    "ProductInteraction",
    "OtherUserContent",
  ]) {
    assert.match(manifest, new RegExp(`NSPrivacyCollectedDataType${type}`));
  }
  assert.equal(inventory.dataCategories.length, 6);
  assert.match(project, /PrivacyInfo\.xcprivacy in Resources/);
});
