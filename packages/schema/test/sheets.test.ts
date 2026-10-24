import { describe, expect, it } from "vitest";
import { parseSheetLink, SheetLinkError, sheetExportUrl } from "../src/sheets";

const ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";

describe("Google Sheets links", () => {
  it("leaves the tab id out when the link has none, so Google exports the first tab", () => {
    const { sheetId, gid } = parseSheetLink(`https://docs.google.com/spreadsheets/d/${ID}/edit?usp=sharing`);
    expect(gid).toBeNull();
    expect(sheetExportUrl(sheetId, gid)).toBe(`https://docs.google.com/spreadsheets/d/${ID}/export?format=csv`);
  });

  it("keeps an explicit tab id from the hash or the query", () => {
    expect(parseSheetLink(`https://docs.google.com/spreadsheets/d/${ID}/edit#gid=1723306320`).gid).toBe("1723306320");
    expect(parseSheetLink(`https://docs.google.com/spreadsheets/d/${ID}/edit?gid=0`).gid).toBe("0");
    expect(sheetExportUrl(ID, "42")).toBe(`https://docs.google.com/spreadsheets/d/${ID}/export?format=csv&gid=42`);
  });

  it("refuses any other host or scheme", () => {
    for (const link of [`https://evil.example/spreadsheets/d/${ID}`, `http://docs.google.com/spreadsheets/d/${ID}`, "not a link", `https://docs.google.com.evil.example/spreadsheets/d/${ID}`])
      expect(() => parseSheetLink(link)).toThrow(SheetLinkError);
  });
});
