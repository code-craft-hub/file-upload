/**
 * File names come straight from the client, so they are normalised before they
 * are stored or echoed back in a `Content-Disposition` header.
 */

const MAX_NAME_LENGTH = 200;
const FALLBACK_NAME = "untitled";

// C0/C1 control characters, plus bidi overrides that can disguise an extension
// ("photo‮gpj.exe" renders as "photoexe.jpg").
const UNSAFE_CHARACTERS = /[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g;

const EXTENSIONS_BY_TYPE: Readonly<Record<string, string>> = {
  "image/webp": "webp",
  "image/avif": "avif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
};

export function sanitizeFileName(raw: string | undefined): string {
  const baseName = (raw ?? "").normalize("NFC").split(/[\\/]/).pop() ?? "";
  const cleaned = baseName
    .replace(UNSAFE_CHARACTERS, "")
    .replace(/\s+/g, " ")
    .replace(/^[\s.]+|[\s.]+$/g, "");

  if (!cleaned) return FALLBACK_NAME;
  if (cleaned.length <= MAX_NAME_LENGTH) return cleaned;

  const { stem, extension } = splitExtension(cleaned);
  const suffix = extension ? `.${extension.slice(0, 16)}` : "";
  return stem.slice(0, MAX_NAME_LENGTH - suffix.length) + suffix;
}

/** `photo.png` + `image/webp` → `photo.webp`. Names are unchanged for unknown types. */
export function withExtensionFor(name: string, contentType: string): string {
  const extension = EXTENSIONS_BY_TYPE[contentType];
  if (!extension) return name;
  const { stem } = splitExtension(name);
  return `${stem || FALLBACK_NAME}.${extension}`;
}

function splitExtension(name: string): { stem: string; extension: string } {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? { stem: name.slice(0, dot), extension: name.slice(dot + 1) } : { stem: name, extension: "" };
}
