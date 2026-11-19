import { describe, expect, it } from "vitest";
import type { SelectionContextPayload } from "../../render/paginator";
import type { ReaderNote } from "../notes";
import { shareDraftForNote, shareDraftForSelection } from "./shareDraftBuilder";
import { buildShareExcerpt, createShareSource, editShareRange, paintShareInk } from "./shareSourceModel";

function note(id: string, start: number, end: number, extra: Partial<ReaderNote> = {}): ReaderNote {
  return { id, spineIndex: 4, chapterPath: "c.xhtml", startTextOffset: start, endTextOffset: end,
    startTextSnippet: "", endTextSnippet: "", selectedText: "石。", content: id, style: "highlight", color: "yellow",
    createdAtMs: 0, updatedAtMs: 0, ...extra,
  };
}

const selection = {
  chapterPath: "c.xhtml", startTextOffset: 10, endTextOffset: 18,
  selectedText: "甲 😀。\n 乙石。 丙。", startTextSnippet: null, endTextSnippet: null,
  rect: { left: 0, right: 10, top: 0, bottom: 10 },
} as SelectionContextPayload;

describe("ER-0190 share source", () => {
  it("keeps only positive overlaps in the same chapter and maps code points across whitespace and emoji", () => {
    const notes = [note("last", 16, 19), note("after", 18, 19), note("before", 7, 10),
      note("first", 9, 12), note("hidden", 14, 16), note("other", 10, 17, { chapterPath: "d.xhtml" }),
      note("middle", 14, 15, { content: "" })];
    const source = createShareSource(shareDraftForSelection(selection, 4, notes, new Set(["hidden"])));
    expect(source.annotations.map(({ id }) => id)).toEqual(["first", "middle", "last"]);
    expect(source.annotations.map(({ start, end }) => source.passage.slice(start, end))).toEqual(["甲 😀", "石", "丙。"]);
    expect(source.sentences.map(({ text }) => text).join("")).toBe(source.passage);
    expect(buildShareExcerpt(source, source.full, [], new Set()).included.map(({ id }) => id)).toEqual(["first", "last"]);
  });

  it("rediscovers notes after restoring either end and keeps exclusions and share-only color", () => {
    const source = createShareSource(shareDraftForSelection(selection, 4, [note("first", 11, 12), note("last", 16, 17)], new Set()));
    const trim = editShareRange(editShareRange(source.full, source.full, "first", 1), source.full, "last", -1);
    const excluded = new Set(["last"]);
    const inks = paintShareInk([], { start: 1, end: source.passage.length - 1 }, "blue");
    const short = buildShareExcerpt(source, trim, inks, excluded);
    expect(short.quote).toBe("乙石。");
    expect(short.cardInks).toEqual([{ start: 0, end: 3, ink: "blue" }]);
    expect(short.notes).toEqual([]);
    expect(editShareRange(trim, source.full, "first", 1)).toEqual(trim);
    expect(buildShareExcerpt(source, source.full, inks, excluded).included.map(({ id }) => id)).toEqual(["first"]);
    expect(paintShareInk(inks, { start: 2, end: 4 })).toMatchObject([{ start: 1, end: 2 }, { start: 4 }]);
  });

  it("keeps notes after Ruby aligned and rebases readings when trimming the excerpt", () => {
    const rubySelection = {
      ...selection, startTextOffset: 0, endTextOffset: 10,
      rubyQuote: { text: "甲。 東京乙。", offsets: [0, 1, 2, 3, 8, 9], readings: [{ start: 2, end: 4, text: "とうきょう" }] },
    };
    const draft = shareDraftForSelection(rubySelection, 4, [note("reading-only", 4, 8), note("after-ruby", 8, 9)], new Set());
    const source = createShareSource(draft);
    expect(source.rubies).toEqual([{ start: 3, end: 5, text: "とうきょう" }]);
    expect(source.annotations).toMatchObject([{ id: "after-ruby", start: 5, end: 6 }]);
    const trimmed = buildShareExcerpt(source, { first: 1, last: 1 }, [], new Set());
    expect(trimmed.quote).toBe("東京乙。");
    expect(trimmed.cardRubies).toEqual([{ start: 0, end: 2, text: "とうきょう" }]);
    expect(trimmed.cardMarks).toMatchObject([{ id: "after-ruby", start: 2, end: 3 }]);
  });

  it("uses aligned original text for a length-changing projection and opens full text from the note panel", () => {
    const notes = [note("picked", 14, 16)];
    const draft = shareDraftForSelection({ ...selection, selectedText: "译文", originalSelectedText: selection.selectedText }, 4, notes, new Set());
    expect(draft.quote).toBe(selection.selectedText);
    expect(shareDraftForNote("picked", notes, [])?.quote).toBe("石。");
    expect(shareDraftForNote("picked", notes, ["picked"])).toBeUndefined();
  });
});
