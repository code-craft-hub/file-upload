/**
 * Ports: the interfaces the application layer depends on and the
 * infrastructure layer implements. Use cases only ever see these types, which
 * is what makes providers swappable and the use cases testable with fakes.
 *
 * Capabilities are split into separate interfaces (interface segregation):
 * every provider must store files, but only some serve bytes themselves or can
 * report usage.
 */
import type { ByteRange } from "../domain/byte-range";
import type { ContentEncoding, FilePage, ProviderId, StorageUsage, StoredFile } from "../domain/stored-file";
import type { UploadPolicy } from "../domain/upload-policy";

/** A validated file, ready to be persisted exactly as given. */
export interface PreparedUpload {
  readonly name: string;
  readonly contentType: string;
  readonly bytes: Uint8Array;
  /** Byte size of the file the user sent, before any optimisation. */
  readonly originalSize: number;
  readonly width?: number;
  readonly height?: number;
}

export interface ListFilesQuery {
  readonly limit: number;
  readonly cursor?: string;
}

/** Required capability: persist, look up, list and remove files. */
export interface FileStorage {
  save(upload: PreparedUpload): Promise<StoredFile>;
  find(id: string): Promise<StoredFile | null>;
  /** Newest first. */
  list(query: ListFilesQuery): Promise<FilePage>;
  /** @returns `false` when no file with this id exists. */
  delete(id: string): Promise<boolean>;
}

/** Optional capability: the provider serves bytes through this application. */
export interface FileContentReader {
  get(id: string): Promise<FileContent | null>;
}

export interface FileContent {
  readonly file: StoredFile;
  /** Opaque, stable identifier of the content (e.g. a hash). Used for HTTP caching. */
  readonly version: string;
  readonly storedEncoding: ContentEncoding;
  readonly storedBytes: number;
  /**
   * Opens the byte stream. Implementations must be lazy: nothing is read from
   * storage until the stream is pulled, so an unconsumed stream costs nothing.
   */
  open(request: ContentStreamRequest): ReadableStream<Uint8Array>;
}

export interface ContentStreamRequest {
  /** Encoding of the bytes to emit. Either `identity` or the stored encoding. */
  readonly encoding: ContentEncoding;
  /** Inclusive range of the decoded content. Only valid for identity-stored content. */
  readonly range?: ByteRange;
}

/** Optional capability: report aggregate storage numbers. */
export interface StorageUsageReader {
  usage(): Promise<StorageUsage>;
}

/** Re-encodes images into a smaller representation. */
export interface ImageOptimizer {
  canOptimize(contentType: string): boolean;
  optimize(image: { readonly bytes: Uint8Array; readonly contentType: string }): Promise<OptimizedImage>;
}

export interface OptimizedImage {
  readonly bytes: Uint8Array;
  readonly contentType: string;
  readonly width: number;
  readonly height: number;
}

/** A configured provider: identity, rules, and the capabilities it offers. */
export interface StorageProvider {
  readonly id: ProviderId;
  readonly label: string;
  readonly description: string;
  readonly policy: UploadPolicy;
  readonly files: FileStorage;
  readonly content?: FileContentReader;
  readonly usage?: StorageUsageReader;
}

export interface Logger {
  warn(message: string, details?: Record<string, unknown>): void;
  error(message: string, details?: Record<string, unknown>): void;
}
