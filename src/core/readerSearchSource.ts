import type { ArchiveClient } from './selectiveArchive';
import type { Book } from './types';

export type NativeResultRequest = { mode: 'count' } | { mode: 'window'; offset: number; limit: number; includeTarget?: boolean };
export interface NativeTarget {
  textOffset: number; textSnippet: string; matchedText: string;
  textHits: import('./exactTextHits').ExactTextHit[]; before: string; after: string;
}
export interface NativeMatch { ranges: [number, number][]; keywords: boolean; context: number[]; target?: NativeTarget }
export type ScannedChapter = { kind: 'miss' | 'compatibility' } |
  { kind: 'count'; count: number } | { kind: 'window'; rows: NativeMatch[] } |
  { kind: 'match'; text: string; starts: number[] | null };
export type ScanChapters = (paths: readonly string[], phrase: string, tokens: string[], signal?: AbortSignal, request?: NativeResultRequest) => Promise<ScannedChapter[]>;

/** Desktop EPUB reading may own a JS archive. Acquire the verified native copy only on first search. */
export function attachSearchArchive(book: Book, open: () => Promise<ArchiveClient>): void {
  let closed = false;
  let pending: Promise<ArchiveClient | null> | undefined;
  let owned: ArchiveClient | null = null;
  const readerArchive = book.archive;
  book.scanChapters = async (paths, phrase, tokens, signal, request) => {
    pending ??= open().then(archive => {
      if (closed || !archive.scanChapters) { archive.close(); return null; }
      owned = archive;
      return archive;
    }).catch(() => null); // The already-open book remains usable through its reader source.
    const archive = await pending;
    if (closed || signal?.aborted) throw new DOMException('搜索已取消', 'AbortError');
    return archive?.scanChapters ? archive.scanChapters(paths, phrase, tokens, signal, request) : paths.map(() => ({ kind: 'compatibility' }));
  };
  book.archive = { close() { closed = true; owned?.close(); readerArchive?.close(); } };
}
