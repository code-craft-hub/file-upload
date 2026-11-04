import { describe, expect, it } from "vitest";
import { resolveByteRange } from "./byte-range";
import { detectContentType } from "./content-type";
import { sanitizeFileName, withExtensionFor } from "./file-name";
import { isContentTypeAllowed } from "./upload-policy";

const bytes = (...values: number[]) => new Uint8Array(values);
const text = (value: string) => new TextEncoder().encode(value);

describe("detectContentType", () => {
  it.each([
    ["image/png", bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0)],
    ["image/jpeg", bytes(0xff, 0xd8, 0xff, 0xe0)],
    ["image/gif", text("GIF89a....")],
    ["image/webp", text("RIFF\0\0\0\0WEBPVP8 ")],
    ["image/avif", text("\0\0\0\x1cftypavif")],
    ["video/mp4", text("\0\0\0\x18ftypisom")],
    ["application/pdf", text("%PDF-1.7\n")],
  ])("sniffs %s from its signature", (expected, input) => {
    expect(detectContentType({ bytes: input })).toBe(expected);
  });

  it("trusts bytes over the declared type", () => {
    expect(detectContentType({ bytes: bytes(0xff, 0xd8, 0xff, 0xe0), declaredType: "text/plain" })).toBe("image/jpeg");
  });

  it("labels HTML as text/html even when it claims to be an image", () => {
    const html = text("<!DOCTYPE html><script>alert(1)</script>");
    expect(detectContentType({ bytes: html, declaredType: "image/png", fileName: "cat.png" })).toBe("text/html");
  });

  it("detects SVG behind an XML prolog and comments", () => {
    const svg = text('<?xml version="1.0"?>\n<!-- logo -->\n<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    expect(detectContentType({ bytes: svg })).toBe("image/svg+xml");
  });

  it("refuses to call non-SVG text an SVG because of its name", () => {
    expect(detectContentType({ bytes: text("just text"), fileName: "fake.svg", declaredType: "image/svg+xml" })).toBe("text/plain");
  });

  it("uses the extension, then the declared type, for plain text", () => {
    expect(detectContentType({ bytes: text("a,b\n1,2"), fileName: "data.csv" })).toBe("text/csv");
    expect(detectContentType({ bytes: text("# Title"), declaredType: "text/markdown" })).toBe("text/markdown");
    expect(detectContentType({ bytes: text("hello"), declaredType: "image/png" })).toBe("text/plain");
  });

  it("keeps a declared OOXML type for ZIP containers", () => {
    const docx = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    expect(detectContentType({ bytes: bytes(0x50, 0x4b, 0x03, 0x04), declaredType: docx })).toBe(docx);
    expect(detectContentType({ bytes: bytes(0x50, 0x4b, 0x03, 0x04), declaredType: "image/png" })).toBe("application/zip");
  });

  it("falls back to octet-stream for unknown binary", () => {
    expect(detectContentType({ bytes: bytes(0x00, 0x01, 0x02, 0xfe) })).toBe("application/octet-stream");
  });
});

describe("sanitizeFileName", () => {
  it("strips directories, control and bidi characters", () => {
    expect(sanitizeFileName("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFileName("C:\\Users\\me\\photo.jpg")).toBe("photo.jpg");
    expect(sanitizeFileName("photo\u202Egpj.exe")).toBe("photogpj.exe");
    expect(sanitizeFileName("a\u0000b\nc.txt")).toBe("abc.txt");
  });

  it("falls back for empty or dot-only names", () => {
    expect(sanitizeFileName("")).toBe("untitled");
    expect(sanitizeFileName(" ... ")).toBe("untitled");
  });

  it("truncates long names but keeps the extension", () => {
    const name = sanitizeFileName(`${"x".repeat(500)}.pdf`);
    expect(name).toHaveLength(200);
    expect(name.endsWith(".pdf")).toBe(true);
  });

  it("swaps the extension when the content type changes", () => {
    expect(withExtensionFor("holiday.photo.png", "image/webp")).toBe("holiday.photo.webp");
    expect(withExtensionFor("notes", "image/webp")).toBe("notes.webp");
    expect(withExtensionFor("report.pdf", "application/pdf")).toBe("report.pdf");
  });
});

describe("resolveByteRange", () => {
  it("clamps open-ended and oversized ranges", () => {
    expect(resolveByteRange({ start: 10 }, 100)).toEqual({ start: 10, end: 99 });
    expect(resolveByteRange({ start: 10, end: 500 }, 100)).toEqual({ start: 10, end: 99 });
  });

  it("resolves suffix ranges", () => {
    expect(resolveByteRange({ suffixLength: 30 }, 100)).toEqual({ start: 70, end: 99 });
    expect(resolveByteRange({ suffixLength: 300 }, 100)).toEqual({ start: 0, end: 99 });
  });

  it("rejects unsatisfiable ranges", () => {
    expect(resolveByteRange({ start: 100 }, 100)).toBeNull();
    expect(resolveByteRange({ start: 50, end: 10 }, 100)).toBeNull();
    expect(resolveByteRange({ suffixLength: 0 }, 100)).toBeNull();
  });
});

describe("isContentTypeAllowed", () => {
  it("supports exact types and family wildcards", () => {
    expect(isContentTypeAllowed(["image/*"], "image/webp")).toBe(true);
    expect(isContentTypeAllowed(["image/*"], "imagex/webp")).toBe(false);
    expect(isContentTypeAllowed(["application/pdf"], "application/PDF")).toBe(true);
    expect(isContentTypeAllowed(["application/pdf"], "text/html")).toBe(false);
  });
});
