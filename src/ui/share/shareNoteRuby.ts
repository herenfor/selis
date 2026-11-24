import { parseInertHtml } from "../../core/inertHtml";
import type { Book } from "../../core/types";
import { projectRubyQuote } from "../../render/rubyQuote";
import { buildVisibleTextIndex, normalizeAnchorText } from "../../render/textAnchor";
import type { ReaderNote } from "../notes";
import type { ShareDraft } from "../readerForeground";

/** Reopen a note's source even when its chapter is no longer mounted. */
export async function addNoteRuby(book: Book, note: ReaderNote, draft: ShareDraft): Promise<ShareDraft> {
  try {
    const bytes = await book.readResource?.(note.chapterPath) ?? book.resources.get(note.chapterPath)?.data;
    if (!bytes?.length) return draft;
    const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? "utf-16le" : bytes[0] === 0xfe && bytes[1] === 0xff ? "utf-16be" : "utf-8";
    const markup = new TextDecoder(encoding).decode(bytes);
    if (!/<ruby[\s>]/iu.test(markup)) return draft;
    // Detached content only. The rendered index also omits hidden fallback brackets.
    const doc = parseInertHtml(markup);
    doc.querySelectorAll("ruby rp").forEach((element) => element.setAttribute("hidden", ""));
    const index = buildVisibleTextIndex(doc, doc.body);
    const start = note.startTextOffset, end = note.endTextOffset;
    const slices = index.sourceSlicesForOffsets(start, end);
    if (!slices || normalizeAnchorText(slices.map(({ text }) => text).join("")) !== normalizeAnchorText(note.selectedText)) return draft;
    if (note.startTextSnippet && !index.snippetAt(start)?.startsWith(note.startTextSnippet)) return draft;
    if (note.endTextSnippet && !index.snippetBefore(end)?.endsWith(note.endTextSnippet)) return draft;
    const rubyQuote = projectRubyQuote(slices);
    return rubyQuote?.text.trim() ? { ...draft, quote: rubyQuote.text, rubyQuote } : draft;
  } catch {
    return draft;
  }
}
