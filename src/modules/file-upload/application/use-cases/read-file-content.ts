import { byteRangeLength, resolveByteRange, type ByteRange, type RangeSpec } from "../../domain/byte-range";
import { FileNotFoundError, RangeNotSatisfiableError } from "../../domain/errors";
import type { ContentEncoding, StoredFile } from "../../domain/stored-file";
import type { ProviderRegistry } from "../provider-registry";
import type { FileRef } from "./get-file";

export interface ReadFileContentQuery extends FileRef {
  /** Encodings the client can decode, besides `identity`. */
  readonly acceptEncodings: readonly ContentEncoding[];
  readonly range?: RangeSpec;
  /** Content versions the client already holds (from `If-None-Match`). */
  readonly knownVersions?: readonly string[];
}

export type ReadFileContentResult =
  /** The provider serves bytes itself (e.g. a CDN); send the client there. */
  | { readonly kind: "redirect"; readonly location: string }
  | { readonly kind: "not-modified"; readonly version: string }
  | {
      readonly kind: "content";
      readonly file: StoredFile;
      readonly version: string;
      /** Encoding of `body`. */
      readonly encoding: ContentEncoding;
      /** Whether the stored bytes are encoded, i.e. the response depends on `acceptEncodings`. */
      readonly negotiated: boolean;
      /** Exact byte length of `body`. */
      readonly length: number;
      /** Set when `body` is a partial range of the file. */
      readonly range?: ByteRange;
      /** Whether this content supports range requests at all. */
      readonly rangeable: boolean;
      readonly body: ReadableStream<Uint8Array>;
    };

/**
 * Plans the cheapest correct response for a content request:
 * - unchanged content → `not-modified` (no bytes read);
 * - stored compressed and the client accepts it → stream stored bytes as is;
 * - otherwise decode on the fly;
 * - ranges are honoured only when bytes can be sliced without decoding.
 */
export class ReadFileContent {
  constructor(private readonly providers: ProviderRegistry) {}

  /** @throws {FileNotFoundError | RangeNotSatisfiableError} */
  async execute(query: ReadFileContentQuery): Promise<ReadFileContentResult> {
    const provider = this.providers.get(query.provider);

    if (!provider.content) {
      const file = await provider.files.find(query.id);
      if (!file) throw new FileNotFoundError(query.provider, query.id);
      return { kind: "redirect", location: file.url };
    }

    const content = await provider.content.get(query.id);
    if (!content) throw new FileNotFoundError(query.provider, query.id);

    const { file, version, storedEncoding } = content;
    if (query.knownVersions?.some((known) => known === "*" || known === version)) {
      return { kind: "not-modified", version };
    }

    const negotiated = storedEncoding !== "identity";
    const rangeable = storedEncoding === "identity";

    if (query.range && rangeable) {
      const range = resolveByteRange(query.range, file.size);
      if (!range) throw new RangeNotSatisfiableError(file.size);
      const body = content.open({ encoding: "identity", range });
      return { kind: "content", file, version, encoding: "identity", negotiated, rangeable, length: byteRangeLength(range), range, body };
    }

    const encoding = negotiated && query.acceptEncodings.includes(storedEncoding) ? storedEncoding : "identity";
    const length = encoding === storedEncoding ? content.storedBytes : file.size;
    const body = content.open({ encoding });
    return { kind: "content", file, version, encoding, negotiated, rangeable, length, body };
  }
}
