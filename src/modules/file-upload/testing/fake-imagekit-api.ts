/**
 * An in-memory stand-in for the ImageKit REST API, injected as `fetch`.
 * Implements just the endpoints `ImageKitClient` calls, with ImageKit's
 * response shapes, so adapter tests run offline and deterministically.
 */
import type { ImageKitFile } from "../infrastructure/imagekit/imagekit-client";

export class FakeImageKitApi {
  readonly files = new Map<string, ImageKitFile>();
  readonly requests: Request[] = [];
  private sequence = 0;

  constructor(private readonly privateKey: string) {}

  /** Adds a file directly, e.g. one that belongs to another application's folder. */
  seed(file: Partial<ImageKitFile> & Pick<ImageKitFile, "filePath">): ImageKitFile {
    const created = this.create(file.filePath, file.size ?? 1, file.mime ?? "text/plain");
    return created;
  }

  readonly fetch: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    this.requests.push(request.clone());

    const expected = `Basic ${Buffer.from(`${this.privateKey}:`).toString("base64")}`;
    if (request.headers.get("authorization") !== expected) {
      return Response.json({ message: "Your account cannot be authenticated." }, { status: 401 });
    }

    const url = new URL(request.url);
    const detailsMatch = /^\/v1\/files\/([^/]+)\/details$/.exec(url.pathname);
    const fileMatch = /^\/v1\/files\/([^/]+)$/.exec(url.pathname);

    if (request.method === "POST" && url.pathname === "/api/v1/files/upload") {
      const form = await request.formData();
      const blob = form.get("file") as File;
      const folder = String(form.get("folder"));
      const file = this.create(`${folder}/${form.get("fileName")}`, blob.size, blob.type);
      // Like the real API, the upload response carries neither `mime` nor `createdAt`.
      return Response.json({ ...file, mime: undefined, createdAt: undefined });
    }
    if (request.method === "GET" && url.pathname === "/v1/files") {
      const path = url.searchParams.get("path") ?? "/";
      const skip = Number(url.searchParams.get("skip"));
      const limit = Number(url.searchParams.get("limit"));
      const matching = [...this.files.values()]
        .filter((file) => file.filePath.startsWith(`${path}/`))
        .sort((a, b) => b.createdAt!.localeCompare(a.createdAt!));
      return Response.json(matching.slice(skip, skip + limit));
    }
    if (request.method === "GET" && detailsMatch) {
      const file = this.files.get(detailsMatch[1]);
      return file ? Response.json(file) : Response.json({ message: "The requested file does not exist." }, { status: 404 });
    }
    if (request.method === "DELETE" && fileMatch) {
      return this.files.delete(fileMatch[1])
        ? new Response(null, { status: 204 })
        : Response.json({ message: "The requested file does not exist." }, { status: 404 });
    }
    return Response.json({ message: "Not implemented by the fake." }, { status: 501 });
  };

  private create(filePath: string, size: number, mime: string): ImageKitFile {
    this.sequence += 1;
    const fileId = `fake${String(this.sequence).padStart(20, "0")}`;
    const file: ImageKitFile = {
      fileId,
      name: filePath.split("/").pop()!,
      filePath,
      url: `https://ik.imagekit.io/demo${filePath}`,
      fileType: mime.startsWith("image/") ? "image" : "non-image",
      size,
      mime,
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, this.sequence)).toISOString(),
    };
    this.files.set(fileId, file);
    return file;
  }
}
