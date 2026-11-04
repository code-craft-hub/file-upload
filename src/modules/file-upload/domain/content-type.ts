/**
 * Content-type detection from the bytes themselves.
 *
 * The browser-supplied type and the file extension are both attacker-controlled,
 * so they are only trusted for formats that have no signature (plain text).
 * Anything that sniffs as HTML is labelled `text/html` so the upload policy can
 * reject it — serving user HTML from your origin is a stored-XSS vector.
 */

const SNIFF_WINDOW = 8 * 1024;

interface Signature {
  readonly type: string;
  readonly bytes: readonly number[];
  readonly offset?: number;
}

const ascii = (text: string) => Array.from(text, (char) => char.charCodeAt(0));

const SIGNATURES: readonly Signature[] = [
  { type: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { type: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
  { type: "image/gif", bytes: ascii("GIF87a") },
  { type: "image/gif", bytes: ascii("GIF89a") },
  { type: "image/tiff", bytes: [0x49, 0x49, 0x2a, 0x00] },
  { type: "image/tiff", bytes: [0x4d, 0x4d, 0x00, 0x2a] },
  { type: "image/bmp", bytes: ascii("BM") },
  { type: "image/x-icon", bytes: [0x00, 0x00, 0x01, 0x00] },
  { type: "application/pdf", bytes: ascii("%PDF-") },
  { type: "application/zip", bytes: [0x50, 0x4b, 0x03, 0x04] },
  { type: "application/gzip", bytes: [0x1f, 0x8b] },
  { type: "video/webm", bytes: [0x1a, 0x45, 0xdf, 0xa3] },
  { type: "audio/ogg", bytes: ascii("OggS") },
  { type: "audio/mpeg", bytes: ascii("ID3") },
  { type: "audio/mpeg", bytes: [0xff, 0xfb] },
  { type: "audio/mpeg", bytes: [0xff, 0xf3] },
];

/** RIFF containers carry their real format at byte 8. */
const RIFF_FORMATS: Readonly<Record<string, string>> = {
  WEBP: "image/webp",
  WAVE: "audio/wav",
  "AVI ": "video/x-msvideo",
};

/** ISO-BMFF (`ftyp`) brands at byte 8. */
const FTYP_BRANDS: Readonly<Record<string, string>> = {
  avif: "image/avif",
  avis: "image/avif",
  heic: "image/heic",
  heix: "image/heic",
  mif1: "image/heif",
  msf1: "image/heif",
  "qt  ": "video/quicktime",
  "M4A ": "audio/mp4",
  isom: "video/mp4",
  iso2: "video/mp4",
  mp41: "video/mp4",
  mp42: "video/mp4",
  avc1: "video/mp4",
  dash: "video/mp4",
  "M4V ": "video/mp4",
};

/** ZIP-based formats where the declared type is more useful than `application/zip`. */
const ZIP_BASED_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/epub+zip",
]);

const TEXT_TYPES_BY_EXTENSION: Readonly<Record<string, string>> = {
  txt: "text/plain",
  log: "text/plain",
  csv: "text/csv",
  md: "text/markdown",
  markdown: "text/markdown",
  json: "application/json",
  svg: "image/svg+xml",
  xml: "application/xml",
};

export interface ContentTypeEvidence {
  readonly bytes: Uint8Array;
  readonly declaredType?: string;
  readonly fileName?: string;
}

/** Best-effort MIME type for `bytes`, falling back to `application/octet-stream`. */
export function detectContentType({ bytes, declaredType, fileName }: ContentTypeEvidence): string {
  const declared = normalizeMimeType(declaredType);
  const sniffed = sniffBinary(bytes);

  if (sniffed) {
    return sniffed === "application/zip" && declared && ZIP_BASED_TYPES.has(declared) ? declared : sniffed;
  }

  const text = decodeTextSample(bytes);
  if (text === null) return "application/octet-stream";

  const markup = sniffMarkup(text);
  if (markup) return markup;

  const byExtension = TEXT_TYPES_BY_EXTENSION[extensionOf(fileName)];
  if (byExtension && byExtension !== "image/svg+xml") return byExtension;
  if (declared && isTextualMimeType(declared) && declared !== "image/svg+xml") return declared;
  return "text/plain";
}

export function normalizeMimeType(value: string | undefined | null): string | undefined {
  const type = value?.split(";")[0]?.trim().toLowerCase();
  return type && /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(type) ? type : undefined;
}

export function isTextualMimeType(type: string): boolean {
  return (
    type.startsWith("text/") ||
    type === "application/json" ||
    type === "application/xml" ||
    type.endsWith("+json") ||
    type.endsWith("+xml")
  );
}

function sniffBinary(bytes: Uint8Array): string | undefined {
  for (const signature of SIGNATURES) {
    if (startsWith(bytes, signature.bytes, signature.offset)) return signature.type;
  }
  if (startsWith(bytes, ascii("RIFF"))) return RIFF_FORMATS[readAscii(bytes, 8, 4)];
  if (startsWith(bytes, ascii("ftyp"), 4)) return FTYP_BRANDS[readAscii(bytes, 8, 4)];
  return undefined;
}

/** Returns the decoded head of the file if it is valid UTF-8 text, otherwise `null`. */
function decodeTextSample(bytes: Uint8Array): string | null {
  const sample = bytes.subarray(0, SNIFF_WINDOW);
  if (sample.includes(0)) return null;
  try {
    // `stream: true` tolerates a multi-byte character cut off at the window edge.
    return new TextDecoder("utf-8", { fatal: true }).decode(sample, { stream: true });
  } catch {
    return null;
  }
}

function sniffMarkup(text: string): string | undefined {
  const head = text.replace(/^﻿/, "").trimStart().slice(0, 1024).toLowerCase();
  if (/^<(!doctype html|html|head|body|script|iframe|object|embed)[\s>]/.test(head)) return "text/html";
  const withoutProlog = head.replace(/^<\?xml[^>]*>\s*/, "").replace(/^(<!--[\s\S]*?-->\s*|<!doctype svg[^>]*>\s*)*/, "");
  if (withoutProlog.startsWith("<svg")) return "image/svg+xml";
  return undefined;
}

function startsWith(bytes: Uint8Array, prefix: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + prefix.length) return false;
  return prefix.every((byte, index) => bytes[offset + index] === byte);
}

function readAscii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function extensionOf(fileName: string | undefined): string {
  const match = /\.([a-z0-9]+)$/i.exec(fileName ?? "");
  return match ? match[1].toLowerCase() : "";
}
