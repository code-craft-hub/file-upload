/** Small, strict parsers for the HTTP headers the content endpoint understands. */
import type { RangeSpec } from "../domain/byte-range";
import type { ContentEncoding } from "../domain/stored-file";

/**
 * Parses a single-range `Range: bytes=…` header. Multi-range and malformed
 * headers yield `undefined`, which RFC 9110 allows a server to ignore.
 */
export function parseRangeHeader(header: string | null): RangeSpec | undefined {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header?.trim() ?? "");
  if (!match) return undefined;
  const [, start, end] = match;
  if (start === "" && end === "") return undefined;
  if (start === "") return { suffixLength: Number(end) };
  return end === "" ? { start: Number(start) } : { start: Number(start), end: Number(end) };
}

/** Encodings (besides identity) the client accepts with a non-zero q-value. */
export function parseAcceptEncoding(header: string | null): ContentEncoding[] {
  const accepted = (header ?? "").split(",").some((part) => {
    const [coding, ...params] = part.trim().toLowerCase().split(";");
    const q = params.map((param) => /^\s*q=([\d.]+)\s*$/.exec(param)?.[1]).find(Boolean);
    return (coding === "br" || coding === "*") && (q === undefined || Number(q) > 0);
  });
  return accepted ? ["br"] : [];
}

/** Entity tags from `If-None-Match`, without quotes or the weak `W/` prefix (weak comparison). */
export function parseIfNoneMatch(header: string | null): string[] {
  if (!header) return [];
  if (header.trim() === "*") return ["*"];
  return [...header.matchAll(/(?:W\/)?"([^"]*)"/g)].map((match) => match[1]);
}

/** RFC 6266 `Content-Disposition` with an ASCII fallback and a UTF-8 `filename*`. */
export function contentDisposition(type: "inline" | "attachment", fileName: string): string {
  const fallback = fileName.replace(/[^\x20-\x7e]|["\\%]/g, "_");
  return `${type}; filename="${fallback}"; filename*=UTF-8''${encodeRFC5987(fileName)}`;
}

function encodeRFC5987(value: string): string {
  return encodeURIComponent(value).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}
