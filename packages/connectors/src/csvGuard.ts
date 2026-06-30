/**
 * CSV ingest hardening. Spreadsheet formula injection: a cell beginning with
 * = + - @ (or tab/CR) can execute when the file is reopened in Excel/Sheets.
 * Every imported AND exported cell is neutralized (§ security). We prefix a
 * leading apostrophe so the value renders as literal text and never evaluates.
 */
export const DANGEROUS_LEADING = /^[=+\-@\t\r]/;

export function neutralizeCell(value: string): string {
  if (typeof value !== "string") return value;
  return DANGEROUS_LEADING.test(value) ? `'${value}` : value;
}

/** Neutralize every field in a parsed CSV row map. */
export function neutralizeRow(row: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(row)) out[k] = neutralizeCell(v);
  return out;
}
