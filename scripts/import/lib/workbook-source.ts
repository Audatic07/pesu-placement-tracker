import { existsSync } from "node:fs";
import { resolve } from "node:path";
import ExcelJS from "exceljs";

/**
 * Opening a workbook from wherever it lives — a file on disk or a link.
 *
 * The archive spreadsheets are Google Sheets that a maintainer may not be able
 * to download to the machine running the import. So a season's source can be a
 * URL instead of a path: set its IMPORT_XLSX_<year> env var to the sheet's link
 * and the importer fetches it directly.
 *
 * A Google Sheets *share* link opens the editor, not the file, so it is
 * rewritten to the workbook-export endpoint before fetching. Any other http(s)
 * link is fetched as-is, on the assumption it already points at an .xlsx.
 */

export function isUrl(location: string): boolean {
  return /^https?:\/\//i.test(location.trim());
}

/**
 * Turns a Google Sheets link into a link that downloads the whole workbook as
 * an .xlsx. A share/edit/htmlview link — with or without a #gid — points at the
 * editor, which returns HTML, not a spreadsheet. Non-Sheets URLs pass through
 * unchanged.
 *
 * The document id always follows `/d/`, but the path in front of it varies: a
 * plain share link is `/spreadsheets/d/ID`, while a link copied from a signed-in
 * browser carries an account prefix, `/spreadsheets/u/0/d/ID`. Both — and the
 * /edit, /htmlview and /view suffixes — resolve to the same export endpoint.
 *
 *   https://docs.google.com/spreadsheets/d/ID/edit#gid=0
 *   https://docs.google.com/spreadsheets/u/0/d/ID/htmlview#gid=123
 *     -> https://docs.google.com/spreadsheets/d/ID/export?format=xlsx
 */
export function toDownloadUrl(location: string): string {
  const sheet = /docs\.google\.com\/spreadsheets\/(?:u\/\d+\/)?d\/([a-zA-Z0-9_-]+)/.exec(location);
  if (sheet?.[1]) {
    return `https://docs.google.com/spreadsheets/d/${sheet[1]}/export?format=xlsx`;
  }
  return location;
}

async function loadFromUrl(location: string): Promise<ExcelJS.Workbook> {
  const url = toDownloadUrl(location);
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(
      `Could not download the workbook from ${url} — the server answered ${response.status} ` +
        `${response.statusText}. If this is a Google Sheet, make sure link sharing is on ` +
        `("Anyone with the link" can view).`,
    );
  }

  // A private Sheet answers 200 with the sign-in HTML page rather than a file,
  // so a wrong-content-type response is caught here instead of failing later
  // inside ExcelJS with an opaque zip error.
  const contentType = response.headers.get("content-type") ?? "";
  if (/text\/html/i.test(contentType)) {
    throw new Error(
      `The link at ${url} returned an HTML page, not a spreadsheet. The sheet is probably ` +
        `not shared publicly — set its sharing to "Anyone with the link" and try again.`,
    );
  }

  // ExcelJS's load() takes an ArrayBuffer (its own Buffer type extends it), so
  // the response bytes go in directly without a Node Buffer round-trip.
  const bytes = await response.arrayBuffer();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);
  return workbook;
}

async function loadFromFile(path: string): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(resolve(path));
  return workbook;
}

/**
 * Opens a workbook from a file path or an http(s) link. Returns null only when
 * a *local file* is absent, so the caller can skip a season whose archive is
 * not on disk. A URL is always attempted — an unreachable one is a real error,
 * not a "skip me".
 */
export async function openWorkbookSource(location: string): Promise<ExcelJS.Workbook | null> {
  if (isUrl(location)) {
    return loadFromUrl(location);
  }
  if (!existsSync(resolve(location))) {
    return null;
  }
  return loadFromFile(location);
}
