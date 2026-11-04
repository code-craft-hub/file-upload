/**
 * Application-level compression for stored blobs.
 *
 * Why compress in the app rather than rely on Postgres TOAST compression?
 * - Brotli compresses text 2–4× better than TOAST's pglz/lz4.
 * - Stored bytes are a valid `Content-Encoding: br` body, so most downloads are
 *   served without spending any CPU on decompression.
 * - We know the MIME type, so we skip formats that are already compressed
 *   instead of letting Postgres try (and fail) on every JPEG chunk.
 */
import { Readable } from "node:stream";
import { promisify } from "node:util";
import { brotliCompress, constants, createBrotliDecompress } from "node:zlib";
import type { ContentEncoding } from "../../domain/stored-file";
import { isTextualMimeType } from "../../domain/content-type";

const compress = promisify(brotliCompress);

export interface BlobEncodingOptions {
  /** Brotli quality, 0–11. 9 is a good ratio at a fraction of 11's CPU cost. */
  readonly brotliQuality: number;
  /** Below this size the saving is not worth the per-request decode. */
  readonly minSizeBytes: number;
  /** Keep the compressed form only if it is at least this much smaller (0–1). */
  readonly minSavingsRatio: number;
}

export const DEFAULT_BLOB_ENCODING: BlobEncodingOptions = {
  brotliQuality: 9,
  minSizeBytes: 1024,
  minSavingsRatio: 0.1,
};

/** Formats with their own compression; re-compressing them only burns CPU. */
const ALREADY_COMPRESSED = [
  /^image\/(jpeg|png|gif|webp|avif|heic|heif)$/,
  /^video\//,
  /^audio\/(mpeg|mp4|ogg|aac|webm|flac)$/,
  /^application\/(zip|gzip|zstd|x-7z-compressed|x-rar-compressed|x-bzip2|x-xz|epub\+zip)$/,
  /^application\/vnd\.openxmlformats-/,
];

export interface EncodedBlob {
  readonly bytes: Uint8Array;
  readonly encoding: ContentEncoding;
}

export async function encodeBlob(
  bytes: Uint8Array,
  contentType: string,
  options: BlobEncodingOptions = DEFAULT_BLOB_ENCODING,
): Promise<EncodedBlob> {
  const identity: EncodedBlob = { bytes, encoding: "identity" };
  if (bytes.byteLength < options.minSizeBytes) return identity;
  if (ALREADY_COMPRESSED.some((pattern) => pattern.test(contentType))) return identity;

  // `brotliCompress` runs on the libuv thread pool, so it does not block the event loop.
  const compressed = await compress(bytes, {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: options.brotliQuality,
      [constants.BROTLI_PARAM_SIZE_HINT]: bytes.byteLength,
      [constants.BROTLI_PARAM_MODE]: isTextualMimeType(contentType)
        ? constants.BROTLI_MODE_TEXT
        : constants.BROTLI_MODE_GENERIC,
    },
  });

  const worthIt = compressed.byteLength <= bytes.byteLength * (1 - options.minSavingsRatio);
  return worthIt ? { bytes: compressed, encoding: "br" } : identity;
}

/** Decodes a brotli byte stream incrementally. */
export async function* decodeBrotli(source: AsyncIterable<Uint8Array>): AsyncGenerator<Uint8Array> {
  const input = Readable.from(source);
  const decoder = createBrotliDecompress();
  input.on("error", (error) => decoder.destroy(error));
  input.pipe(decoder);
  try {
    for await (const chunk of decoder) yield chunk as Buffer;
  } finally {
    input.destroy();
    decoder.destroy();
  }
}
