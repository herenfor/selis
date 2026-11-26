import { describe, expect, it } from "vitest";
import type { ShelfEntry } from "../shelf/types";
import { emptyReadingLog } from "./readingLogStore";
import { emptyLetterState, markLetterOpened, resolveActiveLetter, saveAnnualChoice } from "./letterSchedule";

const sampleEntries: ShelfEntry[] = [{
  id: "b1",
  title: "白鲸",
  creator: "梅尔维尔",
  fileName: "whale.epub",
  fileSize: 100,
  coverMime: "image/jpeg",
  addedAtMs: 1,
  lastReadAtMs: 1,
  spineIndex: 0,
  page: 0,
  progressPct: 10,
  anchorIndex: null,
  anchorRatio: null,
  isNew: false,
}];

describe("letterSchedule (Option B)", () => {
  it("does not deliver on a brand-new empty library without preview", () => {
    const res = resolveActiveLetter(new Date(2026, 10, 1, 9, 0), emptyLetterState(), emptyReadingLog(), []);
    expect(res).toBeNull();
  });

  it("delivers monthly letter on days 1-3 and folds away on the next day after opening", () => {
    let state = emptyLetterState();
    const nov1 = new Date(2026, 10, 1, 9, 0);
    const first = resolveActiveLetter(nov1, state, emptyReadingLog(), sampleEntries);
    expect(first?.kind).toBe("monthly");
    expect(first?.periodKey).toBe("2026-10");
    expect(first?.alreadyOpenedToday).toBe(false);

    // Opened on Nov 1 -> still re-openable on Nov 1, folds away on Nov 2.
    state = markLetterOpened(state, "2026-10", nov1);
    expect(resolveActiveLetter(new Date(2026, 10, 1, 22, 0), state, emptyReadingLog(), sampleEntries)?.alreadyOpenedToday).toBe(true);
    expect(resolveActiveLetter(new Date(2026, 10, 2, 8, 0), state, emptyReadingLog(), sampleEntries)).toBeNull();

    // Never opened on Nov 1 -> waits quietly through Nov 3, disappears Nov 4.
    const untouched = emptyLetterState();
    expect(resolveActiveLetter(new Date(2026, 10, 3, 18, 0), untouched, emptyReadingLog(), sampleEntries)?.periodKey).toBe("2026-10");
    expect(resolveActiveLetter(new Date(2026, 10, 4, 8, 0), untouched, emptyReadingLog(), sampleEntries)).toBeNull();
  });

  it("delivers annual letter Jan 1-7 and stores reader Book of the Year", () => {
    const jan3 = new Date(2027, 0, 3, 10, 0);
    const letter = resolveActiveLetter(jan3, emptyLetterState(), emptyReadingLog(), sampleEntries);
    expect(letter?.kind).toBe("annual");
    expect(letter?.year).toBe(2026);
    expect(resolveActiveLetter(new Date(2027, 0, 8, 10, 0), emptyLetterState(), emptyReadingLog(), sampleEntries)).toBeNull();

    const updated = saveAnnualChoice(emptyLetterState(), 2026, { bookKey: "b1", epigraph: "慢慢读完。" });
    expect(updated.annualChoices["2026"]).toEqual({ bookKey: "b1", epigraph: "慢慢读完。" });
  });

  it("supports explicit preview override on any date", () => {
    const midMonth = new Date(2026, 10, 26, 10, 0);
    expect(resolveActiveLetter(midMonth, emptyLetterState(), emptyReadingLog(), [])).toBeNull();
    expect(resolveActiveLetter(midMonth, emptyLetterState(), emptyReadingLog(), [], "annual")?.isPreview).toBe(true);
    expect(resolveActiveLetter(midMonth, emptyLetterState(), emptyReadingLog(), [], "empty")?.periodKey).toMatch(/^empty-/);
  });
});
