import { describe, expect, it } from "vitest";
import { isUuid, uuidv7 } from "./uuid-v7";

describe("uuidv7", () => {
  it("produces RFC 9562 version 7 UUIDs", () => {
    const id = uuidv7();
    expect(isUuid(id)).toBe(true);
    expect(id[14]).toBe("7");
    expect("89ab").toContain(id[19]);
  });

  it("encodes the timestamp in the first 48 bits", () => {
    // Later than any id generated so far: the generator never moves backwards.
    const future = Date.now() + 10 * 60_000;
    expect(Number.parseInt(uuidv7(future).replace(/-/g, "").slice(0, 12), 16)).toBe(future);
  });

  it("is strictly increasing within a process, even within one millisecond", () => {
    const fixed = Date.now() + 120_000;
    const ids = Array.from({ length: 5000 }, () => uuidv7(fixed));
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
