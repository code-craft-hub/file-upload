import type { FilePage, ProviderId } from "../../domain/stored-file";
import type { ProviderRegistry } from "../provider-registry";

export const DEFAULT_PAGE_SIZE = 30;
export const MAX_PAGE_SIZE = 100;

export interface ListFilesQuery {
  readonly provider: ProviderId;
  readonly limit?: number;
  readonly cursor?: string;
}

export class ListFiles {
  constructor(private readonly providers: ProviderRegistry) {}

  execute(query: ListFilesQuery): Promise<FilePage> {
    const limit = Math.min(Math.max(Math.trunc(query.limit ?? DEFAULT_PAGE_SIZE), 1), MAX_PAGE_SIZE);
    return this.providers.get(query.provider).files.list({ limit, cursor: query.cursor || undefined });
  }
}
