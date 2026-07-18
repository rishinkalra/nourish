export class DatabaseConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = "DatabaseConfigurationError";
    this.code = "DATABASE_CONFIGURATION_ERROR";
  }
}

export async function createPostgresPool({
  connectionString,
  maximumConnections = 10,
  requireTLS = false,
  applicationName = "project-nourish-api",
} = {}) {
  if (!connectionString) throw new DatabaseConfigurationError("DATABASE_URL is required for PostgreSQL mode.");
  let Pool;
  try {
    ({ Pool } = await import("pg"));
  } catch (error) {
    throw new DatabaseConfigurationError(`Install backend dependencies before enabling PostgreSQL mode: ${error.message}`);
  }
  const pool = new Pool({
    connectionString,
    max: maximumConnections,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: applicationName,
    ssl: requireTLS ? { rejectUnauthorized: true } : undefined,
  });
  pool.on("error", (error) => {
    process.stderr.write(`PostgreSQL idle client error: ${error.message}\n`);
  });
  return pool;
}

export async function withTransaction(pool, operation) {
  if (!pool?.connect) throw new DatabaseConfigurationError("A PostgreSQL connection pool is required.");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Preserve the operation error; the pool will surface connection failure separately.
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function checkDatabase(pool) {
  const result = await pool.query("SELECT now() AS database_time");
  return { status: "ok", databaseTime: new Date(result.rows[0].database_time) };
}
