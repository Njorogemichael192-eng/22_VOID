import { describe, expect, it } from "vitest";

import { formatLine, lineKind, parseCanonicalLine, splitAsianLine } from "./line";

describe("parseCanonicalLine", () => {
  it("parses canonical decimal lines", () => {
    expect(parseCanonicalLine("2.5")).toBe(2.5);
    expect(parseCanonicalLine("-0.75")).toBe(-0.75);
    expect(parseCanonicalLine("1")).toBe(1);
    expect(parseCanonicalLine("0")).toBe(0);
  });

  it("rejects non-canonical lines", () => {
    expect(parseCanonicalLine("2,5")).toBeUndefined();
    expect(parseCanonicalLine("+1.5")).toBeUndefined();
    expect(parseCanonicalLine("abc")).toBeUndefined();
    expect(parseCanonicalLine("")).toBeUndefined();
    expect(parseCanonicalLine("1.2.3")).toBeUndefined();
  });
});

describe("formatLine", () => {
  it("formats canonical value strings without trailing zeros", () => {
    expect(formatLine(2.5)).toBe("2.5");
    expect(formatLine(2)).toBe("2");
    expect(formatLine(-0.75)).toBe("-0.75");
    expect(formatLine(0)).toBe("0");
    expect(formatLine(1.5)).toBe("1.5");
    expect(formatLine(-1)).toBe("-1");
  });
});

describe("lineKind", () => {
  it("classifies whole, half and quarter lines", () => {
    expect(lineKind(2)).toBe("whole");
    expect(lineKind(2.5)).toBe("half");
    expect(lineKind(2.25)).toBe("quarter");
    expect(lineKind(2.75)).toBe("quarter");
    expect(lineKind(-0.75)).toBe("quarter");
    expect(lineKind(-1)).toBe("whole");
  });
});

describe("splitAsianLine (§13/§14)", () => {
  it("keeps whole and half lines as single components", () => {
    expect(splitAsianLine("2.5")).toEqual(["2.5"]);
    expect(splitAsianLine("-1")).toEqual(["-1"]);
  });

  it("splits quarter lines into two adjacent whole/half lines", () => {
    expect(splitAsianLine("2.25")).toEqual(["2", "2.5"]);
    expect(splitAsianLine("2.75")).toEqual(["2.5", "3"]);
    expect(splitAsianLine("-0.75")).toEqual(["-1", "-0.5"]);
    expect(splitAsianLine("0.25")).toEqual(["0", "0.5"]);
    expect(splitAsianLine("-1.25")).toEqual(["-1.5", "-1"]);
  });

  it("rejects non-canonical lines", () => {
    expect(splitAsianLine("foo")).toBeUndefined();
  });
});
