/**
 * Integration tests against a real Postgres. Skipped unless TEST_DATABASE_URL
 * points at a disposable database — the suite drops and recreates the
 * `file_upload` schema.
 *
 *   TEST_DATABASE_URL=postgres://postgres@localhost:5432/file_upload_test pnpm test
 */
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { brotliDecompressSync } from "node:zlib";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PreparedUpload } from "../../application/ports";
import { describeFileStorageContract, preparedUpload } from "../../testing/file-storage-contract";
import { createPostgresConnection, type PostgresConnection } from "./connection";
import { PostgresFileStorage } from "./postgres-file-storage";

const url = process.env.TEST_DATABASE_URL;
const MIGRATIONS = {
  migrationsFolder: fileURLToPath(new URL("./migrations", import.meta.url)),
  migrationsSchema: "drizzle",
  migrationsTable: "__file_upload_migrations",
};

describe.skipIf(!url)("PostgresFileStorage (integration)", () => {
  let connection: PostgresConnection;
  const storage = (chunkSizeBytes?: number) =>
    new PostgresFileStorage(connection.db, { providerId: "postgres", contentUrl: (id) => `/files/${id}`, chunkSizeBytes });

  const count = async (table: "blobs" | "blob_chunks" | "files") => {
    const [row] = await connection.db.execute<{ n: number }>(sql.raw(`select count(*)::int as n from file_upload.${table}`));
    return row.n;
  };
  const read = async (stream: ReadableStream<Uint8Array>) => new Uint8Array(await new Response(stream).arrayBuffer());
  const binary = (name: string, bytes: Uint8Array, contentType = "application/octet-stream"): PreparedUpload => ({
    name,
    contentType,
    bytes,
    originalSize: bytes.byteLength,
  });

  beforeAll(async () => {
    connection = createPostgresConnection(url!, { maxConnections: 8 });
    await connection.db.execute(sql`drop schema if exists file_upload cascade`);
    await connection.db.execute(sql`drop table if exists drizzle.__file_upload_migrations`);
    await migrate(connection.db, MIGRATIONS);
  });

  beforeEach(async () => {
    await connection.db.execute(sql`truncate file_upload.files, file_upload.blobs, file_upload.blob_chunks restart identity cascade`);
  });

  afterAll(async () => {
    await connection?.close();
  });

  describeFileStorageContract("PostgresFileStorage", async () => ({ storage: storage() }));

  it("applies STORAGE EXTERNAL to chunk data", async () => {
    const [row] = await connection.db.execute<{ storage: string }>(
      sql`select attstorage::text as storage from pg_attribute where attrelid = 'file_upload.blob_chunks'::regclass and attname = 'data'`,
    );
    expect(row.storage).toBe("e");
  });

  it("stores identical content once and reference-counts it", async () => {
    const files = storage();
    const bytes = randomBytes(10_000);
    const a = await files.save(binary("a.bin", bytes));
    const b = await files.save(binary("b.bin", bytes));

    expect(b.footprint).toMatchObject({ sharedBy: 2 });
    expect(await count("blobs")).toBe(1);

    await files.delete(a.id);
    expect(await count("blobs")).toBe(1);
    expect((await files.find(b.id))?.footprint?.sharedBy).toBe(1);

    await files.delete(b.id);
    expect(await count("blobs")).toBe(0);
    expect(await count("blob_chunks")).toBe(0);
  });

  it("deduplicates concurrent uploads of the same bytes without losing references", async () => {
    const files = storage();
    const bytes = randomBytes(50_000);
    const saved = await Promise.all(Array.from({ length: 8 }, (_, i) => files.save(binary(`${i}.bin`, bytes))));

    expect(await count("blobs")).toBe(1);
    expect(await count("files")).toBe(8);
    expect((await files.find(saved[0].id))?.footprint?.sharedBy).toBe(8);

    await Promise.all(saved.map((file) => files.delete(file.id)));
    expect(await count("blobs")).toBe(0);
  });

  it("brotli-compresses compressible content and decodes it on the way out", async () => {
    const files = storage();
    const text = "The quick brown fox jumps over the lazy dog.\n".repeat(2_000);
    const saved = await files.save(preparedUpload("fox.txt", text));

    expect(saved.footprint?.encoding).toBe("br");
    expect(saved.footprint!.storedBytes).toBeLessThan(text.length / 20);

    const content = (await files.get(saved.id))!;
    expect(new TextDecoder().decode(await read(content.open({ encoding: "identity" })))).toBe(text);

    const raw = await read(content.open({ encoding: "br" }));
    expect(raw.byteLength).toBe(content.storedBytes);
    expect(brotliDecompressSync(raw).toString()).toBe(text);
  });

  it("stores incompressible and already-compressed content as is", async () => {
    const files = storage();
    const random = await files.save(binary("noise.bin", randomBytes(20_000)));
    const jpeg = await files.save(binary("photo.jpg", new Uint8Array(20_000).fill(1), "image/jpeg"));

    expect(random.footprint?.encoding).toBe("identity");
    expect(jpeg.footprint?.encoding).toBe("identity");
  });

  it("splits content into chunks and serves byte ranges across chunk boundaries", async () => {
    const files = storage(1024);
    const bytes = randomBytes(10 * 1024 + 300);
    const saved = await files.save(binary("big.bin", bytes));
    expect(await count("blob_chunks")).toBe(11);

    const content = (await files.get(saved.id))!;
    expect(Buffer.from(await read(content.open({ encoding: "identity" })))).toEqual(bytes);

    const range = { start: 1000, end: 5000 };
    expect(Buffer.from(await read(content.open({ encoding: "identity", range })))).toEqual(bytes.subarray(1000, 5001));

    const tail = { start: bytes.length - 10, end: bytes.length - 1 };
    expect(Buffer.from(await read(content.open({ encoding: "identity", range: tail })))).toEqual(bytes.subarray(-10));
  });

  it("reports usage that reflects deduplication and compression", async () => {
    const files = storage();
    const text = "lorem ipsum dolor sit amet ".repeat(4_000);
    await files.save(preparedUpload("1.txt", text));
    await files.save(preparedUpload("2.txt", text));

    const usage = await files.usage();
    expect(usage).toMatchObject({ fileCount: 2, uploadedBytes: text.length * 2, logicalBytes: text.length * 2 });
    expect(usage.storedBytes).toBeLessThan(text.length / 20);
    expect(usage.onDiskBytes).toBeGreaterThan(0);
  });

  it("rejects malformed cursors and treats malformed ids as missing", async () => {
    const files = storage();
    await expect(files.list({ limit: 10, cursor: "not-a-uuid" })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(await files.find("'; drop table files; --")).toBeNull();
    expect(await files.delete("nope")).toBe(false);
  });
});
