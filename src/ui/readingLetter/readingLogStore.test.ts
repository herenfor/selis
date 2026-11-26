import { describe, expect, it } from "vitest";
import type { ShelfEntry } from "../shelf/types";
import {
  bookKeyForEntry,
  buildAnnualLetterData,
  buildMonthlyLetterData,
  emptyReadingLog,
  markBookFinishedInLog,
  MAX_DELTA_SECONDS,
  recordReadingDelta,
} from "./readingLogStore";

function makeEntry(overrides: Partial<ShelfEntry> = {}): ShelfEntry {
  return {
    id: "book-1",
    title: "白鲸",
    creator: "梅尔维尔",
    fileName: "whale.epub",
    fileSize: 1024,
    coverMime: "image/jpeg",
    addedAtMs: 1,
    lastReadAtMs: 1,
    spineIndex: 0,
    page: 0,
    progressPct: 45,
    anchorIndex: null,
    anchorRatio: null,
    isNew: false,
    ...overrides,
  };
}

describe("readingLogStore", () => {
  it("clamps large deltas and ignores sub-threshold increments", () => {
    let log = emptyReadingLog();
    const t0 = new Date(2026, 9, 12, 21, 35);
    log = recordReadingDelta(log, { bookKey: "h1", title: "白鲸", creator: "梅尔维尔", seconds: 4, now: t0 });
    expect(Object.keys(log.days)).toHaveLength(0);

    log = recordReadingDelta(log, { bookKey: "h1", title: "白鲸", creator: "梅尔维尔", seconds: 900, sessionSeconds: 1800, now: t0 });
    expect(log.days["2026-10-12"]?.books.h1).toBe(MAX_DELTA_SECONDS);
    expect(log.days["2026-10-12"]?.hours["21"]).toBe(MAX_DELTA_SECONDS);
    expect(log.longestByMonth["2026-10"]).toEqual({ day: 12, bookKey: "h1", seconds: 1800 });
  });

  it("aggregates monthly reading days, proportions, notes and book exclusions", () => {
    const entries = [
      makeEntry({
        id: "1",
        contentHash: "h-whale",
        title: "白鲸",
        progressPct: 68,
        notes: [
          {
            id: "n1",
            spineIndex: 1,
            chapterPath: "ch1.xhtml",
            startTextOffset: 0,
            endTextOffset: 10,
            startTextSnippet: "大海",
            endTextSnippet: "出海",
            selectedText: "每当我心里泛起潮湿阴郁的十一月，便知道该再一次出海了。",
            content: "十月夜晚读到的段落",
            createdAtMs: new Date(2026, 9, 12, 22, 0).getTime(),
            updatedAtMs: new Date(2026, 9, 12, 22, 0).getTime(),
          },
          {
            id: "n2",
            spineIndex: 1,
            chapterPath: "ch2.xhtml",
            startTextOffset: 0,
            endTextOffset: 5,
            startTextSnippet: "九月",
            endTextSnippet: "九月",
            selectedText: "九月旧笔记不应混入十月。",
            content: "",
            createdAtMs: new Date(2026, 8, 9, 20, 0).getTime(),
            updatedAtMs: new Date(2026, 8, 9, 20, 0).getTime(),
          },
        ],
      }),
      makeEntry({ id: "2", contentHash: "h-alice", title: "爱丽丝", creator: "卡罗尔", progressPct: 100 }),
    ];

    expect(bookKeyForEntry(entries[0])).toBe("h-whale");
    let log = emptyReadingLog();
    log = recordReadingDelta(log, { bookKey: "h-whale", title: "白鲸", creator: "梅尔维尔", seconds: 180, now: new Date(2026, 9, 12, 21, 10) });
    log = recordReadingDelta(log, { bookKey: "h-alice", title: "爱丽丝", creator: "卡罗尔", seconds: 120, now: new Date(2026, 9, 15, 19, 0) });
    log = markBookFinishedInLog(log, "h-alice", "爱丽丝", "卡罗尔", new Date(2026, 9, 23, 20, 0));

    const model = buildMonthlyLetterData(log, entries, 2026, 10);
    expect(model.totalSeconds).toBe(300);
    expect(model.activeDays).toBe(2);
    expect(model.finishedCount).toBe(1);
    expect(model.books.map((b) => b.bookKey)).toEqual(["h-whale", "h-alice"]);
    expect(model.days[12]?.notes).toHaveLength(1);
    expect(model.excerpts).toHaveLength(1);

    const hidden = buildMonthlyLetterData(log, entries, 2026, 10, new Set(["h-whale"]));
    expect(hidden.totalSeconds).toBe(120);
    expect(hidden.activeDays).toBe(1);
    expect(hidden.books.map((b) => b.bookKey)).toEqual(["h-alice"]);
    expect(hidden.excerpts).toHaveLength(0);
  });

  it("aggregates full calendar year for annual letter", () => {
    const entries = [makeEntry({ id: "1", contentHash: "h1", title: "瓦尔登湖", progressPct: 100 })];
    let log = emptyReadingLog();
    log = recordReadingDelta(log, { bookKey: "h1", title: "瓦尔登湖", creator: "梭罗", seconds: 180, now: new Date(2026, 0, 5, 22, 0) });
    log = recordReadingDelta(log, { bookKey: "h1", title: "瓦尔登湖", creator: "梭罗", seconds: 150, now: new Date(2026, 11, 20, 21, 0) });
    const annual = buildAnnualLetterData(log, entries, 2026);
    expect(annual.totalSeconds).toBe(330);
    expect(annual.totalBooks).toBe(1);
    expect(annual.activeDays).toBe(2);
    expect(annual.months[0].days).toBe(1);
    expect(annual.months[11].topBookKey).toBe("h1");
    expect(annual.finishedCount).toBe(1);
  });
});
