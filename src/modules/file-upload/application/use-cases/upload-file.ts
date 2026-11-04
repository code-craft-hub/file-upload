import { detectContentType } from "../../domain/content-type";
import { sanitizeFileName, withExtensionFor } from "../../domain/file-name";
import type { ProviderId, StoredFile } from "../../domain/stored-file";
import { assertContentTypeAllowed, assertFileSizeAllowed } from "../../domain/upload-policy";
import type { ImageOptimizer, Logger, PreparedUpload } from "../ports";
import type { ProviderRegistry } from "../provider-registry";

export interface UploadFileCommand {
  readonly provider: ProviderId;
  readonly fileName: string;
  /** Type reported by the client. Treated as a hint only. */
  readonly declaredType?: string;
  readonly bytes: Uint8Array;
}

/**
 * Validate → detect the real type → optionally optimise → persist.
 *
 * The provider receives a fully prepared file and never re-validates it, so
 * the rules live in exactly one place regardless of where the bytes end up.
 */
export class UploadFile {
  constructor(
    private readonly providers: ProviderRegistry,
    private readonly imageOptimizer: ImageOptimizer | undefined,
    private readonly logger: Logger,
  ) {}

  async execute(command: UploadFileCommand): Promise<StoredFile> {
    const provider = this.providers.get(command.provider);
    const { policy } = provider;

    assertFileSizeAllowed(policy, command.bytes.byteLength);

    const name = sanitizeFileName(command.fileName);
    const contentType = detectContentType({ bytes: command.bytes, declaredType: command.declaredType, fileName: name });
    assertContentTypeAllowed(policy, contentType);

    const original: PreparedUpload = { name, contentType, bytes: command.bytes, originalSize: command.bytes.byteLength };
    const upload = policy.optimizeImages ? await this.optimize(original) : original;

    return provider.files.save(upload);
  }

  /**
   * Optimisation is best-effort: a file we cannot re-encode is stored as is,
   * and a re-encode that does not shrink the file is discarded.
   */
  private async optimize(upload: PreparedUpload): Promise<PreparedUpload> {
    if (!this.imageOptimizer?.canOptimize(upload.contentType)) return upload;

    try {
      const optimized = await this.imageOptimizer.optimize(upload);
      if (optimized.bytes.byteLength >= upload.bytes.byteLength) return upload;

      return {
        ...upload,
        name: withExtensionFor(upload.name, optimized.contentType),
        contentType: optimized.contentType,
        bytes: optimized.bytes,
        width: optimized.width,
        height: optimized.height,
      };
    } catch (error) {
      this.logger.warn("Image optimisation failed; storing the original.", {
        contentType: upload.contentType,
        error: error instanceof Error ? error.message : String(error),
      });
      return upload;
    }
  }
}
