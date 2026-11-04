import sharp from "sharp";
import type { ImageOptimizer, OptimizedImage } from "../../application/ports";

export interface SharpImageOptimizerOptions {
  /** Longest edge after resizing. Larger images are scaled down, never up. */
  readonly maxDimension: number;
  /** WebP quality for lossy sources (JPEG, lossy WebP, AVIF). */
  readonly quality: number;
  /** libvips CPU effort, 0–6. 4 is the libwebp default speed/size balance. */
  readonly effort: number;
  /** Rejects decompression bombs: a tiny file that decodes to gigapixels. */
  readonly maxInputPixels: number;
}

export const DEFAULT_IMAGE_OPTIMIZATION: SharpImageOptimizerOptions = {
  maxDimension: 2560,
  quality: 80,
  effort: 4,
  maxInputPixels: 100_000_000,
};

const OPTIMIZABLE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif", "image/tiff"]);
/** Sources that are lossless (screenshots, line art, GIFs) stay lossless. */
const LOSSLESS_SOURCES = new Set(["image/png", "image/gif", "image/tiff"]);

/**
 * Re-encodes images to WebP: universally supported, typically 25–35% smaller
 * than JPEG and far smaller than PNG. Also applies EXIF rotation and strips
 * metadata (sharp's default), which removes GPS location from phone photos.
 */
export class SharpImageOptimizer implements ImageOptimizer {
  constructor(private readonly options: SharpImageOptimizerOptions = DEFAULT_IMAGE_OPTIMIZATION) {}

  canOptimize(contentType: string): boolean {
    return OPTIMIZABLE_TYPES.has(contentType);
  }

  async optimize({ bytes, contentType }: { bytes: Uint8Array; contentType: string }): Promise<OptimizedImage> {
    const { maxDimension, quality, effort, maxInputPixels } = this.options;
    const lossless = LOSSLESS_SOURCES.has(contentType);

    const { data, info } = await sharp(bytes, { animated: true, limitInputPixels: maxInputPixels })
      .autoOrient()
      .resize({ width: maxDimension, height: maxDimension, fit: "inside", withoutEnlargement: true })
      .webp(lossless ? { lossless: true, effort } : { quality, effort })
      .toBuffer({ resolveWithObject: true });

    return {
      bytes: data,
      contentType: "image/webp",
      width: info.width,
      // For animations, `height` is all frames stacked; `pageHeight` is one frame.
      height: info.pageHeight ?? info.height,
    };
  }
}
