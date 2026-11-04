import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";

export interface PostgresConnection {
  readonly db: PostgresJsDatabase;
  close(): Promise<void>;
}

/**
 * Creates a pooled connection with the `postgres` driver. Nothing connects
 * until the first query, so this is safe to call during a build.
 *
 * Hosts that already have a Drizzle instance should skip this and pass their
 * own `db` to `PostgresFileStorage` instead.
 */
export function createPostgresConnection(url: string, options: { maxConnections?: number } = {}): PostgresConnection {
  const client = postgres(url, { max: options.maxConnections ?? 10, onnotice: () => {} });
  return { db: drizzle({ client }), close: () => client.end({ timeout: 5 }) };
}
