import { FileNotFoundError } from "../../domain/errors";
import type { ProviderRegistry } from "../provider-registry";
import type { FileRef } from "./get-file";

export class DeleteFile {
  constructor(private readonly providers: ProviderRegistry) {}

  /** @throws {FileNotFoundError} */
  async execute({ provider, id }: FileRef): Promise<void> {
    const deleted = await this.providers.get(provider).files.delete(id);
    if (!deleted) throw new FileNotFoundError(provider, id);
  }
}
