import { describe, expect, it } from "vitest";
import { StorageUnavailableError } from "../../domain/errors";
import { FakeImageKitApi } from "../../testing/fake-imagekit-api";
import { describeFileStorageContract, preparedUpload } from "../../testing/file-storage-contract";
import { ImageKitClient } from "./imagekit-client";
import { ImageKitFileStorage } from "./imagekit-file-storage";

function setup(privateKey = "private_test_key") {
  const api = new FakeImageKitApi("private_test_key");
  const client = new ImageKitClient({ privateKey, fetch: api.fetch });
  const storage = new ImageKitFileStorage(client, { providerId: "imagekit", folder: "/file-upload/" });
  return { api, storage };
}

describeFileStorageContract("ImageKitFileStorage", async () => setup());

describe("ImageKitFileStorage", () => {
  it("uploads into the configured folder with unique names", async () => {
    const { api, storage } = setup();
    await storage.save(preparedUpload("a.txt", "abc"));

    const upload = api.requests.find((request) => request.url.endsWith("/files/upload"))!;
    const form = await upload.formData();
    expect(form.get("folder")).toBe("/file-upload");
    expect(form.get("useUniqueFileName")).toBe("true");
  });

  it("adds a CDN thumbnail transformation for images only", async () => {
    const { storage } = setup();
    const image = await storage.save({ ...preparedUpload("p.png", "x"), contentType: "image/png" });
    const text = await storage.save(preparedUpload("t.txt", "x"));

    expect(image.thumbnailUrl).toBe("https://ik.imagekit.io/demo/file-upload/p.png?tr=w-480%2Ch-480%2Cc-at_max%2Cq-80");
    expect(text.thumbnailUrl).toBeUndefined();
  });

  it("refuses to read or delete files outside its folder", async () => {
    const { api, storage } = setup();
    const foreign = api.seed({ filePath: "/another-app/invoice.pdf" });

    expect(await storage.find(foreign.fileId)).toBeNull();
    expect(await storage.delete(foreign.fileId)).toBe(false);
    expect(api.files.has(foreign.fileId)).toBe(true);
  });

  it("surfaces upstream failures as StorageUnavailableError", async () => {
    const { storage } = setup("wrong_key");
    await expect(storage.list({ limit: 10 })).rejects.toBeInstanceOf(StorageUnavailableError);
  });
});
