/**
 * Every failure the module expects is a {@link FileUploadError} with a stable
 * machine-readable `code`. The HTTP layer maps codes to status codes; nothing
 * in the domain or application layers knows about HTTP.
 */

export type FileUploadErrorCode =
  | "EMPTY_FILE"
  | "FILE_TOO_LARGE"
  | "UNSUPPORTED_FILE_TYPE"
  | "FILE_NOT_FOUND"
  | "PROVIDER_NOT_FOUND"
  | "INVALID_REQUEST"
  | "RANGE_NOT_SATISFIABLE"
  | "STORAGE_UNAVAILABLE";

export abstract class FileUploadError extends Error {
  abstract readonly code: FileUploadErrorCode;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class EmptyFileError extends FileUploadError {
  readonly code = "EMPTY_FILE";

  constructor() {
    super("The file is empty.");
  }
}

export class FileTooLargeError extends FileUploadError {
  readonly code = "FILE_TOO_LARGE";

  constructor(readonly maxBytes: number) {
    super(`The file exceeds the ${formatMegabytes(maxBytes)} limit.`);
  }
}

export class UnsupportedFileTypeError extends FileUploadError {
  readonly code = "UNSUPPORTED_FILE_TYPE";

  constructor(readonly contentType: string) {
    super(`Files of type "${contentType}" are not accepted.`);
  }
}

export class FileNotFoundError extends FileUploadError {
  readonly code = "FILE_NOT_FOUND";

  constructor(
    readonly provider: string,
    readonly fileId: string,
  ) {
    super(`File "${fileId}" was not found in "${provider}".`);
  }
}

export class ProviderNotFoundError extends FileUploadError {
  readonly code = "PROVIDER_NOT_FOUND";

  constructor(readonly provider: string) {
    super(`Storage provider "${provider}" is not configured.`);
  }
}

export class InvalidRequestError extends FileUploadError {
  readonly code = "INVALID_REQUEST";
}

export class RangeNotSatisfiableError extends FileUploadError {
  readonly code = "RANGE_NOT_SATISFIABLE";

  constructor(readonly size: number) {
    super("The requested byte range is outside the file.");
  }
}

/** An upstream provider failed (network error, 5xx, misconfiguration). */
export class StorageUnavailableError extends FileUploadError {
  readonly code = "STORAGE_UNAVAILABLE";
}

function formatMegabytes(bytes: number): string {
  return `${Math.round((bytes / 1_000_000) * 10) / 10} MB`;
}
