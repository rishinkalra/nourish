import assert from "node:assert/strict";
import test from "node:test";
import { connectionStringWithoutInlineTLS } from "../src/database.mjs";

test("explicit verified TLS removes connection-string settings that override the CA", () => {
  const normalized = new URL(connectionStringWithoutInlineTLS(
    "postgresql://user:secret@database.example:25060/app?sslmode=require&sslrootcert=system&application_name=familychef",
  ));

  assert.equal(normalized.searchParams.has("sslmode"), false);
  assert.equal(normalized.searchParams.has("sslrootcert"), false);
  assert.equal(normalized.searchParams.get("application_name"), "familychef");
  assert.equal(normalized.hostname, "database.example");
  assert.equal(normalized.password, "secret");
});
