/**
 * The JSON contract of the HTTP API. Shared by the server handlers and the UI
 * client, so this file must stay free of server-only imports.
 */
import type { StorageProvider } from "../application/ports";
import type { StorageFootprint, StorageUsage, StoredFile } from "../domain/stored-file";

export interface FileDto {
  readonly id: string;
  readonly provider: string;
  readonly name: string;
  readonly contentType: string;
  readonly size: number;
  readonly originalSize?: number;
  readonly url: string;
  readonly thumbnailUrl?: string;
  readonly width?: number;
  readonly height?: number;
  /** ISO 8601 */
  readonly createdAt: string;
  readonly footprint?: StorageFootprint;
}

export interface FilePageDto {
  readonly items: FileDto[];
  readonly nextCursor: string | null;
}

export interface ProviderDto {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly maxFileSizeBytes: number;
  readonly allowedContentTypes: readonly string[];
  readonly optimizesImages: boolean;
  readonly reportsUsage: boolean;
}

export type UsageDto = StorageUsage;

export interface ErrorDto {
  readonly error: { readonly code: string; readonly message: string };
}

export function toFileDto(file: StoredFile): FileDto {
  return { ...file, createdAt: file.createdAt.toISOString() };
}

export function toProviderDto(provider: StorageProvider): ProviderDto {
  return {
    id: provider.id,
    label: provider.label,
    description: provider.description,
    maxFileSizeBytes: provider.policy.maxFileSizeBytes,
    allowedContentTypes: provider.policy.allowedContentTypes,
    optimizesImages: provider.policy.optimizeImages,
    reportsUsage: provider.usage !== undefined,
  };
}
