/**
 * Canonical market lines and Asian quarter-line decomposition (§12–§14).
 *
 * A quarter line (x.25 / x.75) is a 50/50 split of two adjacent whole/half
 * component lines: Over 2.25 → 50% Over 2.0 + 50% Over 2.5; Home −0.75 →
 * 50% Home −0.5 + 50% Home −1.0 (spec §13, §14). Quarter-line behavior is
 * always computed from component settlements — never from a hard-coded list of
 * special cases (§15).
 */

export type LineKind = "whole" | "half" | "quarter";

const CANONICAL_LINE_REGEX = /^-?[0-9]+(?:\.[0-9]+)?$/;

export function parseCanonicalLine(line: string): number | undefined {
  if (!CANONICAL_LINE_REGEX.test(line)) return undefined;
  const value = Number(line);
  return Number.isFinite(value) ? value : undefined;
}

/** "2.5", "-1", "-0.75" — no trailing zeros, no "+" prefix, no unwrapped -0. */
export function formatLine(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  if (Number.isInteger(rounded)) {
    return String(rounded === 0 ? 0 : rounded);
  }
  const formatted = rounded.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  return formatted === "-0" ? "0" : formatted;
}

/** Whether a canonical value is a whole line (2.0), half line (2.5) or quarter (2.25). */
export function lineKind(value: number): LineKind {
  if (Number.isInteger(value)) return "whole";
  const cents = Math.round(value * 100);
  const fractional = ((cents % 100) + 100) % 100;
  if (fractional === 25 || fractional === 75) return "quarter";
  return "half";
}

/**
 * Decompose an Asian line into its component lines. Quarter lines split into
 * two adjacent whole/half lines ([L−0.25, L+0.25]); everything else stays as a
 * single component. Returns undefined when the line is not canonical.
 */
export function splitAsianLine(line: string): string[] | undefined {
  const value = parseCanonicalLine(line);
  if (value === undefined) return undefined;
  if (lineKind(value) !== "quarter") return [line];
  const cents = Math.round(value * 100);
  return [formatLine((cents - 25) / 100), formatLine((cents + 25) / 100)];
}
