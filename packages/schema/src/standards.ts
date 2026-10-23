import grade6 from "./standards.grade6.json";

export type Framework = "ca_ccss_ela" | "ca_eld" | "media_literacy";

const CCSS = new Set<string>(grade6.ca_ccss_ela);
const ELD = new Set<string>(grade6.ca_eld);

/** Matches CCSS-style codes (RL.6.9, L.6.4.b) and CA ELD codes (ELD.PI.6.6, ELD.PII.6.2.a). */
const CODE_PATTERN = /\b(?:ELD\.P(?:I|II)\.\d{1,2}\.\d{1,2}(?:\.[a-z])?|(?:RL|RI|RF|W|SL|L)\.\d{1,2}\.\d{1,2}(?:\.[a-z])?)\b/g;

export function extractCodes(cell: string | undefined | null): string[] {
  if (!cell) return [];
  return [...new Set(cell.match(CODE_PATTERN) ?? [])];
}

export function frameworkOf(code: string): Framework | null {
  if (CCSS.has(code)) return "ca_ccss_ela";
  if (ELD.has(code)) return "ca_eld";
  return null;
}

export function isKnownCode(code: string): boolean {
  return frameworkOf(code) !== null;
}

export function allCodes(): { code: string; framework: Framework; grade: number; strand: string }[] {
  return [
    ...grade6.ca_ccss_ela.map((code) => ({ code, framework: "ca_ccss_ela" as const, grade: 6, strand: code.split(".")[0]! })),
    ...grade6.ca_eld.map((code) => ({ code, framework: "ca_eld" as const, grade: 6, strand: code.split(".")[1]! })),
  ];
}

export const CCSS_URL = "https://www.cde.ca.gov/be/st/ss/documents/finalelaccssstandards.pdf";
export const ELD_URL = "https://www.cde.ca.gov/sp/el/er/eldstandards.asp";

/** Required notice wherever Common Core text is shown (NGA/CCSSO public license). */
export const CCSS_NOTICE =
  "© Copyright 2010. National Governors Association Center for Best Practices and Council of Chief State School Officers. All rights reserved.";

export function officialUrl(code: string): string | null {
  const fw = frameworkOf(code);
  if (fw === "ca_ccss_ela") return CCSS_URL;
  if (fw === "ca_eld") return ELD_URL;
  return null;
}
