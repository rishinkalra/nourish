import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

test("FamilyChef is the customer-facing brand while stable technical identity is preserved", async () => {
  const [website, admin, info, project, appIcon, email, push] = await Promise.all([
    readFile(resolve(root, "index.html"), "utf8"),
    readFile(resolve(root, "admin/index.html"), "utf8"),
    readFile(resolve(root, "ios/NourishApp/NourishApp/Info.plist"), "utf8"),
    readFile(resolve(root, "ios/NourishApp/NourishApp.xcodeproj/project.pbxproj"), "utf8"),
    readFile(resolve(root, "ios/NourishApp/NourishApp/Assets.xcassets/AppIcon.appiconset/Contents.json"), "utf8"),
    readFile(resolve(root, "backend/src/email-delivery-service.mjs"), "utf8"),
    readFile(resolve(root, "backend/src/push-notification-service.mjs"), "utf8"),
  ]);

  assert.match(website, /<title>FamilyChef — Your week, well fed<\/title>/);
  assert.match(website, /familychef-app-icon\.png/);
  assert.doesNotMatch(website, />Nourish</);
  assert.match(admin, /<title>FamilyChef Control Room<\/title>/);

  assert.match(info, /<string>FamilyChef<\/string>/);
  assert.match(project, /INFOPLIST_KEY_CFBundleDisplayName = FamilyChef;/);
  assert.match(project, /ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon;/);
  assert.match(project, /PRODUCT_BUNDLE_IDENTIFIER = com\.projectnourish\.app;/);
  assert.match(info, /<string>nourish<\/string>/);

  assert.match(appIcon, /familychef-app-icon-1024\.png/);
  assert.match(email, /Your FamilyChef sign-in link/);
  assert.match(push, /Your FamilyChef plan is ready/);
});
