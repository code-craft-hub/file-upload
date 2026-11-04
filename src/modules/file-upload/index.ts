/**
 * Server entry point of the file-upload module.
 * UI components live in `./ui` (client-safe); never import this file from a client component.
 */

// Composition
export { createFileUploadModule, getFileUploadModule, consoleLogger, type FileUploadModule } from "./composition/container";
export { loadConfigFromEnv, type FileUploadConfig } from "./composition/config";

// HTTP
export { createFileHttpHandlers, type FileAction, type FileHttpHandlers, type FileHttpOptions } from "./http/handlers";
export { toFileDto, toProviderDto, type FileDto, type FilePageDto, type ProviderDto, type UsageDto } from "./http/dto";

// Application (for custom delivery mechanisms and new adapters)
export { createFileUploadUseCases, type FileUploadUseCases } from "./application/file-upload-use-cases";
export { ProviderRegistry } from "./application/provider-registry";
export type * from "./application/ports";

// Domain
export * from "./domain/errors";
export type * from "./domain/stored-file";
export { DEFAULT_ALLOWED_CONTENT_TYPES, DEFAULT_MAX_FILE_SIZE_BYTES, type UploadPolicy } from "./domain/upload-policy";

// Adapters
export { PostgresFileStorage, type AnyPgDatabase, type PostgresFileStorageOptions } from "./infrastructure/postgres/postgres-file-storage";
export { createPostgresConnection } from "./infrastructure/postgres/connection";
export * as fileUploadSchema from "./infrastructure/postgres/schema";
export { ImageKitClient } from "./infrastructure/imagekit/imagekit-client";
export { ImageKitFileStorage } from "./infrastructure/imagekit/imagekit-file-storage";
export { SharpImageOptimizer, DEFAULT_IMAGE_OPTIMIZATION } from "./infrastructure/sharp/sharp-image-optimizer";
export { InMemoryFileStorage } from "./infrastructure/memory/in-memory-file-storage";
