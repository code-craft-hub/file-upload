import { describe, expect, it, vi } from "vitest";
import { createFileUploadUseCases } from "../application/file-upload-use-cases";
import type { Logger } from "../application/ports";
import { ProviderRegistry } from "../application/provider-registry";
import { InMemoryFileStorage } from "../infrastructure/memory/in-memory-file-storage";
import type { FileDto } from "./dto";
import { createFileHttpHandlers, type FileHttpOptions } from "./handlers";
import { parseAcceptEncoding, parseIfNoneMatch, parseRangeHeader } from "./headers";

const BASE = "http://localhost/api/files";
const MAX_BYTES = 1024;

function setup(authorize?: FileHttpOptions["authorize"]) {
  const storage = new InMemoryFileStorage("memory");
  const providers = new ProviderRegistry([
    {
      id: "memory",
      label: "Memory",
      description: "",
      policy: { maxFileSizeBytes: MAX_BYTES, allowedContentTypes: ["text/plain"], optimizeImages: false },
      files: storage,
      content: storage,
    },
  ]);
  const logger: Logger = { warn: vi.fn(), error: vi.fn() };
  return createFileHttpHandlers(createFileUploadUseCases(providers, { logger }), { authorize, logger });
}

function uploadRequest(content: string | Uint8Array, name = "notes.txt") {
  const form = new FormData();
  form.set("file", new File([content as BlobPart], name, { type: "text/plain" }));
  return new Request(`${BASE}/memory`, { method: "POST", body: form });
}

async function upload(http: ReturnType<typeof setup>, content: string): Promise<FileDto> {
  const response = await http.uploadFile(uploadRequest(content), { provider: "memory" });
  expect(response.status).toBe(201);
  return ((await response.json()) as { file: FileDto }).file;
}

describe("file HTTP handlers", () => {
  it("uploads multipart files and lists them", async () => {
    const http = setup();
    const file = await upload(http, "hello");

    const list = await http.listFiles(new Request(`${BASE}/memory`), { provider: "memory" });
    expect(await list.json()).toMatchObject({ items: [{ id: file.id, name: "notes.txt", size: 5 }], nextCursor: null });
  });

  it("maps domain errors to status codes", async () => {
    const http = setup();
    const notMultipart = new Request(`${BASE}/memory`, { method: "POST", body: "x", headers: { "content-type": "text/plain" } });

    expect((await http.uploadFile(notMultipart, { provider: "memory" })).status).toBe(400);
    expect((await http.uploadFile(uploadRequest("x".repeat(MAX_BYTES + 1)), { provider: "memory" })).status).toBe(413);
    expect((await http.uploadFile(uploadRequest(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), { provider: "memory" })).status).toBe(415);
    expect((await http.listFiles(new Request(`${BASE}/nope`), { provider: "nope" })).status).toBe(404);
    expect(await (await http.getFile(new Request(BASE), { provider: "memory", id: "missing" })).json()).toEqual({
      error: { code: "FILE_NOT_FOUND", message: 'File "missing" was not found in "memory".' },
    });
  });

  it("enforces the size limit while streaming, even without Content-Length", async () => {
    const http = setup();
    const huge = new Uint8Array(MAX_BYTES * 64).fill(65);
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('--b\r\nContent-Disposition: form-data; name="file"; filename="a.txt"\r\n\r\n'));
        controller.enqueue(huge);
        controller.close();
      },
    });
    const request = new Request(`${BASE}/memory`, {
      method: "POST",
      body,
      headers: { "content-type": "multipart/form-data; boundary=b" },
      duplex: "half",
    } as RequestInit);

    expect((await http.uploadFile(request, { provider: "memory" })).status).toBe(413);
  });

  it("serves content with validators, ranges and HEAD", async () => {
    const http = setup();
    const file = await upload(http, "0123456789");
    const ref = { provider: "memory", id: file.id };

    const full = await http.getContent(new Request(`${BASE}/memory/${file.id}/content`), ref);
    expect(full.status).toBe(200);
    expect(await full.text()).toBe("0123456789");
    expect(full.headers.get("accept-ranges")).toBe("bytes");
    expect(full.headers.get("x-content-type-options")).toBe("nosniff");
    expect(full.headers.get("content-disposition")).toBe(`inline; filename="notes.txt"; filename*=UTF-8''notes.txt`);
    const etag = full.headers.get("etag")!;

    const cached = await http.getContent(new Request(BASE, { headers: { "if-none-match": etag } }), ref);
    expect(cached.status).toBe(304);

    const partial = await http.getContent(new Request(BASE, { headers: { range: "bytes=2-5" } }), ref);
    expect(partial.status).toBe(206);
    expect(partial.headers.get("content-range")).toBe("bytes 2-5/10");
    expect(await partial.text()).toBe("2345");

    const outside = await http.getContent(new Request(BASE, { headers: { range: "bytes=50-" } }), ref);
    expect(outside.status).toBe(416);
    expect(outside.headers.get("content-range")).toBe("bytes */10");

    const head = await http.getContent(new Request(BASE, { method: "HEAD" }), ref);
    expect(head.headers.get("content-length")).toBe("10");
    expect(head.body).toBeNull();
  });

  it("lets the host reject requests before any work happens", async () => {
    const authorize = vi.fn(() => new Response(null, { status: 401 }));
    const http = setup(authorize);

    expect((await http.uploadFile(uploadRequest("hi"), { provider: "memory" })).status).toBe(401);
    expect(authorize).toHaveBeenCalledWith(expect.any(Request), "files.upload", { provider: "memory" });
  });
});

describe("header parsers", () => {
  it("parses single byte ranges and ignores the rest", () => {
    expect(parseRangeHeader("bytes=0-99")).toEqual({ start: 0, end: 99 });
    expect(parseRangeHeader("bytes=100-")).toEqual({ start: 100 });
    expect(parseRangeHeader("bytes=-50")).toEqual({ suffixLength: 50 });
    expect(parseRangeHeader("bytes=0-1,5-9")).toBeUndefined();
    expect(parseRangeHeader("items=0-1")).toBeUndefined();
  });

  it("honours q=0 in Accept-Encoding", () => {
    expect(parseAcceptEncoding("gzip, deflate, br, zstd")).toEqual(["br"]);
    expect(parseAcceptEncoding("br;q=0, gzip")).toEqual([]);
    expect(parseAcceptEncoding(null)).toEqual([]);
  });

  it("compares entity tags weakly", () => {
    expect(parseIfNoneMatch('W/"abc", "def"')).toEqual(["abc", "def"]);
    expect(parseIfNoneMatch("*")).toEqual(["*"]);
  });
});
