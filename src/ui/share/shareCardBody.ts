import { fitText, fittedBlockSize, verticalGlyph, type FitResult, type Measure } from "./shareLayout";
import { drawCardMarks, type CardGlyphMapper } from "./shareCardMarks";
import type { ShareCardContext } from "./shareCardRenderer";
import { drawCardRuby } from "./shareCardRuby";
import type { ShareRuby } from "./shareSourceModel";
import type { ShareCardPalette } from "./shareCardModel";

export const BOOK_FONT = '"Noto Serif CJK SC", "Source Han Serif SC", "Songti SC", "STSong", "SimSun", Georgia, serif';
export const UI_FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI Variable Text", "Segoe UI", system-ui, Roboto, "PingFang SC", "Microsoft YaHei UI", "Noto Sans CJK SC", sans-serif';

/** Room between paragraphs on a long card, as a multiple of the text size. */
const LONG_PARAGRAPH_GAP = 0.7;

const NOTE_INDENT_CQ = 3, NOTE_LINE_HEIGHT = 1.65, NOTE_GAP_CQ = 5, NOTE_PARAGRAPH_GAP = 0.45;

interface BodyBox { pad: number; bodyTop: number; bodyH: number; contentW: number; maxPx: number; minPx: number; notePx: number; cq: number }

export interface HorizontalPlan {
  fit: FitResult;
  noteFit: FitResult | null;
  lineHeight: number;
  spacing: number;
  paragraphGap: number;
  /** Height of the passage plus the note under it. */
  height: number;
}

/**
 * Breaks the passage and notes for a horizontal card. Fixed cards limit the
 * note block so the quote stays readable.
 */
export function planHorizontalBody(
  ctx: ShareCardContext, quote: string, note: string, latin: boolean,
  box: { contentW: number; bodyH: number; maxPx: number; minPx: number; notePx: number; cq: number; long: boolean },
  rubies?: readonly ShareRuby[],
): HorizontalPlan {
  const { contentW, bodyH, notePx, cq, long } = box;
  const spacing = latin ? 0 : 0.02;
  const lineHeight = rubies?.length ? 2.05 : latin ? 1.55 : 1.75;
  const paragraphGap = long ? LONG_PARAGRAPH_GAP : 0;
  const gap = NOTE_GAP_CQ * cq;

  const noteRoom = long ? bodyH * 0.4 : notePx * NOTE_LINE_HEIGHT * 4.5;
  const noteFit = note
    ? fitText({ text: note, lineLength: contentW - NOTE_INDENT_CQ * cq, blockSize: noteRoom, lineHeight: NOTE_LINE_HEIGHT, paragraphGap: NOTE_PARAGRAPH_GAP, maxPx: notePx, minPx: notePx, measure: measureWith(ctx, `{px}px ${UI_FONT}`), ellipsis: "…" })
    : null;
  const noteH = noteFit ? fittedBlockSize(noteFit, NOTE_LINE_HEIGHT, NOTE_PARAGRAPH_GAP) : 0;

  const fit = fitText({
    text: quote, protectedRanges: rubies, lineLength: contentW, blockSize: bodyH - (noteFit ? noteH + gap : 0), lineHeight, paragraphGap,
    maxPx: box.maxPx, minPx: box.minPx, stepPx: Math.max(1, cq * 0.2), measure: measureWith(ctx, `{px}px ${BOOK_FONT}`, spacing), ellipsis: latin ? "…" : "……",
  });
  const height = fittedBlockSize(fit, lineHeight, paragraphGap) + (noteFit ? gap + noteH : 0);
  return { fit, noteFit, lineHeight, spacing, paragraphGap, height };
}

export function drawHorizontalBody(
  ctx: ShareCardContext, plan: HorizontalPlan, latin: boolean, palette: ShareCardPalette,
  box: { pad: number; bodyTop: number; bodyH: number; contentW: number; notePx: number; cq: number },
  mapGlyphs: CardGlyphMapper, noteInks?: readonly string[],
): boolean {
  const { pad, bodyTop, bodyH, contentW, notePx, cq } = box;
  const { fit, noteFit, lineHeight, spacing } = plan;
  let y = bodyTop + (bodyH - plan.height) / 2;

  ctx.fillStyle = palette.fg;
  ctx.font = `${fit.fontPx}px ${BOOK_FONT}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const paragraphStarts = new Set(fit.paragraphStarts);
  fit.lines.forEach((line, i) => {
    if (paragraphStarts.has(i)) y += fit.fontPx * plan.paragraphGap;
    const mid = y + fit.fontPx * lineHeight / 2;
    const paragraphEnd = i === fit.lines.length - 1 || paragraphStarts.has(i + 1);
    drawQuoteLine(ctx, line, pad, mid, fit.fontPx, spacing, paragraphEnd ? null : contentW, latin, palette, mapGlyphs);
    y += fit.fontPx * lineHeight;
  });

  if (noteFit) {
    y += NOTE_GAP_CQ * cq;
    ctx.font = `${notePx}px ${UI_FONT}`;
    let start = 0;
    for (const [index, end] of [...noteFit.paragraphStarts, noteFit.lines.length].entries()) {
      if (index) y += notePx * NOTE_PARAGRAPH_GAP;
      ctx.fillStyle = noteInks?.[index] ?? palette.accent;
      ctx.fillRect(pad, y + notePx * 0.2, Math.max(2, 0.5 * cq), notePx * (NOTE_LINE_HEIGHT * (end - start) - 0.4));
      ctx.fillStyle = palette.muted;
      for (const line of noteFit.lines.slice(start, end)) {
        ctx.fillText(line, pad + NOTE_INDENT_CQ * cq, y + notePx * NOTE_LINE_HEIGHT / 2);
        y += notePx * NOTE_LINE_HEIGHT;
      }
      start = end;
    }
  }
  return fit.truncated || !!noteFit?.truncated;
}

/**
 * One line of CJK text, glyph by glyph so spacing is exact. Full lines are
 * justified to `justifyTo`; short lines (paragraph ends) keep natural spacing.
 */
function drawQuoteLine(ctx: ShareCardContext, line: string, x: number, y: number, px: number, spacing: number, justifyTo: number | null, latin: boolean, palette: ShareCardPalette, mapGlyphs: CardGlyphMapper) {
  const glyphs = mapGlyphs?.(line);
  if (latin) {
    if (!glyphs) { ctx.fillText(line, x, y); return; }
    let prefix = "";
    const positions = [x];
    for (const { char } of glyphs) { prefix += char; positions.push(x + ctx.measureText(prefix).width); }
    drawCardMarks(ctx, glyphs, positions, y, px, palette);
    drawCardRuby(ctx, glyphs, positions, y, px, BOOK_FONT, palette.muted);
    for (let i = 0; i < glyphs.length;) {
      const ink = glyphs[i].ink;
      let end = i + 1;
      while (end < glyphs.length && glyphs[end].ink === ink) end++;
      ctx.fillStyle = ink ?? palette.fg;
      ctx.fillText(glyphs.slice(i, end).map(({ char }) => char).join(""), positions[i], y);
      i = end;
    }
    return;
  }
  const chars = [...line];
  const widths = chars.map((ch) => ctx.measureText(ch).width + spacing * px);
  const natural = widths.reduce((a, b) => a + b, 0) - spacing * px;
  let extra = 0;
  if (justifyTo !== null && chars.length > 1 && natural >= justifyTo * 0.8) {
    extra = Math.min((justifyTo - natural) / (chars.length - 1), px * 0.6);
    if (extra < 0) extra = 0;
  }
  const positions = [x];
  widths.forEach((width, i) => positions.push(positions[i] + width + (i < widths.length - 1 ? extra : -spacing * px)));
  if (glyphs) {
    drawCardMarks(ctx, glyphs, positions, y, px, palette);
    drawCardRuby(ctx, glyphs, positions, y, px, BOOK_FONT, palette.muted);
  }
  chars.forEach((ch, i) => {
    ctx.fillStyle = glyphs?.[i].ink ?? palette.fg;
    ctx.fillText(ch, positions[i], y);
  });
}

export function drawVerticalBody(ctx: ShareCardContext, quote: string, note: string, palette: ShareCardPalette, box: BodyBox & { W: number }, mapGlyphs: CardGlyphMapper, noteInks?: readonly string[], rubies?: readonly ShareRuby[]): boolean {
  const { pad, W, bodyTop, bodyH, contentW, notePx, cq } = box;
  const advance = 1.12, pitch = rubies?.length ? 2.25 : 1.9;
  const columns: Measure = (text, px) => [...text].length * px * advance;

  const noteTop = 3 * cq, noteGap = 6 * cq, notePitch = 1.65;
  const noteFit = note
    ? fitText({ text: note, lineLength: bodyH - noteTop, blockSize: notePx * notePitch * 3, lineHeight: notePitch, maxPx: notePx, minPx: notePx, measure: columns, ellipsis: "…" })
    : null;
  const noteW = noteFit ? noteFit.lines.length * notePx * notePitch : 0;

  const fit = fitText({
    text: quote, protectedRanges: rubies, lineLength: bodyH, blockSize: contentW - (noteFit ? noteW + noteGap : 0), lineHeight: pitch,
    maxPx: box.maxPx, minPx: box.minPx, stepPx: Math.max(1, cq * 0.2), measure: columns, ellipsis: "……",
  });

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = palette.fg;
  ctx.font = `${fit.fontPx}px ${BOOK_FONT}`;
  let x = W - pad;
  for (const line of fit.lines) {
    const cx = x - fit.fontPx * pitch / 2;
    const glyphs = mapGlyphs?.(line);
    if (glyphs) {
      const positions = Array.from({ length: glyphs.length + 1 }, (_, i) => bodyTop + i * fit.fontPx * advance);
      drawCardMarks(ctx, glyphs, positions, cx, fit.fontPx, palette, true);
      drawCardRuby(ctx, glyphs, positions, cx, fit.fontPx, BOOK_FONT, palette.muted, true);
      glyphs.forEach(({ char, ink }, i) => {
        ctx.fillStyle = ink ?? palette.fg;
        ctx.fillText(verticalGlyph(char), cx, positions[i] + fit.fontPx * advance / 2);
      });
    } else drawColumn(ctx, line, cx, bodyTop, fit.fontPx, advance);
    x -= fit.fontPx * pitch;
  }

  if (noteFit) {
    x -= noteGap - fit.fontPx * (pitch - 1) / 2;
    ctx.font = `${notePx}px ${UI_FONT}`;
    let paragraph = 0;
    for (const [index, line] of noteFit.lines.entries()) {
      if (index === 0 || noteFit.paragraphStarts[paragraph - 1] === index) {
        ctx.fillStyle = noteInks?.[paragraph++] ?? palette.accent;
        ctx.fillRect(x - notePx * notePitch / 2 - notePx / 2, bodyTop, notePx, Math.max(2, 0.5 * cq));
      }
      ctx.fillStyle = palette.muted;
      drawColumn(ctx, line, x - notePx * notePitch / 2, bodyTop + noteTop, notePx, advance);
      x -= notePx * notePitch;
    }
  }
  return fit.truncated || !!noteFit?.truncated;
}

function drawColumn(ctx: ShareCardContext, line: string, cx: number, top: number, px: number, advance: number) {
  let y = top + px * advance / 2;
  for (const ch of line) {
    ctx.fillText(verticalGlyph(ch), cx, y);
    y += px * advance;
  }
}

export function measureWith(ctx: ShareCardContext, fontTemplate: string, spacingEm = 0): Measure {
  return (text, px) => {
    const previous = ctx.font;
    ctx.font = fontTemplate.replace("{px}", String(px));
    const width = ctx.measureText(text).width + spacingEm * px * Math.max(0, [...text].length - 1);
    ctx.font = previous;
    return width;
  };
}
