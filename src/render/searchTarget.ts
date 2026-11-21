import { resolveExactTextHits, type RawTextRange } from "../core/exactTextHits";
import { RUBY_ANNOTATION_SELECTOR } from "../core/rubyText";
import { resolveSearchOccurrence, type SearchOccurrence } from "../core/searchOccurrence";
import type { PreciseNavigationRequest } from "./paginator/helpers";
import { buildVisibleTextIndex, type IndexedTextNode, type VisibleTextIndex } from "./textAnchor";

interface BodySpan {
  entry: IndexedTextNode;
  start: number;
  end: number;
}

interface RubySearchIndex {
  points: string[];
  spans: BodySpan[];
}

// The paginator replaces the visible index when the chapter or projection changes.
const rubyIndexes = new WeakMap<VisibleTextIndex, RubySearchIndex>();

function rubySearchIndex(index: VisibleTextIndex): RubySearchIndex {
  const cached = rubyIndexes.get(index);
  if (cached) return cached;
  const points: string[] = [];
  const spans: BodySpan[] = [];
  for (const entry of index.nodes) {
    if (entry.node.parentElement?.closest(RUBY_ANNOTATION_SELECTOR)) continue;
    const start = points.length;
    for (let i = entry.start; i < entry.end; i++) points.push(index.codePoints[i]);
    spans.push({ entry, start, end: points.length });
  }
  const result = { points, spans };
  rubyIndexes.set(index, result);
  return result;
}

interface Match extends RawTextRange {
  /** When crossing ruby, each piece ends inside its own base text node. */
  entry?: IndexedTextNode;
}

function resolveOccurrence(index: VisibleTextIndex, occurrence: SearchOccurrence, hasRuby: boolean): Match[] | null {
  if (!hasRuby) return resolveSearchOccurrence(index.codePoints, occurrence);
  const body = rubySearchIndex(index);
  const hits = resolveSearchOccurrence(body.points, occurrence);
  if (!hits) return null;
  const matches: Match[] = [];
  let firstSpan = 0;
  for (const hit of hits) {
    while (firstSpan < body.spans.length && body.spans[firstSpan].end <= hit.start) firstSpan++;
    for (let i = firstSpan; i < body.spans.length; i++) {
      const span = body.spans[i];
      if (span.start >= hit.end) break;
      const delta = span.entry.start - span.start;
      matches.push({
        entry: span.entry,
        start: Math.max(span.start, hit.start) + delta,
        end: Math.min(span.end, hit.end) + delta,
      });
    }
  }
  return matches.length ? matches : null;
}

function rangeForMatch(doc: Document, index: VisibleTextIndex, match: Match): Range | null {
  const entry = match.entry;
  if (!entry) return index.rangeForOffsets(doc, match.start, match.end);
  const start = entry.rawStarts[match.start - entry.start];
  const end = entry.rawEnds[match.end - 1 - entry.start];
  try {
    const range = doc.createRange();
    range.setStart(entry.node, entry.projection?.toDisplay(start, "start") ?? start);
    range.setEnd(entry.node, entry.projection?.toDisplay(end, "end") ?? end);
    return range;
  } catch {
    // If the live text changed, reject the whole hit instead of painting a partial result.
    return null;
  }
}

export function dedupeHighlightRanges<T extends RawTextRange>(ranges: readonly T[]): T[] {
  const seen = new Set<string>();
  return ranges.filter(({ start, end }) => {
    const key = `${start}:${end}`;
    if (end <= start || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export type SearchTargetRequest = Pick<PreciseNavigationRequest, "textHits" | "occurrence" | "displayTarget">;

/** Match in base-text coordinates, then navigate in the existing chapter anchor coordinates.
 * For projected searches the canonical target and the painted display occurrence must both resolve. */
export function resolveSearchTarget(
  doc: Document,
  viewer: HTMLElement,
  index: VisibleTextIndex,
  request: SearchTargetRequest,
  projectionVersion?: string,
): { anchorOffset: number; ranges: Range[] | null } | null {
  if (request.displayTarget && request.displayTarget.projectionVersion !== projectionVersion) return null;
  const hasRuby = Boolean((request.occurrence || request.displayTarget) && viewer.querySelector(RUBY_ANNOTATION_SELECTOR));
  const canonical = request.occurrence
    ? resolveOccurrence(index, request.occurrence, hasRuby)
    : resolveExactTextHits(index.codePoints, request.textHits ?? []);
  if (!canonical?.length) return null;
  let paintIndex = index;
  let matches: Match[] = canonical;
  if (request.displayTarget) {
    paintIndex = buildVisibleTextIndex(doc, viewer);
    const display = resolveOccurrence(paintIndex, request.displayTarget.occurrence, hasRuby);
    if (!display) return null;
    matches = display;
  }
  const anchorOffset = canonical[0].start;
  const ranges: Range[] = [];
  for (const match of dedupeHighlightRanges(matches)) {
    const range = rangeForMatch(doc, paintIndex, match);
    if (!range) return { anchorOffset, ranges: null };
    ranges.push(range);
  }
  return { anchorOffset, ranges };
}
