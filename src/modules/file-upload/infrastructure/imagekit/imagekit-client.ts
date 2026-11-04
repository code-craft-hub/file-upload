/**
 * A deliberately small client for the four ImageKit REST endpoints we use.
 *
 * Why not the official SDK? These endpoints have been stable for years, the
 * SDK's package name and API have changed across majors, and a ~100-line
 * client keeps the adapter dependency-free with an injectable `fetch` for
 * tests. Swapping in the SDK is a change local to this file.
 *
 * Docs: https://imagekit.io/docs/api-reference
 */
import { StorageUnavailableError } from "../../domain/errors";

export interface ImageKitClientOptions {
  readonly privateKey: string;
  readonly fetch?: typeof fetch;
  readonly uploadApiUrl?: string;
  readonly managementApiUrl?: string;
  readonly timeoutMs?: number;
}

/** The subset of ImageKit's file object this module reads. */
export interface ImageKitFile {
  readonly fileId: string;
  readonly name: string;
  readonly filePath: string;
  readonly url: string;
  readonly fileType: "image" | "non-image";
  readonly size: number;
  readonly mime?: string;
  readonly width?: number;
  readonly height?: number;
  readonly createdAt?: string;
}

export interface ImageKitUpload {
  readonly bytes: Uint8Array;
  readonly contentType: string;
  readonly fileName: string;
  readonly folder: string;
}

export interface ImageKitListQuery {
  readonly path: string;
  readonly limit: number;
  readonly skip: number;
}

export class ImageKitClient {
  private readonly fetch: typeof fetch;
  private readonly authorization: string;
  private readonly uploadApiUrl: string;
  private readonly managementApiUrl: string;
  private readonly timeoutMs: number;

  constructor(options: ImageKitClientOptions) {
    this.fetch = options.fetch ?? globalThis.fetch;
    // ImageKit uses HTTP Basic auth: the private key is the username, the password is empty.
    this.authorization = `Basic ${Buffer.from(`${options.privateKey}:`).toString("base64")}`;
    this.uploadApiUrl = options.uploadApiUrl ?? "https://upload.imagekit.io/api/v1";
    this.managementApiUrl = options.managementApiUrl ?? "https://api.imagekit.io/v1";
    this.timeoutMs = options.timeoutMs ?? 60_000;
  }

  async upload(upload: ImageKitUpload): Promise<ImageKitFile> {
    const form = new FormData();
    form.set("file", new Blob([upload.bytes as BlobPart], { type: upload.contentType }), upload.fileName);
    form.set("fileName", upload.fileName);
    form.set("folder", upload.folder);
    form.set("useUniqueFileName", "true");
    const response = await this.request(`${this.uploadApiUrl}/files/upload`, { method: "POST", body: form });
    return (await response.json()) as ImageKitFile;
  }

  async listFiles(query: ImageKitListQuery): Promise<ImageKitFile[]> {
    const params = new URLSearchParams({
      type: "file",
      path: query.path,
      sort: "DESC_CREATED",
      limit: String(query.limit),
      skip: String(query.skip),
    });
    const response = await this.request(`${this.managementApiUrl}/files?${params}`, { method: "GET" });
    return (await response.json()) as ImageKitFile[];
  }

  /** @returns `null` when the file does not exist. */
  async getFile(fileId: string): Promise<ImageKitFile | null> {
    const response = await this.request(`${this.managementApiUrl}/files/${encodeURIComponent(fileId)}/details`, {
      method: "GET",
      allowNotFound: true,
    });
    return response ? ((await response.json()) as ImageKitFile) : null;
  }

  /** @returns `false` when the file does not exist. */
  async deleteFile(fileId: string): Promise<boolean> {
    const response = await this.request(`${this.managementApiUrl}/files/${encodeURIComponent(fileId)}`, {
      method: "DELETE",
      allowNotFound: true,
    });
    return response !== null;
  }

  private request(url: string, init: RequestInit & { allowNotFound: true }): Promise<Response | null>;
  private request(url: string, init: RequestInit): Promise<Response>;
  private async request(url: string, { allowNotFound, ...init }: RequestInit & { allowNotFound?: boolean }) {
    let response: Response;
    try {
      response = await this.fetch(url, {
        ...init,
        headers: { authorization: this.authorization, accept: "application/json" },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (cause) {
      throw new StorageUnavailableError("ImageKit could not be reached.", { cause });
    }

    if (response.status === 404 && allowNotFound) return null;
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { message?: string } | null;
      throw new StorageUnavailableError(`ImageKit responded ${response.status}: ${body?.message ?? response.statusText}`);
    }
    return response;
  }
}
