import { createHash } from "node:crypto";
import { and, asc, between, desc, eq, lt, sql } from "drizzle-orm";
import { getTableConfig, type PgDatabase, type PgQueryResultHKT, type PgTable } from "drizzle-orm/pg-core";
import type {
  ContentStreamRequest,
  FileContent,
  FileContentReader,
  FileStorage,
  ListFilesQuery,
  PreparedUpload,
  StorageUsageReader,
} from "../../application/ports";
import type { ByteRange } from "../../domain/byte-range";
import { InvalidRequestError } from "../../domain/errors";
import type { ContentEncoding, FilePage, StorageUsage, StoredFile } from "../../domain/stored-file";
import { toReadableStream } from "../streams";
import { DEFAULT_BLOB_ENCODING, decodeBrotli, encodeBlob, type BlobEncodingOptions } from "./blob-encoding";
import { blobChunks, blobs, files } from "./schema";
import { isUuid, uuidv7 } from "./uuid-v7";

/**
 * Any Drizzle Postgres database or transaction, whatever its driver (`postgres`,
 * `pg`, Neon, PGlite…) and whatever schema the host registered. Only the core
 * query builder is used, never the relational `db.query` API.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- intentionally schema-agnostic
export type AnyPgDatabase = PgDatabase<PgQueryResultHKT, any, any>;

export interface PostgresFileStorageOptions {
  readonly providerId: string;
  /** The URL clients download a file from — the HTTP layer's content route. */
  readonly contentUrl: (fileId: string) => string;
  /** Size of each stored chunk. Recorded per blob, so it can change safely later. */
  readonly chunkSizeBytes?: number;
  readonly encoding?: BlobEncodingOptions;
}

export const DEFAULT_CHUNK_SIZE_BYTES = 256 * 1024;
/** Chunks per INSERT statement: bounds statement size to ~4 MiB. */
const CHUNKS_PER_INSERT = 16;
/** Chunks per SELECT while streaming: bounds memory per download to ~2 MiB. */
const CHUNKS_PER_READ = 8;

const blobColumns = {
  blobId: blobs.id,
  sha256: blobs.sha256,
  size: blobs.size,
  storedSize: blobs.storedSize,
  encoding: blobs.encoding,
  chunkSize: blobs.chunkSize,
  refCount: blobs.refCount,
};

const fileColumns = {
  ...blobColumns,
  id: files.id,
  name: files.name,
  contentType: files.contentType,
  originalSize: files.originalSize,
  width: files.width,
  height: files.height,
  createdAt: files.createdAt,
};

interface BlobRow {
  readonly blobId: number;
  readonly sha256: Uint8Array;
  readonly size: number;
  readonly storedSize: number;
  readonly encoding: ContentEncoding;
  readonly chunkSize: number;
  readonly refCount: number;
}

interface FileRow extends BlobRow {
  readonly id: string;
  readonly name: string;
  readonly contentType: string;
  readonly originalSize: number;
  readonly width: number | null;
  readonly height: number | null;
  readonly createdAt: Date;
}

/**
 * Stores file bytes in Postgres, cheaply:
 * content-addressed dedup, app-level brotli, fixed-size chunks.
 * See `schema.ts` for the layout and README for the reasoning.
 */
export class PostgresFileStorage implements FileStorage, FileContentReader, StorageUsageReader {
  private readonly chunkSize: number;
  private readonly encoding: BlobEncodingOptions;

  constructor(
    private readonly db: AnyPgDatabase,
    private readonly options: PostgresFileStorageOptions,
  ) {
    this.chunkSize = options.chunkSizeBytes ?? DEFAULT_CHUNK_SIZE_BYTES;
    this.encoding = options.encoding ?? DEFAULT_BLOB_ENCODING;
  }

  async save(upload: PreparedUpload): Promise<StoredFile> {
    const sha256 = createHash("sha256").update(upload.bytes).digest();
    const fileId = uuidv7();

    // Fast path — the content is already stored: add a reference, skip encoding and chunk writes.
    const deduplicated = await this.db.transaction(async (tx) => {
      const [blob] = await tx
        .update(blobs)
        .set({ refCount: sql`${blobs.refCount} + 1` })
        .where(eq(blobs.sha256, sha256))
        .returning(blobColumns);
      return blob ? this.insertFile(tx, fileId, upload, blob) : null;
    });
    if (deduplicated) return deduplicated;

    // Slow path — new content. Compress before opening a transaction: CPU work must not hold locks.
    const encoded = await encodeBlob(upload.bytes, upload.contentType, this.encoding);

    return this.db.transaction(async (tx) => {
      // A concurrent upload of the same bytes may have inserted the blob meanwhile;
      // ON CONFLICT turns our insert into "add a reference" atomically.
      const [blob] = await tx
        .insert(blobs)
        .values({
          sha256,
          size: upload.bytes.byteLength,
          storedSize: encoded.bytes.byteLength,
          encoding: encoded.encoding,
          chunkSize: this.chunkSize,
          chunkCount: Math.ceil(encoded.bytes.byteLength / this.chunkSize),
        })
        .onConflictDoUpdate({ target: blobs.sha256, set: { refCount: sql`${blobs.refCount} + 1` } })
        .returning(blobColumns);

      // Existing blobs always have ref_count ≥ 1, so after an update it is ≥ 2.
      // Exactly 1 therefore means "we inserted it" and must write the bytes.
      if (blob.refCount === 1) await this.writeChunks(tx, blob.blobId, encoded.bytes);
      return this.insertFile(tx, fileId, upload, blob);
    });
  }

  async find(id: string): Promise<StoredFile | null> {
    const row = await this.findRow(id);
    return row ? this.toStoredFile(row) : null;
  }

  async list({ limit, cursor }: ListFilesQuery): Promise<FilePage> {
    if (cursor !== undefined && !isUuid(cursor)) throw new InvalidRequestError("Invalid cursor.");

    // Keyset pagination on the time-ordered UUIDv7 primary key: O(limit) at any depth.
    const rows = await this.db
      .select(fileColumns)
      .from(files)
      .innerJoin(blobs, eq(files.blobId, blobs.id))
      .where(cursor ? lt(files.id, cursor) : undefined)
      .orderBy(desc(files.id))
      .limit(limit + 1);

    const page = rows.slice(0, limit);
    return {
      items: page.map((row) => this.toStoredFile(row)),
      nextCursor: rows.length > limit ? page[page.length - 1].id : null,
    };
  }

  async delete(id: string): Promise<boolean> {
    if (!isUuid(id)) return false;

    return this.db.transaction(async (tx) => {
      const [file] = await tx.delete(files).where(eq(files.id, id)).returning({ blobId: files.blobId });
      if (!file) return false;

      // The UPDATE row-locks the blob until commit, so no concurrent upload can
      // add a reference between this decrement and the delete below.
      const [blob] = await tx
        .update(blobs)
        .set({ refCount: sql`${blobs.refCount} - 1` })
        .where(eq(blobs.id, file.blobId))
        .returning({ refCount: blobs.refCount });

      if (blob?.refCount === 0) await tx.delete(blobs).where(eq(blobs.id, file.blobId)); // chunks cascade
      return true;
    });
  }

  async get(id: string): Promise<FileContent | null> {
    const row = await this.findRow(id);
    if (!row) return null;

    return {
      file: this.toStoredFile(row),
      version: Buffer.from(row.sha256).toString("hex"),
      storedEncoding: row.encoding,
      storedBytes: row.storedSize,
      open: (request) => toReadableStream(this.readContent(row, request)),
    };
  }

  async usage(): Promise<StorageUsage> {
    const [[perFile], [perBlob]] = await Promise.all([
      this.db
        .select({
          fileCount: sql<number>`count(*)`.mapWith(Number),
          uploadedBytes: sql<number>`coalesce(sum(${files.originalSize}), 0)`.mapWith(Number),
          logicalBytes: sql<number>`coalesce(sum(${blobs.size}), 0)`.mapWith(Number),
        })
        .from(files)
        .innerJoin(blobs, eq(files.blobId, blobs.id)),
      this.db
        .select({
          storedBytes: sql<number>`coalesce(sum(${blobs.storedSize}), 0)`.mapWith(Number),
          onDiskBytes: sql<number>`${totalRelationSize(files)} + ${totalRelationSize(blobs)} + ${totalRelationSize(blobChunks)}`.mapWith(Number),
        })
        .from(blobs),
    ]);
    return { ...perFile, ...perBlob };
  }

  private async findRow(id: string): Promise<FileRow | null> {
    if (!isUuid(id)) return null;
    const [row] = await this.db
      .select(fileColumns)
      .from(files)
      .innerJoin(blobs, eq(files.blobId, blobs.id))
      .where(eq(files.id, id))
      .limit(1);
    return row ?? null;
  }

  private async insertFile(tx: AnyPgDatabase, id: string, upload: PreparedUpload, blob: BlobRow): Promise<StoredFile> {
    const values = {
      id,
      blobId: blob.blobId,
      name: upload.name,
      contentType: upload.contentType,
      originalSize: upload.originalSize,
      width: upload.width ?? null,
      height: upload.height ?? null,
    };
    const [{ createdAt }] = await tx.insert(files).values(values).returning({ createdAt: files.createdAt });
    return this.toStoredFile({ ...blob, ...values, createdAt });
  }

  private async writeChunks(tx: AnyPgDatabase, blobId: number, bytes: Uint8Array): Promise<void> {
    const rows: { blobId: number; seq: number; data: Uint8Array }[] = [];
    for (let seq = 0, offset = 0; offset < bytes.byteLength; seq += 1, offset += this.chunkSize) {
      rows.push({ blobId, seq, data: bytes.subarray(offset, offset + this.chunkSize) });
    }
    for (let index = 0; index < rows.length; index += CHUNKS_PER_INSERT) {
      await tx.insert(blobChunks).values(rows.slice(index, index + CHUNKS_PER_INSERT));
    }
  }

  private readContent(row: FileRow, { encoding, range }: ContentStreamRequest): AsyncIterable<Uint8Array> {
    if (range && row.encoding !== "identity") throw new Error("Byte ranges require identity-encoded content.");
    const stored = this.readStoredBytes(row, range ?? { start: 0, end: row.storedSize - 1 });
    return row.encoding === "br" && encoding === "identity" ? decodeBrotli(stored) : stored;
  }

  /** Streams the stored bytes in `range`, fetching a few chunks per query. */
  private async *readStoredBytes(blob: BlobRow, { start, end }: ByteRange): AsyncGenerator<Uint8Array> {
    if (end < start) return;
    const firstSeq = Math.floor(start / blob.chunkSize);
    const lastSeq = Math.floor(end / blob.chunkSize);

    for (let from = firstSeq; from <= lastSeq; from += CHUNKS_PER_READ) {
      const to = Math.min(from + CHUNKS_PER_READ - 1, lastSeq);
      const chunks = await this.db
        .select({ seq: blobChunks.seq, data: blobChunks.data })
        .from(blobChunks)
        .where(and(eq(blobChunks.blobId, blob.blobId), between(blobChunks.seq, from, to)))
        .orderBy(asc(blobChunks.seq));

      // A short read means the blob was deleted mid-stream; fail loudly rather than truncate silently.
      if (chunks.length !== to - from + 1) throw new Error(`Blob ${blob.blobId} is missing chunks ${from}-${to}.`);

      for (const { seq, data } of chunks) {
        const chunkStart = seq * blob.chunkSize;
        yield data.subarray(Math.max(start - chunkStart, 0), Math.min(end - chunkStart + 1, data.byteLength));
      }
    }
  }

  private toStoredFile(row: FileRow): StoredFile {
    return {
      id: row.id,
      provider: this.options.providerId,
      name: row.name,
      contentType: row.contentType,
      size: row.size,
      originalSize: row.originalSize,
      url: this.options.contentUrl(row.id),
      width: row.width ?? undefined,
      height: row.height ?? undefined,
      createdAt: row.createdAt,
      footprint: { storedBytes: row.storedSize, encoding: row.encoding, sharedBy: row.refCount },
    };
  }
}

/** Table + indexes + TOAST, as Postgres actually stores it. */
function totalRelationSize(table: PgTable) {
  const { schema, name } = getTableConfig(table);
  return sql`pg_total_relation_size(${`"${schema ?? "public"}"."${name}"`}::regclass)`;
}
