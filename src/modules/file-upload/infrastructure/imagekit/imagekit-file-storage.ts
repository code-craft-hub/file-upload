import type { FileStorage, ListFilesQuery, PreparedUpload } from "../../application/ports";
import { InvalidRequestError } from "../../domain/errors";
import type { FilePage, StoredFile } from "../../domain/stored-file";
import type { ImageKitClient, ImageKitFile } from "./imagekit-client";

export interface ImageKitFileStorageOptions {
  readonly providerId: string;
  /**
   * Every file this module creates lives under this folder, and the module
   * refuses to read or delete anything outside it. One ImageKit account can
   * therefore be shared with other applications safely.
   */
  readonly folder: string;
  /** ImageKit URL transformation for previews. */
  readonly thumbnailTransformation?: string;
}

const DEFAULT_THUMBNAIL_TRANSFORMATION = "w-480,h-480,c-at_max,q-80";
const FILE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * ImageKit as a {@link FileStorage}. ImageKit is both store and CDN, so this
 * adapter does not implement `FileContentReader`: clients fetch bytes from the
 * CDN URL directly, and the HTTP layer redirects there when asked.
 */
export class ImageKitFileStorage implements FileStorage {
  private readonly folder: string;
  private readonly thumbnailTransformation: string;

  constructor(
    private readonly client: ImageKitClient,
    private readonly options: ImageKitFileStorageOptions,
  ) {
    this.folder = `/${options.folder.replace(/^\/+|\/+$/g, "")}`;
    this.thumbnailTransformation = options.thumbnailTransformation ?? DEFAULT_THUMBNAIL_TRANSFORMATION;
  }

  async save(upload: PreparedUpload): Promise<StoredFile> {
    const file = await this.client.upload({
      bytes: upload.bytes,
      contentType: upload.contentType,
      fileName: upload.name,
      folder: this.folder,
    });
    // The upload response omits some fields that listings include; fill them from what we sent.
    return this.toStoredFile({ ...file, mime: file.mime ?? upload.contentType }, new Date());
  }

  async find(id: string): Promise<StoredFile | null> {
    const file = await this.findOwned(id);
    return file ? this.toStoredFile(file) : null;
  }

  async list({ limit, cursor }: ListFilesQuery): Promise<FilePage> {
    const skip = cursor === undefined ? 0 : Number(cursor);
    if (!Number.isSafeInteger(skip) || skip < 0) throw new InvalidRequestError("Invalid cursor.");

    const items = await this.client.listFiles({ path: this.folder, limit: limit + 1, skip });
    const page = items.slice(0, limit);
    return {
      items: page.map((file) => this.toStoredFile(file)),
      nextCursor: items.length > limit ? String(skip + limit) : null,
    };
  }

  async delete(id: string): Promise<boolean> {
    // Look before deleting so ids outside our folder are treated as missing.
    if (!(await this.findOwned(id))) return false;
    return this.client.deleteFile(id);
  }

  private async findOwned(id: string): Promise<ImageKitFile | null> {
    if (!FILE_ID_PATTERN.test(id)) return null;
    const file = await this.client.getFile(id);
    return file && file.filePath.startsWith(`${this.folder}/`) ? file : null;
  }

  private toStoredFile(file: ImageKitFile, fallbackCreatedAt?: Date): StoredFile {
    const isImage = file.fileType === "image";
    return {
      id: file.fileId,
      provider: this.options.providerId,
      name: file.name,
      contentType: file.mime ?? "application/octet-stream",
      size: file.size,
      url: file.url,
      thumbnailUrl: isImage ? withTransformation(file.url, this.thumbnailTransformation) : undefined,
      width: file.width || undefined,
      height: file.height || undefined,
      createdAt: file.createdAt ? new Date(file.createdAt) : (fallbackCreatedAt ?? new Date(0)),
    };
  }
}

function withTransformation(url: string, transformation: string): string {
  const target = new URL(url);
  target.searchParams.set("tr", transformation);
  return target.toString();
}
