/** Compare decimal strings without rounding or converting them to binary floats. */
export function compareDecimals(left: string, right: string): number {
  const [leftInteger, leftFraction = ""] = left.replace(",", ".").split(".");
  const [rightInteger, rightFraction = ""] = right.replace(",", ".").split(".");
  const integerComparison = Number(leftInteger) - Number(rightInteger);
  if (integerComparison !== 0) return integerComparison;
  const width = Math.max(leftFraction.length, rightFraction.length);
  const a = leftFraction.padEnd(width, "0");
  const b = rightFraction.padEnd(width, "0");
  return a === b ? 0 : a < b ? -1 : 1;
}

export function normalizeTitle(title: string): string {
  return title.normalize("NFKD").toLowerCase().replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim() || title;
}
