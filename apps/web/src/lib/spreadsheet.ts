import "server-only";
import ExcelJS from "exceljs";
import { parseCsv, sheetExportUrl } from "@nl/schema";

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
 * Fetches a linked sheet's CSV export from Google (see parseSheetLink). The
 * sheet must be shared "anyone with the link".
 */
const ALLOWED_FINAL_HOSTS = [/^docs\.google\.com$/, /\.googleusercontent\.com$/];

export async function gridFromGoogleSheet(sheetId: string, gid: string | null): Promise<string[][]> {
  const res = await fetch(
    sheetExportUrl(sheetId, gid),
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
