import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { DEFAULT_IMAGE_OPTIMIZATION, SharpImageOptimizer } from "./sharp-image-optimizer";

/** A noisy photo-like image, so encoders cannot cheat on flat colour. */
async function photo(width: number, height: number, format: "jpeg" | "png") {
  const noise = Buffer.alloc(width * height * 3);
  for (let i = 0; i < noise.length; i += 1) noise[i] = (i * 2654435761) >>> 24;
  const image = sharp(noise, { raw: { width, height, channels: 3 } }).blur(2);
  return new Uint8Array(format === "jpeg" ? await image.jpeg({ quality: 95 }).toBuffer() : await image.png().toBuffer());
}

describe("SharpImageOptimizer", () => {
  const optimizer = new SharpImageOptimizer();

  it("scales large photos down to the max dimension and re-encodes as WebP", async () => {
    const input = await photo(4000, 2000, "jpeg");
    const output = await optimizer.optimize({ bytes: input, contentType: "image/jpeg" });

    expect(output).toMatchObject({ contentType: "image/webp", width: 2560, height: 1280 });
    expect(output.bytes.byteLength).toBeLessThan(input.byteLength);
    expect((await sharp(output.bytes).metadata()).format).toBe("webp");
  });

  it("never enlarges small images", async () => {
    const output = await optimizer.optimize({ bytes: await photo(320, 200, "png"), contentType: "image/png" });
    expect(output).toMatchObject({ width: 320, height: 200 });
  });

  it("strips metadata such as EXIF GPS", async () => {
    const tagged = await sharp(await photo(64, 64, "jpeg"))
      .withExif({ IFD3: { GPSLatitudeRef: "N", GPSLatitude: "51/1 30/1 0/1" } })
      .jpeg()
      .toBuffer();
    expect((await sharp(tagged).metadata()).exif).toBeDefined();

    const output = await optimizer.optimize({ bytes: new Uint8Array(tagged), contentType: "image/jpeg" });
    expect((await sharp(output.bytes).metadata()).exif).toBeUndefined();
  });

  it("rejects decompression bombs", async () => {
    const strict = new SharpImageOptimizer({ ...DEFAULT_IMAGE_OPTIMIZATION, maxInputPixels: 100 * 100 });
    await expect(strict.optimize({ bytes: await photo(200, 200, "png"), contentType: "image/png" })).rejects.toThrow(/pixel limit/i);
  });

  it("only claims formats it can decode", () => {
    expect(optimizer.canOptimize("image/jpeg")).toBe(true);
    expect(optimizer.canOptimize("image/svg+xml")).toBe(false);
    expect(optimizer.canOptimize("image/heic")).toBe(false);
  });
});
