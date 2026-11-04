/** Typed browser client for the module's HTTP API. */
import type { ErrorDto, FileDto, FilePageDto, UsageDto } from "../http/dto";

export class FilesApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = "FilesApiError";
  }
}

export interface UploadOptions {
  readonly onProgress?: (loaded: number, total: number) => void;
  readonly signal?: AbortSignal;
}

export interface FilesApiClient {
  listFiles(provider: string, options?: { cursor?: string | null; limit?: number; signal?: AbortSignal }): Promise<FilePageDto>;
  getUsage(provider: string, signal?: AbortSignal): Promise<UsageDto>;
  deleteFile(provider: string, id: string): Promise<void>;
  uploadFile(provider: string, file: File, options?: UploadOptions): Promise<FileDto>;
}

export function createFilesApiClient(basePath = "/api/files"): FilesApiClient {
  const providerUrl = (provider: string) => `${basePath}/${encodeURIComponent(provider)}`;

  return {
    async listFiles(provider, { cursor, limit, signal } = {}) {
      const params = new URLSearchParams();
      if (cursor) params.set("cursor", cursor);
      if (limit) params.set("limit", String(limit));
      return request<FilePageDto>(`${providerUrl(provider)}?${params}`, { signal });
    },
    async getUsage(provider, signal) {
      return (await request<{ usage: UsageDto }>(`${providerUrl(provider)}/usage`, { signal })).usage;
    },
    async deleteFile(provider, id) {
      await request<void>(`${providerUrl(provider)}/${encodeURIComponent(id)}`, { method: "DELETE" });
    },
    uploadFile(provider, file, options) {
      return uploadWithProgress(providerUrl(provider), file, options);
    },
  };
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { accept: "application/json" } });
  if (!response.ok) throw toApiError(response.status, await response.json().catch(() => null));
  return (response.status === 204 ? undefined : await response.json()) as T;
}

/** `fetch` still exposes no upload progress, so uploads use XHR. */
function uploadWithProgress(url: string, file: File, { onProgress, signal }: UploadOptions = {}): Promise<FileDto> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("Upload cancelled.", "AbortError"));

    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.responseType = "json";
    xhr.setRequestHeader("accept", "application/json");
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded, event.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve((xhr.response as { file: FileDto }).file);
      else reject(toApiError(xhr.status, xhr.response));
    };
    xhr.onerror = () => reject(new FilesApiError("Network error. Check your connection.", 0, "NETWORK_ERROR"));
    xhr.onabort = () => reject(new DOMException("Upload cancelled.", "AbortError"));
    signal?.addEventListener("abort", () => xhr.abort(), { once: true });

    const form = new FormData();
    form.set("file", file);
    xhr.send(form);
  });
}

function toApiError(status: number, body: unknown): FilesApiError {
  const error = (body as Partial<ErrorDto> | null)?.error;
  return new FilesApiError(error?.message ?? `Request failed (${status}).`, status, error?.code ?? "UNKNOWN");
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
