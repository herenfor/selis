import { verticalGlyph } from "./shareLayout";
import type { CardGlyph } from "./shareCardMarks";
import type { ShareCardContext } from "./shareCardRenderer";

/** Draw only complete base groups. A truncated or split group falls back to base text. */
export function drawCardRuby(
  ctx: ShareCardContext, glyphs: readonly CardGlyph[], positions: readonly number[],
  baseline: number, px: number, font: string, color: string, vertical = false,
) {
  const annotated = glyphs.flatMap((glyph, start) => {
    const ruby = glyph.ruby;
    if (!ruby) return [];
    for (let index = start; index < glyphs.length; index++) {
      const { offset, char } = glyphs[index];
      if (offset === undefined || offset + char.length > ruby.end) break;
      if (offset + char.length === ruby.end) {
        return [{ start: positions[start], end: positions[index + 1], text: ruby.text }];
      }
    }
    return [];
  });
  if (!annotated.length) return;
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = color;
  for (const { start, end, text } of annotated) {
    const span = end - start;
    if (span <= 0) continue;
    const size = px * 0.43;
    if (!vertical) {
      ctx.font = `${size}px ${font}`;
      ctx.fillText(text, (start + end) / 2, baseline - px * 0.71, span);
      continue;
    }
    const chars = [...text];
    const step = Math.min(size * 1.12, span / chars.length);
    ctx.font = `${Math.min(size, step)}px ${font}`;
    const top = (start + end - step * chars.length) / 2;
    chars.forEach((char, index) => ctx.fillText(verticalGlyph(char), baseline + px * 0.71, top + step * (index + 0.5)));
  }
  ctx.restore();
}
