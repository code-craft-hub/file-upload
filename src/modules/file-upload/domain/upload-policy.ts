import { EmptyFileError, FileTooLargeError, UnsupportedFileTypeError } from "./errors";

/** The business rules a provider applies to incoming files. */
export interface UploadPolicy {
  readonly maxFileSizeBytes: number;
  /** Accepted MIME types. A `type/*` entry accepts the whole family. */
  readonly allowedContentTypes: readonly string[];
  /**
   * Re-encode raster images to a smaller format before storing them.
   * Worth it when you pay for every stored byte (e.g. a database); usually not
   * when the provider transforms images on delivery (e.g. an image CDN).
   */
  readonly optimizeImages: boolean;
}

/** 25 MB, in the decimal units the UI displays. */
export const DEFAULT_MAX_FILE_SIZE_BYTES = 25_000_000;

/**
 * Conservative defaults: common media and documents. Anything executable or
 * renderable as a web page (HTML, JS) is excluded on purpose.
 */
export const DEFAULT_ALLOWED_CONTENT_TYPES: readonly string[] = [
  "image/*",
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "audio/mpeg",
  "audio/mp4",
  "audio/wav",
  "audio/ogg",
  "application/pdf",
  "application/json",
  "application/zip",
  "text/plain",
  "text/csv",
  "text/markdown",
];

export function assertFileSizeAllowed(policy: UploadPolicy, size: number): void {
  if (size === 0) throw new EmptyFileError();
  if (size > policy.maxFileSizeBytes) throw new FileTooLargeError(policy.maxFileSizeBytes);
}

export function assertContentTypeAllowed(policy: UploadPolicy, contentType: string): void {
  if (!isContentTypeAllowed(policy.allowedContentTypes, contentType)) {
    throw new UnsupportedFileTypeError(contentType);
  }
}

export function isContentTypeAllowed(allowed: readonly string[], contentType: string): boolean {
  const type = contentType.toLowerCase();
  return allowed.some((pattern) => {
    const rule = pattern.toLowerCase();
    return rule.endsWith("/*") ? type.startsWith(rule.slice(0, -1)) : type === rule;
  });
}
