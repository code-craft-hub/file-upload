/**
 * Framework-agnostic HTTP handlers: standard `Request` in, `Response` out.
 * They run unchanged on Next.js route handlers, Hono, Remix, SvelteKit, Bun,
 * Deno… — each framework only needs a few lines of glue (see `adapters/`).
 *
 * Routes (relative to wherever you mount them, e.g. `/api/files`):
 *   GET    /                         → providers
 *   GET    /:provider                → list files (?cursor=&limit=)
 *   POST   /:provider                → upload (multipart/form-data, field "file")
 *   GET    /:provider/usage          → storage usage
 *   GET    /:provider/:id            → file metadata
 *   DELETE /:provider/:id            → delete
 *   GET    /:provider/:id/content    → bytes (Range, ETag, br) or redirect to CDN (?download=1)
 */
import type { FileUploadUseCases } from "../application/file-upload-use-cases";
import type { Logger } from "../application/ports";
import type { FileRef } from "../application/use-cases/get-file";
import type { ReadFileContentResult } from "../application/use-cases/read-file-content";
import {
  FileTooLargeError,
  FileUploadError,
  InvalidRequestError,
  RangeNotSatisfiableError,
  type FileUploadErrorCode,
} from "../domain/errors";
import { isTextualMimeType } from "../domain/content-type";
import { toFileDto, toProviderDto, type ErrorDto, type FilePageDto } from "./dto";
import { contentDisposition, parseAcceptEncoding, parseIfNoneMatch, parseRangeHeader } from "./headers";

export type FileAction = "providers.list" | "files.list" | "files.upload" | "files.read" | "files.delete" | "usage.read";

export interface FileHttpOptions {
  /**
   * Runs before every request; return a `Response` (e.g. 401/403) to reject it.
   * The module ships WITHOUT authentication — wire your session check here.
   */
  readonly authorize?: (
    request: Request,
    action: FileAction,
    params: { readonly provider?: string; readonly id?: string },
  ) => Response | void | Promise<Response | void>;
  readonly logger: Logger;
}

type ProviderParams = { readonly provider: string };

export interface FileHttpHandlers {
  listProviders(request: Request, params?: object): Promise<Response>;
  listFiles(request: Request, params: ProviderParams): Promise<Response>;
  uploadFile(request: Request, params: ProviderParams): Promise<Response>;
  getUsage(request: Request, params: ProviderParams): Promise<Response>;
  getFile(request: Request, params: FileRef): Promise<Response>;
  deleteFile(request: Request, params: FileRef): Promise<Response>;
  getContent(request: Request, params: FileRef): Promise<Response>;
}

const STATUS_BY_CODE: Record<FileUploadErrorCode, number> = {
  EMPTY_FILE: 400,
  INVALID_REQUEST: 400,
  FILE_NOT_FOUND: 404,
  PROVIDER_NOT_FOUND: 404,
  FILE_TOO_LARGE: 413,
  UNSUPPORTED_FILE_TYPE: 415,
  RANGE_NOT_SATISFIABLE: 416,
  STORAGE_UNAVAILABLE: 502,
};

/** Multipart framing around the file: boundaries, part headers, the file name. */
const MULTIPART_OVERHEAD_BYTES = 16 * 1024;
/** A file id always maps to the same bytes, so responses can be cached forever. */
const IMMUTABLE_CACHE = "private, max-age=31536000, immutable";
/** Types a browser could execute if opened directly; sandboxed when served. */
const ACTIVE_CONTENT = /^(image\/svg\+xml|text\/html|text\/xml|application\/xml|application\/xhtml\+xml)$/;

export function createFileHttpHandlers(module: FileUploadUseCases, options: FileHttpOptions): FileHttpHandlers {
  const { logger } = options;

  function handle<P extends object>(action: FileAction, run: (request: Request, params: P) => Promise<Response>) {
    return async (request: Request, params: P): Promise<Response> => {
      try {
        const rejection = await options.authorize?.(request, action, params);
        return rejection ?? (await run(request, params));
      } catch (error) {
        return errorResponse(error, logger);
      }
    };
  }

  return {
    listProviders: handle("providers.list", async () => Response.json({ providers: module.providers.list().map(toProviderDto) })),

    listFiles: handle("files.list", async (request, { provider }: ProviderParams) => {
      const { searchParams } = new URL(request.url);
      const limit = searchParams.has("limit") ? Number(searchParams.get("limit")) : undefined;
      if (limit !== undefined && !Number.isFinite(limit)) throw new InvalidRequestError("`limit` must be a number.");
      const page = await module.listFiles.execute({ provider, limit, cursor: searchParams.get("cursor") ?? undefined });
      return Response.json({ items: page.items.map(toFileDto), nextCursor: page.nextCursor } satisfies FilePageDto);
    }),

    uploadFile: handle("files.upload", async (request, { provider }: ProviderParams) => {
      const { maxFileSizeBytes } = module.providers.get(provider).policy;
      const upload = await readMultipartFile(request, maxFileSizeBytes);
      const file = await module.uploadFile.execute({ provider, fileName: upload.name, declaredType: upload.type, bytes: upload.bytes });
      return Response.json({ file: toFileDto(file) }, { status: 201 });
    }),

    getUsage: handle("usage.read", async (_request, { provider }: ProviderParams) => {
      const usage = await module.getStorageUsage.execute(provider);
      if (!usage) return errorJson(404, "NOT_SUPPORTED", `"${provider}" does not report storage usage.`);
      return Response.json({ usage });
    }),

    getFile: handle("files.read", async (_request, ref: FileRef) => Response.json({ file: toFileDto(await module.getFile.execute(ref)) })),

    deleteFile: handle("files.delete", async (_request, ref: FileRef) => {
      await module.deleteFile.execute(ref);
      return new Response(null, { status: 204 });
    }),

    getContent: handle("files.read", async (request, ref: FileRef) => {
      const result = await module.readFileContent.execute({
        ...ref,
        acceptEncodings: parseAcceptEncoding(request.headers.get("accept-encoding")),
        range: parseRangeHeader(request.headers.get("range")),
        knownVersions: parseIfNoneMatch(request.headers.get("if-none-match")),
      });
      return contentResponse(request, result);
    }),
  };
}

async function contentResponse(request: Request, result: ReadFileContentResult): Promise<Response> {
  if (result.kind === "redirect") {
    return new Response(null, { status: 302, headers: { location: result.location } });
  }
  if (result.kind === "not-modified") {
    return new Response(null, { status: 304, headers: { etag: `"${result.version}"`, "cache-control": IMMUTABLE_CACHE } });
  }

  const { file, encoding, range } = result;
  const download = new URL(request.url).searchParams.has("download");
  const headers = new Headers({
    "content-type": isTextualMimeType(file.contentType) ? `${file.contentType}; charset=utf-8` : file.contentType,
    "content-length": String(result.length),
    // One version, several encodings: strong tag for identity bytes, weak for br.
    etag: encoding === "identity" ? `"${result.version}"` : `W/"${result.version}"`,
    "cache-control": IMMUTABLE_CACHE,
    "content-disposition": contentDisposition(download ? "attachment" : "inline", file.name),
    "accept-ranges": result.rangeable ? "bytes" : "none",
    "x-content-type-options": "nosniff",
  });
  if (encoding !== "identity") headers.set("content-encoding", encoding);
  if (result.negotiated) headers.set("vary", "Accept-Encoding");
  if (ACTIVE_CONTENT.test(file.contentType)) {
    headers.set("content-security-policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox");
  }
  if (range) headers.set("content-range", `bytes ${range.start}-${range.end}/${file.size}`);

  const status = range ? 206 : 200;
  if (request.method === "HEAD") {
    await result.body.cancel(); // lazy stream: nothing was read
    return new Response(null, { status, headers });
  }
  return new Response(result.body, { status, headers });
}

/**
 * Parses a multipart upload while enforcing the size limit *during* the read,
 * so a client that lies about (or omits) `Content-Length` cannot make the
 * server buffer more than the limit.
 */
async function readMultipartFile(request: Request, maxFileSizeBytes: number) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data/i.test(contentType)) {
    throw new InvalidRequestError('Send the file as multipart/form-data in a field named "file".');
  }

  const maxBodyBytes = maxFileSizeBytes + MULTIPART_OVERHEAD_BYTES;
  if (Number(request.headers.get("content-length")) > maxBodyBytes) throw new FileTooLargeError(maxFileSizeBytes);
  if (!request.body) throw new InvalidRequestError("The request has no body.");

  let exceeded = false;
  const limited = request.body.pipeThrough(
    byteLimit(maxBodyBytes, () => {
      exceeded = true;
    }),
  );

  let form: FormData;
  try {
    form = await new Response(limited, { headers: { "content-type": contentType } }).formData();
  } catch (cause) {
    if (exceeded) throw new FileTooLargeError(maxFileSizeBytes);
    throw new InvalidRequestError("The multipart body could not be parsed.", { cause });
  }

  const file = form.get("file");
  if (!(file instanceof File)) throw new InvalidRequestError('Expected a file in the "file" field.');
  return { name: file.name, type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) };
}

function byteLimit(maxBytes: number, onExceeded: () => void): TransformStream<Uint8Array, Uint8Array> {
  let total = 0;
  return new TransformStream({
    transform(chunk, controller) {
      total += chunk.byteLength;
      if (total > maxBytes) {
        onExceeded();
        controller.error(new Error("Request body exceeds the size limit."));
        return;
      }
      controller.enqueue(chunk);
    },
  });
}

function errorResponse(error: unknown, logger: Logger): Response {
  if (!(error instanceof FileUploadError)) {
    logger.error("Unhandled error in file upload handler.", { error });
    return errorJson(500, "INTERNAL", "Something went wrong.");
  }

  if (error.code === "STORAGE_UNAVAILABLE") {
    // Upstream details stay in the logs, not in the response.
    logger.error(error.message, { cause: error.cause });
    return errorJson(502, error.code, "The storage provider is unavailable. Try again shortly.");
  }

  const response = errorJson(STATUS_BY_CODE[error.code], error.code, error.message);
  if (error instanceof RangeNotSatisfiableError) response.headers.set("content-range", `bytes */${error.size}`);
  return response;
}

function errorJson(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } } satisfies ErrorDto, { status });
}
