import { FileNotFoundError } from "../../domain/errors";
import type { ProviderId, StoredFile } from "../../domain/stored-file";
import type { ProviderRegistry } from "../provider-registry";

export interface FileRef {
  readonly provider: ProviderId;
  readonly id: string;
}

export class GetFile {
  constructor(private readonly providers: ProviderRegistry) {}

  /** @throws {FileNotFoundError} */
  async execute({ provider, id }: FileRef): Promise<StoredFile> {
    const file = await this.providers.get(provider).files.find(id);
    if (!file) throw new FileNotFoundError(provider, id);
    return file;
  }
}
