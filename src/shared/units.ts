import type { Units } from "./types";

export const FT_PER_M = 3.280839895;

/** Format a length stored in feet. */
export function formatLength(feet: number, units: Units, opts: { precise?: boolean } = {}): string {
  if (!isFinite(feet)) return "—";
  if (units === "metric") {
    const m = feet / FT_PER_M;
    if (Math.abs(m) < 1) return `${Math.round(m * 100)} cm`;
    return `${m.toFixed(2)} m`;
  }
  const neg = feet < 0;
  let totalIn = Math.abs(feet) * 12;
  totalIn = opts.precise ? Math.round(totalIn * 4) / 4 : Math.round(totalIn);
  let ft = Math.floor(totalIn / 12);
  let inch = totalIn - ft * 12;
  if (inch >= 12) {
    ft += 1;
    inch -= 12;
  }
  const inchStr = Number.isInteger(inch) ? String(inch) : inch.toFixed(2).replace(/0+$/, "");
  return `${neg ? "-" : ""}${ft}' ${inchStr}"`;
}

/** Format an area stored in square feet. */
export function formatArea(sqft: number, units: Units): string {
  if (units === "metric") return `${(sqft / (FT_PER_M * FT_PER_M)).toFixed(1)} m²`;
  return `${sqft.toFixed(0)} ft²`;
}

/** Value shown in a plain number box: feet (decimal) or metres. */
export function toDisplay(feet: number, units: Units): number {
  return units === "metric" ? feet / FT_PER_M : feet;
}
export function fromDisplay(value: number, units: Units): number {
  return units === "metric" ? value * FT_PER_M : value;
}

/**
 * Parse a typed length into feet. Accepts:
 *   imperial: 12   12.5   12'   12' 6"   12ft 6in   6"   150in
 *   metric:   3.8  3.8m   380cm   3800mm
 * Units typed explicitly win over the current unit system. Returns null if unreadable.
 */
export function parseLength(text: string, units: Units): number | null {
  const t = text.trim().toLowerCase().replace(/,/g, ".");
  if (!t) return null;
  let m: RegExpMatchArray | null;
  if ((m = t.match(/^(-?\d+(?:\.\d+)?)\s*(mm|cm|m)$/))) {
    const v = parseFloat(m[1]);
    const metres = m[2] === "mm" ? v / 1000 : m[2] === "cm" ? v / 100 : v;
    return metres * FT_PER_M;
  }
  if ((m = t.match(/^(-?\d+(?:\.\d+)?)\s*(?:'|ft|feet|foot)\s*(?:(\d+(?:\.\d+)?)\s*(?:"|in|inch|inches)?)?$/))) {
    const ft = parseFloat(m[1]);
    const inch = m[2] ? parseFloat(m[2]) : 0;
    return ft < 0 ? ft - inch / 12 : ft + inch / 12;
  }
  if ((m = t.match(/^(-?\d+(?:\.\d+)?)\s*(?:"|in|inch|inches)$/))) {
    return parseFloat(m[1]) / 12;
  }
  if ((m = t.match(/^-?\d+(?:\.\d+)?$/))) {
    return fromDisplay(parseFloat(t), units);
  }
  return null;
}
