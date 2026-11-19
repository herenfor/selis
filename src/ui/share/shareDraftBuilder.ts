import { codePointLength, normalizeAnchorText } from "../../render/textAnchor";
import type { SelectionContextPayload } from "../../render/paginator";
import type { ReaderNote } from "../notes";
import type { ShareDraft } from "../readerForeground";

export interface ShareTextRange { start: number; end: number }

export interface ShareAnnotation extends ShareTextRange {
  id: string;
  note: string;
  style?: ReaderNote["style"];
  color?: ReaderNote["color"];
  unmapped?: boolean;
}

/** Map chapter code-point offsets to UTF-16 offsets in the displayed excerpt. */
export function shareAnnotations(draft: ShareDraft, passage: string): ShareAnnotation[] {
  if (!draft.source) return [];
  const { start, end, notes } = draft.source;
  const positions: (ShareTextRange & { offset: number })[] = [];
  const baseOffsets = draft.rubyQuote?.offsets;
  let offset = 0;
  for (const char of passage) {
    const next = offset + char.length;
    if (normalizeAnchorText(char)) {
      const canonicalOffset = baseOffsets?.[positions.length] ?? start + positions.length;
      positions.push({ start: offset, end: next, offset: canonicalOffset });
    }
    offset = next;
  }
  // A projected quote can change length. Never paint unrelated text with unverified offsets.
  const aligned = positions.length === (baseOffsets?.length ?? end - start);
  const lowerBound = (canonicalOffset: number) => {
    let lower = 0, upper = positions.length;
    while (lower < upper) {
      const middle = Math.floor((lower + upper) / 2);
      if (positions[middle].offset < canonicalOffset) lower = middle + 1;
      else upper = middle;
    }
    return lower;
  };
  return notes.flatMap((note): ShareAnnotation[] => {
    if (note.endTextOffset <= start || note.startTextOffset >= end) return [];
    const common = { id: note.id, note: note.content.trim(), style: note.style, color: note.color };
    if (!aligned) return [{ ...common, start: 0, end: passage.length, unmapped: true }];
    const first = lowerBound(note.startTextOffset), afterLast = lowerBound(note.endTextOffset);
    return first < afterLast ? [{ ...common, start: positions[first].start, end: positions[afterLast - 1].end }] : [];
  });
}

type SourceRange = Pick<ReaderNote, "chapterPath" | "startTextOffset" | "endTextOffset">;

function draftForRange(quote: string, range: SourceRange, spineIndex: number, notes: readonly ReaderNote[], hiddenIds: ReadonlySet<string>, preferred?: ReaderNote): ShareDraft {
  const { chapterPath, startTextOffset: start, endTextOffset: end } = range;
  const related = notes.filter((note) => (
    note.spineIndex === spineIndex && note.chapterPath === chapterPath && !hiddenIds.has(note.id)
    && note.startTextOffset < end && start < note.endTextOffset
  )).sort((a, b) => a.startTextOffset - b.startTextOffset || a.endTextOffset - b.endTextOffset);
  return { quote, note: "", accent: preferred?.color, spineIndex, source: { start, end, notes: related } };
}

export function shareDraftForSelection(selection: SelectionContextPayload, spineIndex: number, notes: readonly ReaderNote[], hiddenIds: ReadonlySet<string>, targetId?: string): ShareDraft {
  const { selectedText, originalSelectedText, startTextOffset, endTextOffset } = selection;
  const quote = codePointLength(normalizeAnchorText(selectedText)) === endTextOffset - startTextOffset
    ? selectedText : originalSelectedText ?? selectedText;
  const draft = draftForRange(quote, selection, spineIndex, notes, hiddenIds, notes.find((note) => note.id === targetId && !hiddenIds.has(note.id)));
  return selection.rubyQuote ? { ...draft, quote: selection.rubyQuote.text, rubyQuote: selection.rubyQuote } : draft;
}

export function shareDraftForNote(id: string, notes: readonly ReaderNote[], hiddenIds: readonly string[]): ShareDraft | undefined {
  const note = notes.find((candidate) => candidate.id === id);
  const hidden = new Set(hiddenIds);
  if (note && !hidden.has(note.id)) return draftForRange(note.selectedText, note, note.spineIndex, notes, hidden, note);
}
