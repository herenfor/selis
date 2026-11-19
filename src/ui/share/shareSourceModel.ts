import { normalizeAnchorText } from "../../render/textAnchor";
import type { ShareDraft } from "../readerForeground";
import { shareAnnotations, type ShareAnnotation, type ShareTextRange } from "./shareDraftBuilder";
import { splitSentences, tidyPassage } from "./shareText";

export type ShareInk = "blue" | "red" | "green";
export const SHARE_INKS: Record<ShareInk, readonly [light: string, dark: string]> = {
  blue: ["#315c87", "#9cc6f8"], red: ["#994d3e", "#f2aa9b"], green: ["#476749", "#9fd698"],
};
export interface ShareInkRange extends ShareTextRange { ink: ShareInk }
export interface ShareRuby extends ShareTextRange { text: string }
export interface ShareSentence extends ShareTextRange { text: string }
export interface ShareSentenceRange { first: number; last: number }

export function createShareSource(draft: ShareDraft) {
  const passage = tidyPassage(draft.quote);
  let end = 0;
  const sentences = splitSentences(passage).map((text): ShareSentence => {
    const start = end;
    end += text.length;
    return { text, start, end };
  });
  const annotations = shareAnnotations(draft, passage);
  if (!draft.source && draft.note.trim()) {
    annotations.push({ id: "legacy", note: draft.note.trim(), start: 0, end: passage.length, unmapped: true });
  }
  const positions: ShareTextRange[] = [];
  const readings = draft.rubyQuote?.readings ?? [];
  if (readings.length) {
    let start = 0;
    for (const char of passage) {
      const end = start + char.length;
      if (normalizeAnchorText(char)) positions.push({ start, end });
      start = end;
    }
  }
  const rubies = readings.flatMap((reading): ShareRuby[] => {
    const first = positions[reading.start], last = positions[reading.end - 1];
    if (!first || !last) return [];
    return [{ start: first.start, end: last.end, text: reading.text }];
  }).sort((a, b) => a.start - b.start);
  return { passage, sentences, annotations, rubies, full: { first: 0, last: sentences.length - 1 } };
}

export function editShareRange(range: ShareSentenceRange, full: ShareSentenceRange, edge: "first" | "last", step: number): ShareSentenceRange {
  return edge === "first"
    ? { ...range, first: Math.max(0, Math.min(range.last, range.first + step)) }
    : { ...range, last: Math.max(range.first, Math.min(full.last, range.last + step)) };
}

export function intersectShareRange(range: ShareTextRange, bounds: ShareTextRange): ShareTextRange | null {
  const start = Math.max(range.start, bounds.start);
  const end = Math.min(range.end, bounds.end);
  return start < end ? { start, end } : null;
}

export function buildShareExcerpt(source: ReturnType<typeof createShareSource>, range: ShareSentenceRange, inks: readonly ShareInkRange[], excluded: ReadonlySet<string>) {
  const rawStart = source.sentences[range.first].start;
  const raw = source.passage.slice(rawStart, source.sentences[range.last].end);
  const quote = raw.trim();
  const start = rawStart + raw.length - raw.trimStart().length;
  const bounds = { start, end: start + quote.length };
  const hits = source.annotations.filter((mark) => intersectShareRange(mark, bounds));
  const marks = hits.filter((mark) => !mark.unmapped);
  const notes = hits.filter((mark) => mark.note);
  return {
    quote, bounds, range, marks, notes,
    included: notes.filter((note) => !excluded.has(note.id)),
    cardMarks: relativeRanges(marks, bounds),
    cardInks: relativeRanges(inks, bounds),
    cardRubies: relativeRanges(source.rubies.filter((ruby) => bounds.start <= ruby.start && ruby.end <= bounds.end), bounds),
  };
}

function relativeRanges<T extends ShareTextRange>(items: readonly T[], bounds: ShareTextRange): T[] {
  return items.flatMap((item) => {
    const overlap = intersectShareRange(item, bounds);
    return overlap ? [{ ...item, start: overlap.start - bounds.start, end: overlap.end - bounds.start }] : [];
  });
}

export function paintShareInk(inks: readonly ShareInkRange[], range: ShareTextRange, ink?: ShareInk): ShareInkRange[] {
  const next = inks.flatMap((item) => {
    if (!intersectShareRange(item, range)) return [item];
    const remaining: ShareInkRange[] = [];
    if (item.start < range.start) remaining.push({ ...item, end: range.start });
    if (item.end > range.end) remaining.push({ ...item, start: range.end });
    return remaining;
  });
  if (ink) next.push({ ...range, ink });
  next.sort((a, b) => a.start - b.start);
  const merged: ShareInkRange[] = [];
  for (const item of next) {
    const previous = merged[merged.length - 1];
    if (previous?.end === item.start && previous.ink === item.ink) merged[merged.length - 1] = { ...previous, end: item.end };
    else merged.push(item);
  }
  return merged;
}

export function shareSourceRuns(range: ShareTextRange, marks: readonly ShareAnnotation[], inks: readonly ShareInkRange[], picked?: ShareTextRange | null) {
  const boundaries = new Set([range.start, range.end]);
  for (const item of [...marks, ...inks, ...(picked ? [picked] : [])]) {
    const overlap = intersectShareRange(range, item);
    if (overlap) { boundaries.add(overlap.start); boundaries.add(overlap.end); }
  }
  const cuts = [...boundaries].sort((a, b) => a - b);
  return cuts.slice(0, -1).map((start, i) => ({
    start, end: cuts[i + 1],
    mark: marks.find((item) => item.start <= start && start < item.end),
    ink: inks.find((item) => item.start <= start && start < item.end)?.ink,
    picked: !!picked && picked.start <= start && start < picked.end,
  }));
}

/** Ruby remains one inline group even when its base contains several marks. */
export function shareRubySegments(range: ShareTextRange, rubies: readonly ShareRuby[]) {
  const segments: (ShareTextRange & { reading?: string })[] = [];
  let start = range.start;
  for (const ruby of rubies) {
    if (ruby.start < start || ruby.end > range.end) continue;
    if (start < ruby.start) segments.push({ start, end: ruby.start });
    segments.push({ start: ruby.start, end: ruby.end, reading: ruby.text });
    start = ruby.end;
  }
  if (start < range.end) segments.push({ start, end: range.end });
  return segments;
}
