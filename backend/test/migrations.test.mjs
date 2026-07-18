import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { checkMigrationState, readMigrationManifest } from "../src/migrations.mjs";

test("migration readiness requires every release migration with its exact checksum", async () => {
  const directory = await fixtureDirectory();
  try {
    const manifest = await readMigrationManifest(directory);
    const pool = {
      async query(sql) {
        assert.match(sql, /schema_migrations/);
        return { rows: manifest.map((migration) => ({
          version: migration.filename,
          checksum_sha256: migration.checksum,
        })) };
      },
    };
    assert.deepEqual(await checkMigrationState(pool, { directory }), {
      status: "current", expectedMigrations: 2, appliedMigrations: 2,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("migration readiness reports missing and modified release migrations", async () => {
  const directory = await fixtureDirectory();
  try {
    await assert.rejects(
      checkMigrationState({
        async query() {
          return { rows: [{ version: "001_first.sql", checksum_sha256: "0".repeat(64) }] };
        },
      }, { directory }),
      (error) => error.message.includes("missing 002_second.sql")
        && error.message.includes("checksum mismatch 001_first.sql"),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

async function fixtureDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "nourish-migrations-"));
  await writeFile(join(directory, "001_first.sql"), "CREATE TABLE first_table (id TEXT);\n");
  await writeFile(join(directory, "002_second.sql"), "CREATE TABLE second_table (id TEXT);\n");
  await writeFile(join(directory, "notes.txt"), "ignored\n");
  return directory;
}
