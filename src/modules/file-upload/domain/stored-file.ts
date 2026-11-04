/**
 * The module's core vocabulary.
 *
 * Everything here is a plain, serialisable value with no behaviour and no
 * dependencies: storage providers produce these values, use cases return them,
 * and the HTTP layer maps them to JSON.
 */

/** Identifies a configured storage provider, e.g. `"postgres"` or `"imagekit"`. */
export type ProviderId = string;

/** How content bytes are encoded at rest. `identity` means "as is". */
export type ContentEncoding = "identity" | "br";

/** A file that has been accepted and persisted by a storage provider. */
export interface StoredFile {
  /** Provider-scoped identifier. Unique only within {@link StoredFile.provider}. */
  readonly id: string;
  readonly provider: ProviderId;
  /** Display name, also used as the download file name. */
  readonly name: string;
  /** MIME type of the content as served. */
  readonly contentType: string;
  /** Size in bytes of the content as served (decoded). */
  readonly size: number;
  /**
   * Size in bytes of what the user originally uploaded, when the provider
   * knows it. Differs from `size` when the file was optimised on upload.
   */
  readonly originalSize?: number;
  /** Absolute or root-relative URL the content can be fetched from. */
  readonly url: string;
  /** A small preview for images, when the provider can produce one cheaply. */
  readonly thumbnailUrl?: string;
  readonly width?: number;
  readonly height?: number;
  readonly createdAt: Date;
  /** Physical storage footprint, for providers that can report it. */
  readonly footprint?: StorageFootprint;
}

/** What a file actually costs at rest. */
export interface StorageFootprint {
  /** Bytes physically stored for this content, after compression. */
  readonly storedBytes: number;
  readonly encoding: ContentEncoding;
  /** How many files reference the same physical content (always ≥ 1). */
  readonly sharedBy: number;
}

/** One page of a newest-first file listing. */
export interface FilePage {
  readonly items: readonly StoredFile[];
  /** Opaque cursor for the next page, or `null` when there are no more items. */
  readonly nextCursor: string | null;
}

/** Aggregate storage numbers for a provider. */
export interface StorageUsage {
  readonly fileCount: number;
  /** Sum of the sizes users uploaded. */
  readonly uploadedBytes: number;
  /** Sum of the sizes users download (after optimisation). */
  readonly logicalBytes: number;
  /** Unique bytes actually stored, after deduplication and compression. */
  readonly storedBytes: number;
  /** Total on-disk size including indexes and storage overhead, when measurable. */
  readonly onDiskBytes?: number;
}
