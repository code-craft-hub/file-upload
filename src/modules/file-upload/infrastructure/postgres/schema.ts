/**
 * Postgres storage layout. Three tables, in a dedicated `file_upload` schema so
 * the module can never collide with a host project's own `files` table.
 *
 *   files ──(n:1)──▶ blobs ──(1:n)──▶ blob_chunks
 *   metadata          unique content    the bytes, in fixed-size chunks
 *
 * Cost-saving decisions (see README → "Postgres storage design"):
 * - `blobs` is content-addressed by SHA-256, so identical uploads share one
 *   copy. `ref_count` tracks how many `files` point at it.
 * - Bytes live in `blob_chunks`, never in `files`. Listing files never touches
 *   TOAST, and downloads stream chunk by chunk with bounded memory.
 * - `blob_chunks.data` uses `STORAGE EXTERNAL` (set in a custom migration, as
 *   Drizzle cannot express it): out-of-line and *not* re-compressed by
 *   Postgres, because the application already brotli-compresses what is
 *   compressible and everything else is already-compressed media.
 * - Surrogate keys on the hot path are 8-byte `bigint`s, not 16-byte UUIDs or
 *   32-byte hashes, keeping the chunk primary-key index small.
 * - Columns are declared widest-alignment first (8-byte, then 4-byte, then
 *   variable-length) so Postgres inserts no alignment padding between them.
 * - `files.id` is a UUIDv7 (time-ordered), so the primary-key index doubles as
 *   the newest-first pagination index; no separate `created_at` index needed.
 */
import { sql } from "drizzle-orm";
import { bigint, check, customType, index, integer, pgSchema, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const fileUploadSchema = pgSchema("file_upload");

/** Drizzle has no built-in `bytea`; both `postgres` and `pg` drivers return Buffers. */
const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType: () => "bytea",
  toDriver: (value) => Buffer.from(value.buffer, value.byteOffset, value.byteLength),
  fromDriver: (value) => value,
});

export const contentEncoding = fileUploadSchema.enum("content_encoding", ["identity", "br"]);

export const blobs = fileUploadSchema.table(
  "blobs",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    /** Decoded size: what a client downloads. */
    size: bigint("size", { mode: "number" }).notNull(),
    /** Encoded size: what is actually stored in `blob_chunks`. */
    storedSize: bigint("stored_size", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** Recorded per blob so the chunk size can change without breaking old blobs. */
    chunkSize: integer("chunk_size").notNull(),
    chunkCount: integer("chunk_count").notNull(),
    /** Number of `files` rows that reference this blob. Never 0 outside a transaction. */
    refCount: integer("ref_count").notNull().default(1),
    encoding: contentEncoding("encoding").notNull(),
    /** Raw 32-byte digest (half the size of hex text, in the row and in the index). */
    sha256: bytea("sha256").notNull(),
  },
  (table) => [
    uniqueIndex("blobs_sha256_key").on(table.sha256),
    check("blobs_sha256_length", sql`octet_length(${table.sha256}) = 32`),
    check("blobs_sizes_non_negative", sql`${table.size} >= 0 AND ${table.storedSize} >= 0`),
    check("blobs_chunking_valid", sql`${table.chunkSize} > 0 AND ${table.chunkCount} >= 0`),
    check("blobs_ref_count_non_negative", sql`${table.refCount} >= 0`),
  ],
);

export const blobChunks = fileUploadSchema.table(
  "blob_chunks",
  {
    blobId: bigint("blob_id", { mode: "number" })
      .notNull()
      .references(() => blobs.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    data: bytea("data").notNull(),
  },
  (table) => [
    // Leading `blob_id` also serves the foreign key's cascade lookups.
    primaryKey({ name: "blob_chunks_pkey", columns: [table.blobId, table.seq] }),
    check("blob_chunks_seq_non_negative", sql`${table.seq} >= 0`),
  ],
);

export const files = fileUploadSchema.table(
  "files",
  {
    id: uuid("id").primaryKey(),
    /** `restrict`: a referenced blob can never be deleted out from under a file. */
    blobId: bigint("blob_id", { mode: "number" })
      .notNull()
      .references(() => blobs.id, { onDelete: "restrict" }),
    originalSize: bigint("original_size", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    width: integer("width"),
    height: integer("height"),
    name: text("name").notNull(),
    contentType: text("content_type").notNull(),
  },
  (table) => [
    // Needed for the `restrict` check when a blob is deleted, and for usage stats.
    index("files_blob_id_idx").on(table.blobId),
    check("files_name_length", sql`char_length(${table.name}) BETWEEN 1 AND 255`),
    check("files_original_size_positive", sql`${table.originalSize} > 0`),
    check(
      "files_dimensions_positive",
      sql`(${table.width} IS NULL OR ${table.width} > 0) AND (${table.height} IS NULL OR ${table.height} > 0)`,
    ),
  ],
);
