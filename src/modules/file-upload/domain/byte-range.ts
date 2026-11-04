/** A requested range before the file size is known (mirrors HTTP `Range`). */
export type RangeSpec =
  | { readonly start: number; readonly end?: number }
  | { readonly suffixLength: number };

/** A resolved, inclusive byte range within a file. */
export interface ByteRange {
  readonly start: number;
  readonly end: number;
}

/**
 * Clamps a requested range to a file of `size` bytes.
 * Returns `null` when the range cannot be satisfied.
 */
export function resolveByteRange(spec: RangeSpec, size: number): ByteRange | null {
  if (size <= 0) return null;

  if ("suffixLength" in spec) {
    if (spec.suffixLength <= 0) return null;
    return { start: Math.max(size - spec.suffixLength, 0), end: size - 1 };
  }

  if (spec.start >= size) return null;
  const end = Math.min(spec.end ?? size - 1, size - 1);
  return end < spec.start ? null : { start: spec.start, end };
}

export function byteRangeLength(range: ByteRange): number {
  return range.end - range.start + 1;
}
