import type { ProviderId, StorageUsage } from "../../domain/stored-file";
import type { ProviderRegistry } from "../provider-registry";

export class GetStorageUsage {
  constructor(private readonly providers: ProviderRegistry) {}

  /** @returns `null` when the provider cannot report usage. */
  async execute(provider: ProviderId): Promise<StorageUsage | null> {
    const reader = this.providers.get(provider).usage;
    return reader ? reader.usage() : null;
  }
}
