import { defineConfig } from "drizzle-kit";

// Next.js loads .env files for the app; drizzle-kit runs outside Next, so load them here.
for (const file of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(file);
  } catch {
    // The file is optional.
  }
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/modules/file-upload/infrastructure/postgres/schema.ts",
  out: "./src/modules/file-upload/infrastructure/postgres/migrations",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
  // The module owns the `file_upload` schema and nothing else.
  schemaFilter: ["file_upload"],
  // A dedicated history table, so it never mixes with a host project's own Drizzle migrations.
  // (Not inside `file_upload`: the first migration creates that schema.)
  migrations: { schema: "drizzle", table: "__file_upload_migrations" },
  strict: true,
  verbose: true,
});
