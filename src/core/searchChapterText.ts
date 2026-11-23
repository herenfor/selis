import { normalizeQueryPart } from './corpus';

/** Match buildDocument's per-code-point normalization, without allocating coordinate tables on misses. */
export function normalizeSearchChapter(text: string): string {
  return text.replace(/[^\u4e00-\u9fff\x00-\x7f]|[A-Z\x09-\x0d ]/gu, point =>
    point.normalize('NFKC').toLowerCase().replace(/[\p{White_Space}\u00ad]/gu, ''));
}

export function compileBookQuery(query: string) {
  const phrase = normalizeQueryPart(query);
  const tokens = query.trim().split(/\s+/u).map(normalizeQueryPart).filter(Boolean);
  return { phrase, tokens };
}

export function mayMatchChapter(text: string, { phrase, tokens }: ReturnType<typeof compileBookQuery>): boolean {
  return text.includes(phrase) || (tokens.length > 1 && tokens.every(token => text.includes(token)));
}

interface ChapterText { text: string; normalized: string }

export class ChapterTextCache {
  private readonly entries = new Map<number, ChapterText>();
  private bytes = 0;

  get(index: number) { return this.entries.get(index); }

  remember(index: number, text: string): ChapterText {
    const cached = this.get(index);
    if (cached) return cached;
    const entry = { text, normalized: normalizeSearchChapter(text) };
    const size = this.sizeOf(entry);
    const budget = 32 * 1024 * 1024;
    if (size <= budget) {
      this.entries.set(index, entry);
      this.bytes += size;
      while (this.bytes > budget) {
        const key = this.entries.keys().next().value!;
        this.bytes -= this.sizeOf(this.entries.get(key)!);
        this.entries.delete(key);
      }
    }
    return entry;
  }

  clear() { this.entries.clear(); this.bytes = 0; }

  private sizeOf(entry: ChapterText) { return 128 + (entry.text.length + entry.normalized.length) * 2; }
}
