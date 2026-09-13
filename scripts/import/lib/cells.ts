import type { Cell } from "exceljs";

/**
 * The text a cell displays, whatever ExcelJS wrapped it in.
 *
 * The shapes matter more than they look. A plain string is the easy case; a
 * styled cell arrives as rich text; a formula arrives with its cached result;
 * and a HYPERLINK arrives as { text, hyperlink } — where the text is ITSELF
 * rich text when the link was styled. That last combination is why SUKI.AI
 * India Pvt Ltd was imported as a company called "[object Object]": the handler
 * asked whether the text was a string, it was an object, and the generic
 * fallback stringified the wrapper into a plausible-looking name.
 */
export function cellText(cell: Cell): string | null {
  const value = cell.value;
  if (value === null || value === undefined) return null;

  /** Joins the runs of a rich-text object, or null if this is not one. */
  const fromRichText = (candidate: unknown): string | null => {
    if (candidate === null || typeof candidate !== 'object') return null;
    if (!('richText' in candidate)) return null;
    const runs = (candidate as { richText?: unknown }).richText;
    if (!Array.isArray(runs)) return null;
    const text = runs.map((run) => (run as { text?: string }).text ?? '').join('');
    return text.trim() || null;
  };

  if (typeof value === 'object' && !(value instanceof Date)) {
    const direct = fromRichText(value);
    if (direct !== null) return direct;

    if ('text' in value) {
      const inner = (value as { text?: unknown }).text;
      if (typeof inner === 'string') return inner.trim() || null;
      // A hyperlink whose display text carries formatting.
      const nested = fromRichText(inner);
      if (nested !== null) return nested;
    }

    if ('result' in value) {
      const result = (value as { result?: unknown }).result;
      return result === null || result === undefined ? null : String(result).trim() || null;
    }

    // An Excel error cell — #REF!, #N/A, #VALUE!. It carries no text.
    if ('error' in value) return null;
  }

  if (value instanceof Date) return value.toISOString();

  const text = String(value).replace(/ /g, ' ').trim();

  // A shape nobody anticipated. Writing "[object Object]" into the database
  // would let the import report success while inventing a value; null leaves a
  // gap the review log records and a human can act on.
  if (!text || text === '[object Object]') return null;
  return text;
}
