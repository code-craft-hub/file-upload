-- Storage tuning that Drizzle's schema DSL cannot express.
-- Hand-written; keep it if you regenerate or merge migrations.

-- Chunk bytes are either brotli-compressed by the application already, or are
-- media formats that are compressed by design (JPEG, WebP, MP4, ZIP…).
-- The default EXTENDED storage would make Postgres try pglz/lz4 on every
-- chunk and fail. EXTERNAL keeps values out of line in TOAST *without*
-- compression: no wasted CPU on writes, and substring reads only fetch the
-- TOAST pages they need.
ALTER TABLE "file_upload"."blob_chunks" ALTER COLUMN "data" SET STORAGE EXTERNAL;
