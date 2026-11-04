import type { ImageOptimizer, Logger } from "./ports";
import type { ProviderRegistry } from "./provider-registry";
import { DeleteFile } from "./use-cases/delete-file";
import { GetFile } from "./use-cases/get-file";
import { GetStorageUsage } from "./use-cases/get-storage-usage";
import { ListFiles } from "./use-cases/list-files";
import { ReadFileContent } from "./use-cases/read-file-content";
import { UploadFile } from "./use-cases/upload-file";

/** Everything a delivery mechanism (HTTP, CLI, a job…) can ask the module to do. */
export interface FileUploadUseCases {
  readonly providers: ProviderRegistry;
  readonly uploadFile: UploadFile;
  readonly listFiles: ListFiles;
  readonly getFile: GetFile;
  readonly deleteFile: DeleteFile;
  readonly readFileContent: ReadFileContent;
  readonly getStorageUsage: GetStorageUsage;
}

export function createFileUploadUseCases(
  providers: ProviderRegistry,
  deps: { readonly imageOptimizer?: ImageOptimizer; readonly logger: Logger },
): FileUploadUseCases {
  return {
    providers,
    uploadFile: new UploadFile(providers, deps.imageOptimizer, deps.logger),
    listFiles: new ListFiles(providers),
    getFile: new GetFile(providers),
    deleteFile: new DeleteFile(providers),
    readFileContent: new ReadFileContent(providers),
    getStorageUsage: new GetStorageUsage(providers),
  };
}
