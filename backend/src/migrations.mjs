import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { withTransaction } from "./database.mjs";

const defaultDirectory = fileURLToPath(new URL("../migrations", import.meta.url));

export async function runMigrations(pool, { directory = defaultDirectory } = {}) {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    checksum_sha256 CHAR(64) NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  const manifest = await readMigrationManifest(directory);
  const applied = [];
  for (const { filename, source, checksum } of manifest) {
    const existing = await pool.query(
      "SELECT checksum_sha256 FROM schema_migrations WHERE version = $1",
      [filename],
    );
    if (existing.rows[0]) {
      if (existing.rows[0].checksum_sha256 !== checksum) {
        throw new Error(`Applied migration ${filename} no longer matches its recorded checksum.`);
      }
      continue;
    }
    await withTransaction(pool, async (client) => {
      await client.query(migrationBody(source));
      await client.query(
        "INSERT INTO schema_migrations (version, checksum_sha256) VALUES ($1, $2)",
        [filename, checksum],
      );
    });
    applied.push(filename);
  }
  return applied;
}

export async function checkMigrationState(pool, { directory = defaultDirectory } = {}) {
  const manifest = await readMigrationManifest(directory);
  const result = await pool.query("SELECT version, checksum_sha256 FROM schema_migrations ORDER BY version");
  const appliedByVersion = new Map(result.rows.map((row) => [row.version, row.checksum_sha256]));
  const missing = [];
  const mismatched = [];
  for (const migration of manifest) {
    const appliedChecksum = appliedByVersion.get(migration.filename);
    if (!appliedChecksum) missing.push(migration.filename);
    else if (appliedChecksum !== migration.checksum) mismatched.push(migration.filename);
  }
  if (missing.length || mismatched.length) {
    const details = [
      missing.length ? `missing ${missing.join(", ")}` : null,
      mismatched.length ? `checksum mismatch ${mismatched.join(", ")}` : null,
    ].filter(Boolean).join("; ");
    throw new Error(`Database schema is not current: ${details}.`);
  }
  return { status: "current", expectedMigrations: manifest.length, appliedMigrations: appliedByVersion.size };
}

export async function readMigrationManifest(directory = defaultDirectory) {
  const filenames = (await readdir(directory))
    .filter((name) => /^\d+_.+\.sql$/.test(name))
    .sort();
  return Promise.all(filenames.map(async (filename) => {
    const source = await readFile(`${directory}/${filename}`, "utf8");
    return { filename, source, checksum: createHash("sha256").update(source).digest("hex") };
  }));
}

export function migrationBody(source) {
  return source
    .replace(/^\s*BEGIN\s*;\s*/i, "")
    .replace(/\s*COMMIT\s*;\s*$/i, "")
    .trim();
}
