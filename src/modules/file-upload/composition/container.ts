/**
 * Composition root: the only place that knows about every layer. It turns
 * configuration into concrete adapters and wires them into the use cases.
 * To add, remove or re-configure a provider, this is the file to edit.
 */
import { createFileUploadUseCases, type FileUploadUseCases } from "../application/file-upload-use-cases";
import type { Logger, StorageProvider } from "../application/ports";
import { ProviderRegistry } from "../application/provider-registry";
import { ImageKitClient } from "../infrastructure/imagekit/imagekit-client";
import { ImageKitFileStorage } from "../infrastructure/imagekit/imagekit-file-storage";
import { createPostgresConnection } from "../infrastructure/postgres/connection";
import { PostgresFileStorage } from "../infrastructure/postgres/postgres-file-storage";
import { SharpImageOptimizer } from "../infrastructure/sharp/sharp-image-optimizer";
import { loadConfigFromEnv, type FileUploadConfig } from "./config";

export interface FileUploadModule extends FileUploadUseCases {
  readonly logger: Logger;
  /** Releases pooled connections. Call on graceful shutdown and in tests. */
  close(): Promise<void>;
}

export const consoleLogger: Logger = {
  warn: (message, details) => console.warn(`[file-upload] ${message}`, details ?? ""),
  error: (message, details) => console.error(`[file-upload] ${message}`, details ?? ""),
};

export function createFileUploadModule(config: FileUploadConfig, logger: Logger = consoleLogger): FileUploadModule {
  const providers: StorageProvider[] = [];
  const disposers: Array<() => Promise<void>> = [];
  const limits = { maxFileSizeBytes: config.maxFileSizeBytes, allowedContentTypes: config.allowedContentTypes };

  if (config.postgres) {
    const connection = createPostgresConnection(config.postgres.url);
    disposers.push(connection.close);
    const storage = new PostgresFileStorage(connection.db, {
      providerId: "postgres",
      contentUrl: (id) => `${config.apiBasePath}/postgres/${id}/content`,
    });
    providers.push({
      id: "postgres",
      label: "Postgres",
      description: "Deduplicated, compressed and chunked inside your database.",
      // Every stored byte costs database space, so shrink images first.
      policy: { ...limits, optimizeImages: true },
      files: storage,
      content: storage,
      usage: storage,
    });
  }

  if (config.imagekit) {
    const storage = new ImageKitFileStorage(new ImageKitClient({ privateKey: config.imagekit.privateKey }), {
      providerId: "imagekit",
      folder: config.imagekit.folder,
    });
    providers.push({
      id: "imagekit",
      label: "ImageKit",
      description: "Originals on ImageKit, resized and delivered by its CDN.",
      // ImageKit transforms on delivery; keep the full-quality original.
      policy: { ...limits, optimizeImages: false },
      files: storage,
    });
  }

  const useCases = createFileUploadUseCases(new ProviderRegistry(providers), {
    imageOptimizer: new SharpImageOptimizer(),
    logger,
  });

  return {
    ...useCases,
    logger,
    close: async () => {
      await Promise.all(disposers.map((dispose) => dispose()));
    },
  };
}

const globalCache = globalThis as typeof globalThis & { __fileUploadModule?: FileUploadModule };

/**
 * The process-wide module, created on first use from environment variables.
 * Cached on `globalThis` so dev-server hot reloads reuse one connection pool.
 */
export function getFileUploadModule(): FileUploadModule {
  globalCache.__fileUploadModule ??= createFileUploadModule(loadConfigFromEnv());
  return globalCache.__fileUploadModule;
}
