# file-upload module

File uploads behind one interface, with two production providers:

- **Postgres** (Drizzle + `postgres.js`): bytes live in your database, engineered to cost as little as possible.
- **ImageKit**: bytes live on ImageKit and are delivered by its CDN.

The module is a self-contained folder. Copy it into another project, wire four things (env, migration, routes, page), and it works. The core has no framework dependency; a single small adapter file (`http/adapters/next.ts`) is the only one that imports Next.js.

---

## Contents

1. [Architecture](#architecture)
2. [How a request flows](#how-a-request-flows)
3. [Postgres storage design](#postgres-storage-design)
4. [ImageKit provider](#imagekit-provider)
5. [HTTP API](#http-api)
6. [Configuration](#configuration)
7. [Porting to another project](#porting-to-another-project)
8. [Adding a provider](#adding-a-provider)
9. [Security](#security)
10. [Operations](#operations)
11. [Testing](#testing)
12. [Decisions and trade-offs](#decisions-and-trade-offs)

---

## Architecture

Clean architecture, with dependencies pointing inward only:

```
            ┌──────────────────────────────────────────────────────────┐
  ui/  ───▶ │ http/  (Request → Response, DTOs)                        │
  (React)   │   └─▶ application/  (use cases, ports)                   │
            │          └─▶ domain/  (entities, rules, errors)          │
            │                                                          │
            │ infrastructure/  (Postgres, ImageKit, sharp, in-memory)  │
            │   implements application/ports                           │
            │                                                          │
            │ composition/  wires infrastructure into use cases        │
            └──────────────────────────────────────────────────────────┘
```

| Layer | Knows about | Never imports |
| --- | --- | --- |
| `domain/` | nothing | anything outside `domain/` |
| `application/` | `domain/` | infrastructure, HTTP, frameworks |
| `infrastructure/` | `application/` ports, `domain/` | `http/`, `ui/` |
| `http/` | `application/`, `domain/` | infrastructure |
| `composition/` | everything (it is the composition root) | — |
| `ui/` | `http/dto.ts` types only | server code |

```
file-upload/
├── domain/                     Pure TypeScript. No I/O, no dependencies.
│   ├── stored-file.ts          StoredFile, StorageFootprint, FilePage, StorageUsage
│   ├── upload-policy.ts        size/type rules, defaults
│   ├── content-type.ts         MIME sniffing from magic bytes (HTML → rejected)
│   ├── file-name.ts            name sanitisation (paths, control + bidi chars)
│   ├── byte-range.ts           range resolution
│   └── errors.ts               FileUploadError + stable codes
├── application/
│   ├── ports.ts                FileStorage, FileContentReader, StorageUsageReader, ImageOptimizer
│   ├── provider-registry.ts    id → configured provider
│   ├── file-upload-use-cases.ts   facade that builds every use case
│   └── use-cases/              UploadFile, ListFiles, GetFile, DeleteFile, ReadFileContent, GetStorageUsage
├── infrastructure/
│   ├── postgres/               schema, migrations, PostgresFileStorage, brotli codec, UUIDv7
│   ├── imagekit/               REST client + ImageKitFileStorage
│   ├── sharp/                  SharpImageOptimizer (WebP, resize, strip EXIF)
│   ├── memory/                 InMemoryFileStorage (reference adapter, test fake)
│   └── streams.ts              async iterable → lazy Web ReadableStream
├── http/
│   ├── handlers.ts             framework-agnostic handlers + auth hook
│   ├── headers.ts              Range / Accept-Encoding / If-None-Match / Content-Disposition
│   ├── dto.ts                  the JSON contract (shared with the UI)
│   └── adapters/next.ts        the only Next.js-specific file
├── composition/
│   ├── config.ts               env → typed config
│   └── container.ts            config → adapters → use cases (edit this to change providers)
├── ui/                         React client: FileLibrary, upload queue, Liquid Glass CSS
├── testing/                    shared FileStorage contract suite, fake ImageKit API
├── index.ts                    server entry point
└── ui/index.ts                 client entry point
```

**Capabilities are separate ports** (interface segregation). Every provider implements `FileStorage` (save/find/list/delete). `FileContentReader` (serve bytes through this app) and `StorageUsageReader` (report usage) are optional. Postgres implements all three; ImageKit only the first, because its CDN serves the bytes. Use cases check for a capability; they never check which provider they have.

## How a request flows

**Upload:** `POST /api/files/postgres`

```
HTTP handler        reads multipart with a streaming byte limit (413 before buffering too much)
  → UploadFile      size policy → sanitise name → sniff real type → type policy
                    → optimise image if the provider's policy says so (keep only if smaller)
  → FileStorage     Postgres: hash → dedup? → brotli? → chunk → one transaction
  ← StoredFile      → FileDto (201)
```

**Download:** `GET /api/files/postgres/:id/content`

```
HTTP handler        parses Accept-Encoding, Range, If-None-Match
  → ReadFileContent no content capability   → 302 to the CDN URL
                    version matches         → 304, nothing read
                    stored br + client br   → stream stored bytes as is (zero CPU)
                    stored br, no br        → decode on the fly
                    Range on identity bytes → read only the chunks covering the range (206)
  ← lazy ReadableStream: nothing is read from Postgres until the client pulls
```

## Postgres storage design

Storing files in Postgres is reasonable up to a point (see [Operations](#operations)). Inside that envelope, every layer here is tuned so a stored byte is as cheap as it can be.

```
file_upload.files ──(n:1)──▶ file_upload.blobs ──(1:n)──▶ file_upload.blob_chunks
 metadata, UUIDv7 PK          unique content, SHA-256      256 KiB chunks, STORAGE EXTERNAL
```

| Technique | Where | What it saves | Trade-off |
| --- | --- | --- | --- |
| **Image optimisation**: WebP, longest edge ≤ 2560 px, EXIF stripped, lossless sources stay lossless | `SharpImageOptimizer`, applied by `UploadFile` | Typically 25–80% per photo. Removes GPS metadata. | CPU at upload. The stored file is a WebP, not the original (the name is updated to match). Skipped when it would not shrink the file. |
| **Content-addressed deduplication**: SHA-256 → one `blobs` row, `ref_count` | `PostgresFileStorage.save` | 100% of every repeated upload | One hash per upload (~1 GB/s). |
| **App-level brotli** for compressible types, kept only if ≥ 10% smaller | `blob-encoding.ts` | Text, CSV, JSON, SVG and logs shrink 5–30×; TOAST's pglz/lz4 manages ~2× | CPU at upload, on the libuv pool so the event loop is not blocked. |
| **Pre-compressed delivery**: stored brotli bytes *are* the `Content-Encoding: br` body | `ReadFileContent` + handlers | Download CPU and egress | Range requests are not offered on brotli-stored files (they are compressible text, rarely ranged). |
| **`STORAGE EXTERNAL`** on `blob_chunks.data` | `migrations/0001_storage_tuning.sql` | CPU: Postgres no longer re-compresses incompressible media on every write; substring reads touch only the needed TOAST pages | Relies on the app compressing what is compressible, which it does. |
| **Fixed-size chunks** (256 KiB, recorded per blob) | `blob_chunks` | Memory: downloads stream with ~2 MiB peak; Range reads fetch only covering chunks; no 1 GB `bytea` ceiling | More rows than one-blob-per-file. |
| **Compact keys**: `bigint` identity for blobs, raw 32-byte `bytea` hash rather than 64-char hex | schema | Smaller rows and B-tree indexes on the hottest table | — |
| **Alignment-aware column order**: 8-byte, then 4-byte, then variable-length | schema | No alignment padding per row | Column order in the schema file is intentional; keep it when editing. |
| **UUIDv7 primary keys** (monotonic within a process) | `uuid-v7.ts` | Right-edge B-tree inserts (no random page splits). The PK doubles as the newest-first pagination index, so no `created_at` index is needed. | Ids reveal creation time. |
| **Keyset pagination** on the PK | `list()` | O(page) at any depth, unlike `OFFSET` | Cursor-only navigation (no "jump to page 40"). |
| **Metadata separate from bytes** | `files` vs `blob_chunks` | Listing never touches TOAST | A join on `blob_id` (indexed). |

**Correctness under concurrency.** Uploads take a fast path: `UPDATE blobs SET ref_count = ref_count + 1 WHERE sha256 = $1`. When that misses, the bytes are compressed *outside* any transaction, then `INSERT … ON CONFLICT (sha256) DO UPDATE` atomically turns a lost race into "add a reference". `ref_count = 1` afterwards means "we inserted it, write the chunks". Deletes decrement under the blob's row lock and delete at zero in the same transaction; the `files → blobs` foreign key is `ON DELETE RESTRICT` as a safety net. The integration suite runs 8 identical uploads in parallel and asserts exactly one blob with `ref_count = 8`.

**Measured on this repo's fixtures** (synthetic images, so the image ratios run high; real photos usually land at 25–60%):

| Upload | Uploaded | Stored | Why |
| --- | ---: | ---: | --- |
| 4000×3000 JPEG | 1.0 MB | 212 KB | WebP, resized to 2560 px |
| Same JPEG again | 1.0 MB | 0 B | deduplicated |
| 3.3 MB server log | 3.3 MB | 77 KB | brotli |
| 1440×900 PNG screenshot | 13 KB | 118 B | lossless WebP |

## ImageKit provider

- A REST client of about 100 lines (`imagekit-client.ts`) rather than the SDK. The four endpoints are stable, the SDK has changed package name and API across majors, and an injected `fetch` makes tests deterministic. Swapping in the SDK is a change local to that file.
- **Folder ownership.** All uploads go under `IMAGEKIT_FOLDER`, and `find`/`delete` refuse ids outside it, so the API cannot be used to read or delete other files in a shared ImageKit account.
- **Originals are stored as is** (`optimizeImages: false`). ImageKit resizes and converts on delivery; `thumbnailUrl` uses a `tr=w-480,h-480,c-at_max,q-80` transformation.
- There is no content capability, so `/content` returns 302 to the CDN URL.
- Listing uses ImageKit's `skip`/`limit`, wrapped in an opaque cursor. ImageKit's search index can lag a few seconds behind uploads; the UI inserts uploaded files from the POST response, so this is not visible.

## HTTP API

Mounted at `/api/files` in this app. Errors are always `{ "error": { "code", "message" } }` with a stable `code`.

| Method & path | Response |
| --- | --- |
| `GET /` | `{ providers: ProviderDto[] }` |
| `GET /:provider?cursor=&limit=` | `{ items: FileDto[], nextCursor }` (limit 1–100, default 30) |
| `POST /:provider` (multipart, field `file`) | `201 { file: FileDto }` |
| `GET /:provider/usage` | `{ usage }`, or 404 `NOT_SUPPORTED` |
| `GET /:provider/:id` | `{ file: FileDto }` |
| `DELETE /:provider/:id` | `204` |
| `GET` / `HEAD /:provider/:id/content[?download]` | bytes (200/206/304), or 302 to the CDN |

| Code | Status |
| --- | --- |
| `EMPTY_FILE`, `INVALID_REQUEST` | 400 |
| `FILE_NOT_FOUND`, `PROVIDER_NOT_FOUND` | 404 |
| `FILE_TOO_LARGE` | 413 |
| `UNSUPPORTED_FILE_TYPE` | 415 |
| `RANGE_NOT_SATISFIABLE` | 416 (with `Content-Range: bytes */size`) |
| `STORAGE_UNAVAILABLE` | 502 (upstream details are logged, not returned) |

Content responses carry `ETag` (the SHA-256, weak when brotli-encoded), `Cache-Control: private, max-age=31536000, immutable` (an id's bytes never change), `Vary: Accept-Encoding`, `Accept-Ranges`, an RFC 6266 `Content-Disposition`, `X-Content-Type-Options: nosniff`, and a sandboxing CSP for SVG/XML.

## Configuration

| Variable | Effect |
| --- | --- |
| `DATABASE_URL` | Enables the Postgres provider |
| `IMAGEKIT_PRIVATE_KEY` | Enables the ImageKit provider |
| `IMAGEKIT_FOLDER` | Folder the module owns (default `/file-upload`) |
| `FILE_UPLOAD_MAX_BYTES` | Per-file limit (default 25 MB) |
| `FILE_UPLOAD_ALLOWED_TYPES` | Comma-separated MIME types; `type/*` allowed |

Tuning that rarely changes lives in code, next to what it tunes: `DEFAULT_IMAGE_OPTIMIZATION` (sharp), `DEFAULT_BLOB_ENCODING` (brotli), `DEFAULT_CHUNK_SIZE_BYTES`, and per-provider `optimizeImages` in `composition/container.ts`.

## Porting to another project

**Next.js App Router (≥ 15)**

1. Copy `src/modules/file-upload/` into the target. All internal imports are relative, so no path alias is needed.
2. Install dependencies: `pnpm add drizzle-orm postgres sharp` and `pnpm add -D drizzle-kit` (`vitest` too if you want the tests).
3. Migrations, choosing one of:
   - **Standalone:** copy `drizzle.config.ts` and run `pnpm drizzle-kit migrate`. History goes in `drizzle.__file_upload_migrations`, separate from yours.
   - **Merged into your Drizzle setup:** add `infrastructure/postgres/schema.ts` to your config's `schema`, generate, and **copy the `ALTER … SET STORAGE EXTERNAL` from `0001_storage_tuning.sql` into a custom migration**, because Drizzle cannot express it.
4. Routes: copy `src/app/api/files/**`. Each file is a single re-export.
5. Page: render `<FileLibrary providers={…} />` as `src/app/page.tsx` does. The stylesheet is imported by the component and scoped under `.fu-root`; Tailwind is not required.
6. **Add authentication** in `http/adapters/next.ts` → `authorize`. The module ships without it.
7. Set env vars (`.env.example`).

**Another framework** (Hono, Remix, SvelteKit, Express with a Fetch adapter, …): steps 1–3 and 7 are the same. Instead of step 4, write a small adapter equivalent to `adapters/next.ts` that calls the matching handler:

```ts
const files = createFileHttpHandlers(getFileUploadModule(), { logger: consoleLogger, authorize });
app.post("/api/files/:provider", (c) => files.uploadFile(c.req.raw, c.req.param()));
```

**Already have a Drizzle instance?** Pass it in: `new PostgresFileStorage(yourDb, { … })`. It accepts any Drizzle Postgres database (`postgres`, `pg`, Neon, PGlite…) because it only uses the core query builder.

## Adding a provider

1. Implement `FileStorage` (and `FileContentReader` if your app should serve the bytes) in `infrastructure/<name>/`. `InMemoryFileStorage` is the smallest complete example.
2. Prove it with the shared contract suite:
   ```ts
   describeFileStorageContract("S3", async () => ({ storage: new S3FileStorage(…) }));
   ```
3. Register it in `composition/container.ts` with a label, description and policy.

No use case, handler or UI change is needed; the UI segmented control is driven by the provider list.

## Security

- **No authentication is included.** Wire `authorize` before exposing this to anyone; it receives the action (`files.upload`, `files.delete`, …) and route params.
- **Types come from bytes**, not from the client. HTML sniffs as `text/html` and is rejected by the default allowlist, whatever its name or declared type.
- **Size limits are enforced while streaming** the body, so a missing or false `Content-Length` cannot force a large buffer.
- **Decompression bombs** are refused by sharp's `limitInputPixels` (100 MP by default).
- **Names are sanitised**: no path segments, control characters or bidi overrides (`photo‮gpj.exe`).
- **Served content** gets `nosniff`; SVG/XML get `Content-Security-Policy: sandbox` so they cannot run script when opened directly.
- **EXIF (including GPS) is stripped** from optimised images.
- ImageKit access is confined to its folder; upstream error details are logged, not returned.

## Operations

- **Migrations:** `pnpm db:migrate`. Everything lives in the `file_upload` schema, which makes it easy to grant, back up or drop on its own.
- **Space reuse:** deleting a file whose blob reaches `ref_count = 0` deletes the blob and its chunks (`ON DELETE CASCADE`). Autovacuum makes the space reusable; it is not returned to the OS without `VACUUM FULL` or `pg_repack`.
- **Backups include file bytes.** That is the point of this provider (one transactional store), but it makes dumps proportional to your files.
- **When to move off Postgres:** once file bytes dominate database size (as a rough guide, beyond tens of GB) or downloads compete with OLTP traffic, use an object store. Adding an S3 provider is the [Adding a provider](#adding-a-provider) path, and `files` metadata can stay in Postgres.
- **Uploads are buffered in memory**, bounded by the size limit (×3 concurrent per client in the UI). For multi-GB files, switch to direct-to-provider uploads (ImageKit client upload with a signed token, or S3 pre-signed URLs).
- `usage()` runs `count(*)`/`sum()` over `files`; on very large tables, cache it or keep counters.

## Testing

```bash
pnpm test                                   # unit + contract + HTTP tests
TEST_DATABASE_URL=postgres://…/scratch pnpm test   # also the Postgres integration suite
```

The integration suite drops and recreates the `file_upload` schema, so point it at a disposable database. It covers dedup, concurrent dedup, brotli round-trips, chunk-boundary ranges, usage, and that `STORAGE EXTERNAL` was actually applied.

## Decisions and trade-offs

- **Optimise in the use case, compress in the adapter.** Re-encoding an image changes the file the user gets back, which is a business decision, so it is policy on the provider. Brotli is invisible to callers, which makes it a storage detail.
- **Dedup on the stored bytes' hash, computed by the adapter.** The adapter never trusts a hash it did not compute: a wrong hash would map different content to the same blob.
- **Reference counting over garbage collection.** Collection would need a periodic job and a race-free "is this still referenced?" check. A row-locked counter keeps deletes immediate and is easy to reason about.
- **Server-proxied uploads for every provider.** Validation lives in one place for all providers. The cost is bandwidth through your server, which is acceptable at the 25 MB default limit.
- **No `next/image`.** Provider URLs are arbitrary, and ImageKit already transforms; a second optimiser in front would add cost without benefit.
