import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { blockingFlags, parseCsv, parseOutline } from "../src";

const grid = parseCsv(readFileSync(new URL("./fixtures/sample-outline.csv", import.meta.url), "utf8"));
const outline = parseOutline(grid);
const codes = (n: number) => outline.rows.find((r) => r.lessonNumber === n)!.flags.map((f) => f.code);

describe("parseOutline", () => {
  it("reads the title and skips section rows", () => {
    expect(outline).toMatchObject({ grade: 6, unitNumber: 2, anchorText: "The Sample Novel" });
    expect(outline.rows.map((r) => r.lessonNumber)).toEqual([1, 2, 3]);
  });

  it("flags a unit number conflict as a decision, never picking a side", () => {
    const f = outline.unitFlags.find((x) => x.code === "unit_number_conflict");
    expect(f?.severity).toBe("error");
    expect(f?.options).toEqual(["Unit 2", "Unit 3"]);
  });

  it("parses codes and vocabulary without page refs", () => {
    const l1 = outline.rows[0]!;
    expect(l1.focusStandards).toEqual(["RL.6.1", "RL.6.4"]);
    expect(l1.vocabulary).toEqual(["gloomy", "creak"]);
    expect(l1.eldStandards).toEqual(["ELD.PI.6.6"]);
  });

  it("flags homework that breaks the chain to the next lesson", () => {
    expect(codes(1)).toContain("homework_continuity"); // assigns Ch. 2, lesson 2 focuses on Ch. 3
  });

  it("holds reviewer notes as constraints for the expert, not lesson text", () => {
    expect(outline.rows[0]!.reviewerNotes).toEqual(["Cap at 6 words per lesson"]);
    expect(codes(2)).toContain("excerpt_needs_selection");
  });

  it("flags double lessons, unknown codes, media literacy, missing ELD", () => {
    expect(codes(2)).toEqual(expect.arrayContaining(["double_lesson_days", "unknown_standard", "unrecognized_media_literacy", "missing_eld"]));
  });

  it("flags malformed filenames and instruction-like text", () => {
    expect(codes(3)).toEqual(expect.arrayContaining(["filename_malformed", "instruction_like_text"]));
  });

  it("lists blocking flags", () => {
    expect(blockingFlags(outline).map((f) => f.code).sort()).toEqual(["double_lesson_days", "unit_number_conflict"]);
  });
});
