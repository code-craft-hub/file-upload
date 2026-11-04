import { createHash, randomUUID } from "node:crypto";
import type { FileContent, FileContentReader, FileStorage, ListFilesQuery, PreparedUpload } from "../../application/ports";
import { InvalidRequestError } from "../../domain/errors";
import type { FilePage, StoredFile } from "../../domain/stored-file";
import { toReadableStream } from "../streams";

interface Entry {
  readonly file: StoredFile;
  readonly bytes: Uint8Array;
}

/**
 * The smallest complete provider: a reference for anyone writing a new adapter,
 * and the fake used by use-case and HTTP tests. Not for production — contents
 * live in process memory.
 */
export class InMemoryFileStorage implements FileStorage, FileContentReader {
  private readonly entries = new Map<string, Entry>();
  private readonly order: string[] = [];

  constructor(private readonly providerId = "memory") {}

  async save(upload: PreparedUpload): Promise<StoredFile> {
    const id = randomUUID();
    const file: StoredFile = {
      id,
      provider: this.providerId,
      name: upload.name,
      contentType: upload.contentType,
      size: upload.bytes.byteLength,
      originalSize: upload.originalSize,
      url: `/files/${this.providerId}/${id}/content`,
      width: upload.width,
      height: upload.height,
      createdAt: new Date(),
    };
    this.entries.set(id, { file, bytes: upload.bytes });
    this.order.unshift(id);
    return file;
  }

  async find(id: string): Promise<StoredFile | null> {
    return this.entries.get(id)?.file ?? null;
  }

  async list({ limit, cursor }: ListFilesQuery): Promise<FilePage> {
    const start = cursor === undefined ? 0 : Number(cursor);
    if (!Number.isSafeInteger(start) || start < 0) throw new InvalidRequestError("Invalid cursor.");
    const ids = this.order.slice(start, start + limit);
    return {
      items: ids.map((id) => this.entries.get(id)!.file),
      nextCursor: start + limit < this.order.length ? String(start + limit) : null,
    };
  }

  async delete(id: string): Promise<boolean> {
    if (!this.entries.delete(id)) return false;
    this.order.splice(this.order.indexOf(id), 1);
    return true;
  }

  async get(id: string): Promise<FileContent | null> {
    const entry = this.entries.get(id);
    if (!entry) return null;
    return {
      file: entry.file,
      version: createHash("sha256").update(entry.bytes).digest("hex"),
      storedEncoding: "identity",
      storedBytes: entry.bytes.byteLength,
      open: ({ range }) => {
        const bytes = range ? entry.bytes.subarray(range.start, range.end + 1) : entry.bytes;
        return toReadableStream((async function* () { yield bytes; })());
      },
    };
  }
}
