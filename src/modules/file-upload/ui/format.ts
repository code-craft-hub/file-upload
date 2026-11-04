/** Presentation helpers, matching how iOS formats sizes, dates and kinds. */

const decimal = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
const integer = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });

/** Decimal units (1 KB = 1000 bytes), as iOS and macOS display sizes. */
export function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${integer.format(bytes)} ${bytes === 1 ? "byte" : "bytes"}`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1000;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${value >= 100 ? integer.format(value) : decimal.format(value)} ${units[unit]}`;
}

const percent = new Intl.NumberFormat(undefined, { style: "percent", maximumFractionDigits: 0 });

/** Floors, so a 99.6% saving reads "99%": never claim more than was saved. */
export function formatPercent(ratio: number): string {
  return percent.format(Math.floor(ratio * 100) / 100);
}

/** "Today at 9:41 AM", "Yesterday", "Monday", "Nov 2", "Nov 2, 2025". */
export function formatRelativeDate(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  const startOfDay = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);

  if (days === 0) return `Today at ${date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
  if (days === 1) return "Yesterday";
  if (days > 1 && days < 7) return date.toLocaleDateString(undefined, { weekday: "long" });
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}

export function formatFullDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export type FileKind = "image" | "video" | "audio" | "pdf" | "text" | "archive" | "other";

export function fileKind(contentType: string): FileKind {
  if (contentType === "application/pdf") return "pdf";
  if (contentType.startsWith("image/")) return "image";
  if (contentType.startsWith("video/")) return "video";
  if (contentType.startsWith("audio/")) return "audio";
  if (contentType.startsWith("text/") || contentType === "application/json") return "text";
  if (/zip|gzip|compressed|tar/.test(contentType)) return "archive";
  return "other";
}

const KIND_NAMES: Readonly<Record<string, string>> = {
  "image/jpeg": "JPEG image",
  "image/png": "PNG image",
  "image/webp": "WebP image",
  "image/avif": "AVIF image",
  "image/gif": "GIF image",
  "image/heic": "HEIC image",
  "image/svg+xml": "SVG image",
  "application/pdf": "PDF document",
  "application/json": "JSON",
  "application/zip": "ZIP archive",
  "text/plain": "Plain text",
  "text/csv": "CSV document",
  "text/markdown": "Markdown document",
  "video/mp4": "MPEG-4 movie",
  "video/quicktime": "QuickTime movie",
  "video/webm": "WebM movie",
  "audio/mpeg": "MP3 audio",
  "audio/mp4": "MPEG-4 audio",
  "audio/wav": "WAV audio",
};

export function describeKind(contentType: string): string {
  return KIND_NAMES[contentType] ?? contentType;
}

/** Short uppercase label for document glyphs: "PDF", "CSV", "MP4". */
export function extensionLabel(name: string): string {
  const match = /\.([a-z0-9]{1,5})$/i.exec(name);
  return match ? match[1].toUpperCase() : "FILE";
}

export function savedRatio(before: number, after: number): number {
  return before > 0 ? Math.max(0, 1 - after / before) : 0;
}
