import { describe, expect, it, vi } from "vitest";
import { EmptyFileError, FileTooLargeError, UnsupportedFileTypeError } from "../../domain/errors";
import type { UploadPolicy } from "../../domain/upload-policy";
import { InMemoryFileStorage } from "../../infrastructure/memory/in-memory-file-storage";
import type { ImageOptimizer, Logger } from "../ports";
import { ProviderRegistry } from "../provider-registry";
import { UploadFile } from "./upload-file";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(96).fill(7)]);

function setup(options: { policy?: Partial<UploadPolicy>; optimizer?: ImageOptimizer } = {}) {
  const storage = new InMemoryFileStorage("test");
  const policy: UploadPolicy = { maxFileSizeBytes: 1000, allowedContentTypes: ["image/*", "text/plain"], optimizeImages: true, ...options.policy };
  const registry = new ProviderRegistry([{ id: "test", label: "Test", description: "", policy, files: storage }]);
  const logger: Logger = { warn: vi.fn(), error: vi.fn() };
  return { storage, logger, uploadFile: new UploadFile(registry, options.optimizer, logger) };
}

function fakeOptimizer(result: Partial<{ size: number; fail: boolean }>): ImageOptimizer {
  return {
    canOptimize: (type) => type === "image/jpeg",
    optimize: async () => {
      if (result.fail) throw new Error("corrupt image");
      return { bytes: new Uint8Array(result.size ?? 10), contentType: "image/webp", width: 64, height: 48 };
    },
  };
}

describe("UploadFile", () => {
  it("rejects empty and oversized files", async () => {
    const { uploadFile } = setup();
    await expect(uploadFile.execute({ provider: "test", fileName: "a.txt", bytes: new Uint8Array() })).rejects.toBeInstanceOf(EmptyFileError);
    await expect(uploadFile.execute({ provider: "test", fileName: "a.txt", bytes: new Uint8Array(1001) })).rejects.toBeInstanceOf(FileTooLargeError);
  });

  it("rejects disallowed types using the sniffed type, not the declared one", async () => {
    const { uploadFile } = setup();
    const html = new TextEncoder().encode("<html><script>steal()</script></html>");
    await expect(
      uploadFile.execute({ provider: "test", fileName: "cute.png", declaredType: "image/png", bytes: html }),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_FILE_TYPE", contentType: "text/html" } satisfies Partial<UnsupportedFileTypeError>);
  });

  it("stores the optimised image when it is smaller", async () => {
    const { uploadFile } = setup({ optimizer: fakeOptimizer({ size: 10 }) });
    const file = await uploadFile.execute({ provider: "test", fileName: "photo.jpg", bytes: JPEG });
    expect(file).toMatchObject({ name: "photo.webp", contentType: "image/webp", size: 10, originalSize: JPEG.byteLength, width: 64, height: 48 });
  });

  it("keeps the original when optimisation would not shrink it", async () => {
    const { uploadFile } = setup({ optimizer: fakeOptimizer({ size: 5000 }) });
    const file = await uploadFile.execute({ provider: "test", fileName: "photo.jpg", bytes: JPEG });
    expect(file).toMatchObject({ name: "photo.jpg", contentType: "image/jpeg", size: JPEG.byteLength });
  });

  it("keeps the original, and logs, when optimisation fails", async () => {
    const { uploadFile, logger } = setup({ optimizer: fakeOptimizer({ fail: true }) });
    const file = await uploadFile.execute({ provider: "test", fileName: "photo.jpg", bytes: JPEG });
    expect(file.contentType).toBe("image/jpeg");
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it("does not optimise when the provider's policy says so", async () => {
    const optimizer = fakeOptimizer({ size: 10 });
    const spy = vi.spyOn(optimizer, "optimize");
    const { uploadFile } = setup({ optimizer, policy: { optimizeImages: false } });
    await uploadFile.execute({ provider: "test", fileName: "photo.jpg", bytes: JPEG });
    expect(spy).not.toHaveBeenCalled();
  });

  it("sanitises the stored name", async () => {
    const { uploadFile } = setup();
    const file = await uploadFile.execute({ provider: "test", fileName: "../../secret‮.txt", bytes: new TextEncoder().encode("hi") });
    expect(file.name).toBe("secret.txt");
  });
});
