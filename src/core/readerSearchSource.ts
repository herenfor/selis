import type { ArchiveClient } from './selectiveArchive';
import type { Book } from './types';

export type ScannedChapter = { kind: 'miss' | 'compatibility' } |
  { kind: 'match'; text: string; starts: number[] | null };
export type ScanChapters = (paths: readonly string[], phrase: string, tokens: string[], signal?: AbortSignal) => Promise<ScannedChapter[]>;

/** Desktop EPUB reading may own a JS archive. Acquire the verified native copy only on first search. */
export function attachSearchArchive(book: Book, open: () => Promise<ArchiveClient>): void {
  let closed = false;
  let pending: Promise<ArchiveClient | null> | undefined;
  let owned: ArchiveClient | null = null;
  const readerArchive = book.archive;
  book.scanChapters = async (paths, phrase, tokens, signal) => {
    pending ??= open().then(archive => {
      if (closed || !archive.scanChapters) { archive.close(); return null; }
      owned = archive;
      return archive;
    }).catch(() => null); // The already-open book remains usable through its reader source.
    const archive = await pending;
    if (closed || signal?.aborted) throw new DOMException('搜索已取消', 'AbortError');
    return archive?.scanChapters ? archive.scanChapters(paths, phrase, tokens, signal) : paths.map(() => ({ kind: 'compatibility' }));
  };
  book.archive = { close() { closed = true; owned?.close(); readerArchive?.close(); } };
}
