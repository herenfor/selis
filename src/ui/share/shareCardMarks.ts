import { isDarkPaper } from "../../config/customThemes";
import { highlightInk, themeHighlightInk } from "../../config/readerPalette";
import { resolveNoteHighlightLook } from "../../render/noteHighlights";
import type { ShareAnnotation } from "./shareDraftBuilder";
import type { ShareCardContent, ShareCardPalette } from "./shareCardModel";
import { SHARE_INKS, type ShareRuby } from "./shareSourceModel";
import type { ShareCardContext } from "./shareCardRenderer";

export function shareMarkLook(mark: ShareAnnotation, dark: boolean) {
  const look = resolveNoteHighlightLook(mark);
  const theme = themeHighlightInk(dark ? "dark" : "light");
  return { ...(look?.color ? highlightInk(look.color, dark) ?? theme : theme), style: look?.style ?? "underline" };
}

export interface CardGlyph {
  offset?: number;
  ruby?: ShareRuby; char: string; mark?: ShareAnnotation; ink?: string }

/** The breaker discards wrap whitespace. Match each line from the last consumed offset. */
export function shareCardGlyphs(quote: string, content: ShareCardContent, showMarks: boolean, palette: ShareCardPalette) {
  const marks = showMarks ? content.marks ?? [] : [];
  const inks = content.inks ?? [];
  const rubies = new Map(content.rubies?.map((ruby) => [ruby.start, ruby]));
  if (!marks.length && !inks.length && !rubies.size) return undefined;
  const dark = isDarkPaper(palette.bg);
  let offset = 0;
  return (line: string): CardGlyph[] => [...line].map((char) => {
    while (/\s/u.test(quote.charAt(offset)) && !quote.startsWith(char, offset)) offset++;
    if (!quote.startsWith(char, offset)) return { char };
    const start = offset;
    offset += char.length;
    const mark = marks.find((item) => item.start <= start && start < item.end);
    const ink = inks.find((item) => item.start <= start && start < item.end)?.ink;
    return { char, offset: start, ruby: rubies.get(start), mark, ink: ink ? SHARE_INKS[ink][dark ? 1 : 0] : undefined };
  });
}

export type CardGlyphMapper = ReturnType<typeof shareCardGlyphs>;

export function drawCardMarks(ctx: ShareCardContext, glyphs: readonly CardGlyph[], positions: readonly number[], baseline: number, px: number, palette: ShareCardPalette, vertical = false) {
  const dark = isDarkPaper(palette.bg);
  for (let i = 0; i < glyphs.length;) {
    const mark = glyphs[i].mark;
    if (!mark) { i++; continue; }
    let end = i + 1;
    while (end < glyphs.length && glyphs[end].mark === mark) end++;
    const startAt = positions[i];
    const length = positions[end] - startAt;
    const look = shareMarkLook(mark, dark);
    if (look.style === "highlight") {
      ctx.fillStyle = look.background;
      if (vertical) ctx.fillRect(baseline - px * 0.53, startAt, px * 1.06, length);
      else ctx.fillRect(startAt, baseline - px * 0.56, length, px * 1.12);
    } else {
      const line = baseline + px * 0.63;
      const width = Math.max(2, px * 0.052);
      const step = look.style === "squiggly" ? width * 1.35 : length;
      for (let d = 0; d < length; d += step) {
        const wave = look.style === "squiggly" ? Math.sin(d / (width * 1.15)) * width : 0;
        ctx.fillStyle = look.line;
        if (vertical) ctx.fillRect(line + wave, startAt + d, width, Math.min(step, length - d));
        else ctx.fillRect(startAt + d, line + wave, Math.min(step, length - d), width);
      }
    }
    i = end;
  }
}
