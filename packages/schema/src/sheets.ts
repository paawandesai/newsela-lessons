/** A Google Sheets link the importer refuses. The message is shown to the content expert. */
export class SheetLinkError extends Error {}

/**
 * Accepts only a docs.google.com spreadsheet link and reduces it to a sheet id
 * and optional tab id. The export URL is rebuilt from those, so no
 * user-supplied host is ever fetched (no SSRF).
 */
export function parseSheetLink(link: string): { sheetId: string; gid: string | null } {
  let url: URL;
  try {
    url = new URL(link.trim());
  } catch {
    throw new SheetLinkError("That is not a valid link.");
  }
  const id = /^\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/.exec(url.pathname)?.[1];
  if (url.protocol !== "https:" || url.hostname !== "docs.google.com" || !id) {
    throw new SheetLinkError("Paste a docs.google.com/spreadsheets link.");
  }
  // No gid means "the first tab". Google rejects gid=0 when the first tab has another id, so leave it out.
  const gid = /(?:^|[#&?])gid=(\d+)/.exec(url.hash + url.search)?.[1] ?? null;
  return { sheetId: id, gid };
}

/** The CSV export of one tab, or of the first tab when there is no gid. */
export function sheetExportUrl(sheetId: string, gid: string | null): string {
  const base = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}/export?format=csv`;
  return gid ? `${base}&gid=${encodeURIComponent(gid)}` : base;
}
