import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

test("production and staging use the approved FamilyChef hostname boundary", async () => {
  const [project, staging, example, method] = await Promise.all([
    readFile(resolve(root, "ios/NourishApp/NourishApp.xcodeproj/project.pbxproj"), "utf8"),
    readFile(resolve(root, ".do/app.staging.yaml"), "utf8"),
    readFile(resolve(root, "backend/.env.staging.example"), "utf8"),
    readFile(resolve(root, "docs/FAMILYCHEF_DOMAIN_CONFIGURATION.md"), "utf8"),
  ]);

  assert.match(project, /NOURISH_API_BASE_URL = "https:\/\/api\.familychef\.in";/);
  assert.doesNotMatch(project, /NOURISH_API_BASE_URL = "https:\/\/CHANGE_ME/);
  assert.match(project, /PRODUCT_BUNDLE_IDENTIFIER = com\.projectnourish\.app;/);

  assert.match(staging, /domain: api-staging\.familychef\.in/);
  assert.match(staging, /value: https:\/\/control-staging\.familychef\.in/);
  assert.match(staging, /value: "Nourish <sign-in@familychef\.in>"/);
  assert.match(example, /NOURISH_EMAIL_FROM=Nourish <sign-in@familychef\.in>/);
  assert.match(example, /NOURISH_ADMIN_ORIGIN=https:\/\/control-staging\.familychef\.in/);

  for (const hostname of [
    "www.familychef.in",
    "api.familychef.in",
    "control.familychef.in",
    "api-staging.familychef.in",
    "control-staging.familychef.in",
  ]) {
    assert.match(method, new RegExp(hostname.replaceAll(".", "\\.")));
  }
  assert.match(staging, /nourish:\/\/auth\/magic-link\?token=/);
});
