/**
 * The behaviour every `FileStorage` adapter must have. Run it against a new
 * adapter before registering it:
 *
 *   describeFileStorageContract("S3", async () => ({ storage: new S3FileStorage(...) }));
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { FileStorage, PreparedUpload } from "../application/ports";

/** A syntactically valid id that no adapter will have issued. */
export const UNKNOWN_FILE_ID = "00000000-0000-7000-8000-000000000000";

export function preparedUpload(name: string, text: string, contentType = "text/plain"): PreparedUpload {
  const bytes = new TextEncoder().encode(text);
  return { name, contentType, bytes, originalSize: bytes.byteLength };
}

export function describeFileStorageContract(name: string, setup: () => Promise<{ storage: FileStorage }>): void {
  describe(`${name} — FileStorage contract`, () => {
    let storage: FileStorage;

    beforeEach(async () => {
      ({ storage } = await setup());
    });

    it("saves a file and finds it by id", async () => {
      const saved = await storage.save(preparedUpload("hello.txt", "hello world"));

      expect(saved).toMatchObject({ name: "hello.txt", contentType: "text/plain", size: 11 });
      expect(saved.url).toBeTruthy();
      expect(saved.createdAt).toBeInstanceOf(Date);
      expect(await storage.find(saved.id)).toMatchObject({ id: saved.id, name: "hello.txt", size: 11 });
    });

    it("returns null for an unknown id", async () => {
      expect(await storage.find(UNKNOWN_FILE_ID)).toBeNull();
    });

    it("lists newest first, with cursor pagination", async () => {
      const first = await storage.save(preparedUpload("1.txt", "one"));
      const second = await storage.save(preparedUpload("2.txt", "two"));
      const third = await storage.save(preparedUpload("3.txt", "three"));

      const page1 = await storage.list({ limit: 2 });
      expect(page1.items.map((file) => file.id)).toEqual([third.id, second.id]);
      expect(page1.nextCursor).not.toBeNull();

      const page2 = await storage.list({ limit: 2, cursor: page1.nextCursor! });
      expect(page2.items.map((file) => file.id)).toEqual([first.id]);
      expect(page2.nextCursor).toBeNull();
    });

    it("deletes a file, and reports when there was nothing to delete", async () => {
      const saved = await storage.save(preparedUpload("bye.txt", "bye"));

      expect(await storage.delete(saved.id)).toBe(true);
      expect(await storage.find(saved.id)).toBeNull();
      expect(await storage.delete(saved.id)).toBe(false);
    });
  });
}
