import "server-only";
import ExcelJS from "exceljs";
import { parseCsv } from "@nl/schema";

const MAX_BYTES = 5 * 1024 * 1024;

export class ImportError extends Error {}

/** First worksheet of an .xlsx, or a .csv, as a grid of strings. */
export async function gridFromUpload(file: File): Promise<string[][]> {
  if (file.size > MAX_BYTES) throw new ImportError("The file is larger than 5 MB.");
  const name = file.name.toLowerCase();
  const bytes = await file.arrayBuffer();
  if (name.endsWith(".csv")) return parseCsv(new TextDecoder().decode(bytes));
  if (name.endsWith(".xlsx")) return gridFromXlsx(bytes);
  throw new ImportError("Upload a .xlsx or .csv file.");
}

async function gridFromXlsx(bytes: ArrayBuffer): Promise<string[][]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes);
  const ws = wb.worksheets[0];
  if (!ws) throw new ImportError("The workbook has no sheets.");
  const grid: string[][] = [];
  ws.eachRow({ includeEmpty: true }, (row, r) => {
    const out: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell, c) => {
      out[c - 1] = cell.text ?? "";
    });
    grid[r - 1] = Array.from(out, (v) => v ?? "");
  });
  return Array.from(grid, (r) => r ?? []);
}

/**
 * Accepts only a docs.google.com spreadsheet link and fetches its CSV export
 * from Google. The URL is rebuilt from the sheet id, so no user-supplied host
 * is ever fetched (no SSRF). The sheet must be shared "anyone with the link".
 */
export function parseSheetLink(link: string): { sheetId: string; gid: string } {
  let url: URL;
  try {
    url = new URL(link.trim());
  } catch {
    throw new ImportError("That is not a valid link.");
  }
  const id = /^\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/.exec(url.pathname)?.[1];
  if (url.protocol !== "https:" || url.hostname !== "docs.google.com" || !id) {
    throw new ImportError("Paste a docs.google.com/spreadsheets link.");
  }
  const gid = /(?:^|[#&?])gid=(\d+)/.exec(url.hash + url.search)?.[1] ?? "0";
  return { sheetId: id, gid };
}

const ALLOWED_FINAL_HOSTS = [/^docs\.google\.com$/, /\.googleusercontent\.com$/];

export async function gridFromGoogleSheet(sheetId: string, gid: string): Promise<string[][]> {
  const res = await fetch(
    `https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}/export?format=csv&gid=${encodeURIComponent(gid)}`,
    { redirect: "follow", signal: AbortSignal.timeout(15_000), cache: "no-store" },
  );
  const finalHost = new URL(res.url).hostname;
  if (!ALLOWED_FINAL_HOSTS.some((re) => re.test(finalHost))) throw new ImportError("Google redirected somewhere unexpected.");
  if (!res.ok || !(res.headers.get("content-type") ?? "").includes("text/csv")) {
    throw new ImportError("Could not read the sheet. Share it as \"Anyone with the link can view\", or upload it as .xlsx.");
  }
  const text = await res.text();
  if (text.length > MAX_BYTES) throw new ImportError("The sheet is larger than 5 MB.");
  return parseCsv(text);
}
