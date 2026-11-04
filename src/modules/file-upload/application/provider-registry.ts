import { ProviderNotFoundError } from "../domain/errors";
import type { ProviderId } from "../domain/stored-file";
import type { StorageProvider } from "./ports";

/** The set of providers configured for this deployment, looked up by id. */
export class ProviderRegistry {
  private readonly byId: ReadonlyMap<ProviderId, StorageProvider>;

  constructor(providers: readonly StorageProvider[]) {
    const byId = new Map<ProviderId, StorageProvider>();
    for (const provider of providers) {
      if (byId.has(provider.id)) throw new Error(`Duplicate storage provider id "${provider.id}".`);
      byId.set(provider.id, provider);
    }
    this.byId = byId;
  }

  /** @throws {ProviderNotFoundError} */
  get(id: ProviderId): StorageProvider {
    const provider = this.byId.get(id);
    if (!provider) throw new ProviderNotFoundError(id);
    return provider;
  }

  list(): readonly StorageProvider[] {
    return [...this.byId.values()];
  }
}
