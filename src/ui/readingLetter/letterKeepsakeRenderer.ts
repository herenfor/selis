import { ICON_PAGES_PATH } from "../share/brandMark";
import { UI_FONT } from "../share/shareCardBody";
import { bookClothToneForKey, type LoadedLetterCover } from "./letterCovers";
import type { AnnualLetterModel, LetterExcerpt, MonthlyLetterModel } from "./readingLogStore";

export type LetterPaperTone = "paper" | "sepia" | "night";

interface PaperPalette {
  sheet: string;
  surface: string;
  ink: string;
  muted: string;
  line: string;
  seal: string;
}

const PAPER_PALETTES: Record<LetterPaperTone, PaperPalette> = {
  paper: { sheet: "#fbfaf5", surface: "#f4f1e8", ink: "#232620", muted: "#686d63", line: "#dbd5c7", seal: "#923c2f" },
  sepia: { sheet: "#f6efe0", surface: "#eee4cd", ink: "#3a3126", muted: "#7c6e59", line: "#d6c6a8", seal: "#96412f" },
  night: { sheet: "#1f2023", surface: "#27292d", ink: "#dedad0", muted: "#9a958b", line: "#34363b", seal: "#c96f5e" },
};

const LETTER_FONT = '"SeLisLetter", "Noto Serif CJK SC", "Source Han Serif SC", "PingFang SC", Georgia, serif';

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const ch of para) {
      const next = line + ch;
      if (ctx.measureText(next).width > maxW && line) {
        out.push(line);
        line = ch;
      } else {
        line = next;
      }
    }
    if (line) out.push(line);
  }
  return out;
}

function drawBookCover(
  ctx: CanvasRenderingContext2D,
  bookKey: string,
  title: string,
  covers: ReadonlyMap<string, LoadedLetterCover>,
  x: number,
  y: number,
  w: number,
  h: number,
  mini: boolean,
): void {
  const tone = bookClothToneForKey(bookKey);
  const loaded = covers.get(bookKey)?.image ?? null;
  ctx.save();
  ctx.fillStyle = "rgba(24,20,14,0.16)";
  ctx.fillRect(x + 2, y + 3, w, h);
  if (loaded) {
    ctx.drawImage(loaded, x, y, w, h);
  } else {
    ctx.fillStyle = tone.bg;
    ctx.fillRect(x, y, w, h);
    if (!mini && title) {
      ctx.fillStyle = tone.fg;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const fs = Math.max(11, Math.round(w * 0.17));
      ctx.font = `600 ${fs}px ${LETTER_FONT}`;
      ctx.fillText(title.slice(0, 6), x + w / 2, y + h * 0.46, w - 10);
    }
  }
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx.restore();
}

function drawHeaderAndStamp(
  ctx: CanvasRenderingContext2D,
  W: number,
  pad: number,
  p: PaperPalette,
  kindLabel: string,
  stampTop: string,
  stampSub: string,
): void {
  ctx.fillStyle = p.ink;
  ctx.fillRect(pad, pad, W - pad * 2, 2);
  ctx.fillRect(pad, pad + 5, W - pad * 2, 0.8);

  ctx.save();
  ctx.translate(pad, pad + 20);
  ctx.fillStyle = p.ink;
  ctx.beginPath();
  ctx.roundRect(0, 0, 28, 28, 6);
  ctx.fill();
  ctx.scale(28 / 72, 28 / 72);
  ctx.fillStyle = p.sheet;
  ctx.fill(new Path2D(ICON_PAGES_PATH));
  ctx.restore();

  ctx.fillStyle = p.ink;
  ctx.font = `600 20px ${LETTER_FONT}`;
  ctx.textBaseline = "middle";
  ctx.fillText(kindLabel, pad + 40, pad + 34);

  ctx.save();
  ctx.translate(W - pad - 56, pad + 34);
  ctx.rotate(-0.07);
  ctx.strokeStyle = p.seal;
  ctx.setLineDash([4, 3]);
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.roundRect(-54, -20, 108, 40, 20);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = p.seal;
  ctx.textAlign = "center";
  ctx.font = `600 12px ${UI_FONT}`;
  ctx.fillText(stampTop, 0, -5);
  ctx.font = `400 11px ${UI_FONT}`;
  ctx.fillText(stampSub, 0, 10);
  ctx.restore();
}

export interface MonthlyKeepsakeInput {
  kind: "monthly";
  paper: LetterPaperTone;
  model: MonthlyLetterModel;
  covers: ReadonlyMap<string, LoadedLetterCover>;
  hideDuration: boolean;
  includeRhythm: boolean;
  includeExcerpt: boolean;
  excerpt: LetterExcerpt | null;
  labels: {
    brandLabel: string;
    stampTop: string;
    stampSub: string;
    title: string;
    subtitle: string;
    prose: string;
    ledger: Array<[string, string]>;
    calHeading: string;
    mosaicHeading: string;
    weekdays: string[];
    rhythmHeading: string;
    rhythmSummary: string;
    colophon: string;
    fileName: string;
    durationFormatter(seconds: number): string;
  };
}

export interface AnnualKeepsakeInput {
  kind: "annual";
  paper: LetterPaperTone;
  model: AnnualLetterModel;
  covers: ReadonlyMap<string, LoadedLetterCover>;
  hideDuration: boolean;
  bookOfYearKey: string | null;
  epigraph: string;
  excerpt: LetterExcerpt | null;
  labels: {
    brandLabel: string;
    stampTop: string;
    stampSub: string;
    title: string;
    subtitle: string;
    monthsHeading: string;
    monthLabel(month: number): string;
    daysCount(days: number): string;
    choiceHeading: string;
    choiceBadge: string;
    daysWithBook(days: number): string;
    colophon: string;
    fileName: string;
  };
}

function drawMonthly(input: MonthlyKeepsakeInput): HTMLCanvasElement {
  const { model, covers, hideDuration, includeRhythm, includeExcerpt, excerpt, labels } = input;
  const p = PAPER_PALETTES[input.paper];
  const W = 1080;
  const pad = 76;
  const inner = W - pad * 2;
  const tmp = document.createElement("canvas").getContext("2d")!;
  tmp.font = `400 22px ${LETTER_FONT}`;
  const introLines = wrapLines(tmp, labels.prose, inner);
  const showEx = includeExcerpt && excerpt !== null;
  const exLines = showEx && excerpt ? wrapLines(tmp, `“${excerpt.quote}”`, inner - 48) : [];

  const H = 980 + introLines.length * 36 + (includeRhythm ? 120 : 0) + (showEx ? 110 + exLines.length * 34 : 0);
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = p.sheet;
  ctx.fillRect(0, 0, W, H);

  drawHeaderAndStamp(ctx, W, pad, p, labels.brandLabel, labels.stampTop, labels.stampSub);

  let y = pad + 104;
  ctx.fillStyle = p.ink;
  ctx.font = `600 50px ${LETTER_FONT}`;
  ctx.fillText(labels.title, pad, y);
  y += 44;
  ctx.fillStyle = p.muted;
  ctx.font = `400 18px ${LETTER_FONT}`;
  ctx.fillText(labels.subtitle, pad, y);
  y += 42;

  ctx.fillStyle = p.ink;
  ctx.font = `400 22px ${LETTER_FONT}`;
  for (const ln of introLines) { ctx.fillText(ln, pad, y); y += 36; }
  y += 16;

  ctx.strokeStyle = p.line;
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(W - pad, y); ctx.stroke();
  const cw = inner / Math.max(1, labels.ledger.length);
  labels.ledger.forEach(([k, v], idx) => {
    ctx.fillStyle = p.muted; ctx.font = `400 15px ${UI_FONT}`; ctx.fillText(k, pad + idx * cw, y + 26);
    ctx.fillStyle = p.ink; ctx.font = `600 24px ${LETTER_FONT}`; ctx.fillText(v, pad + idx * cw, y + 56);
  });
  y += 82;
  ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(W - pad, y); ctx.stroke();
  y += 40;

  const leftW = 480, rightX = pad + leftW + 44, rightW = inner - leftW - 44;
  ctx.fillStyle = p.muted; ctx.font = `600 16px ${LETTER_FONT}`;
  ctx.fillText(labels.calHeading, pad, y);
  ctx.fillText(labels.mosaicHeading, rightX, y);
  y += 24;

  const cellW = leftW / 7, cellH = 56;
  labels.weekdays.forEach((w, i) => {
    ctx.fillStyle = p.muted; ctx.font = `400 13px ${UI_FONT}`; ctx.textAlign = "center";
    ctx.fillText(w, pad + i * cellW + cellW / 2, y + 12);
  });
  ctx.textAlign = "left";
  const calTop = y + 24;
  const firstDow = (new Date(model.year, model.month - 1, 1).getDay() + 6) % 7;
  const dim = new Date(model.year, model.month, 0).getDate();
  for (let d = 1; d <= dim; d++) {
    const slot = d - 1 + firstDow;
    const col = slot % 7, row = Math.floor(slot / 7);
    const cx = pad + col * cellW, cy = calTop + row * cellH;
    ctx.strokeStyle = p.line; ctx.beginPath(); ctx.moveTo(cx + 2, cy); ctx.lineTo(cx + cellW - 2, cy); ctx.stroke();
    ctx.fillStyle = p.muted; ctx.font = `400 12px ${UI_FONT}`; ctx.fillText(String(d), cx + 4, cy + 16);
    const rec = model.days[d];
    if (rec) {
      const topB = rec.books[0];
      drawBookCover(ctx, topB.bookKey, topB.title, covers, cx + (cellW - 22) / 2 + 2, cy + 18, 22, 33, true);
    }
  }

  const mosH = 290;
  const topBooks = model.books.slice(0, 4);
  if (topBooks.length === 0) {
    ctx.strokeStyle = p.line; ctx.strokeRect(rightX, calTop, rightW, mosH);
  } else if (topBooks.length === 1) {
    ctx.fillStyle = bookClothToneForKey(topBooks[0].bookKey).mat;
    ctx.fillRect(rightX, calTop, rightW, mosH);
    drawBookCover(ctx, topBooks[0].bookKey, topBooks[0].title, covers, rightX + (rightW - 108) / 2, calTop + 64, 108, 162, false);
  } else {
    const sumAll = topBooks.reduce((a, b) => a + b.seconds, 0) || 1;
    const w0 = Math.round(rightW * (topBooks[0].seconds / sumAll));
    ctx.fillStyle = bookClothToneForKey(topBooks[0].bookKey).mat;
    ctx.fillRect(rightX, calTop, w0 - 3, mosH);
    drawBookCover(ctx, topBooks[0].bookKey, topBooks[0].title, covers, rightX + (w0 - 94) / 2, calTop + 74, 94, 141, false);
    let ry = calTop;
    const restSum = topBooks.slice(1).reduce((a, b) => a + b.seconds, 0) || 1;
    topBooks.slice(1).forEach((b, idx) => {
      const bh = idx === topBooks.length - 2 ? (calTop + mosH - ry) : Math.round(mosH * (b.seconds / restSum));
      ctx.fillStyle = bookClothToneForKey(b.bookKey).mat;
      ctx.fillRect(rightX + w0 + 2, ry, rightW - w0 - 2, Math.max(4, bh - 2));
      const cw2 = Math.min(70, Math.round(bh * 0.48)), ch2 = Math.round(cw2 * 1.5);
      drawBookCover(ctx, b.bookKey, b.title, covers, rightX + w0 + 2 + (rightW - w0 - 2 - cw2) / 2, ry + (bh - ch2) / 2, cw2, ch2, cw2 < 44);
      ry += bh;
    });
  }
  topBooks.forEach((b, idx) => {
    const ly = calTop + mosH + 26 + idx * 24;
    ctx.fillStyle = bookClothToneForKey(b.bookKey).bg; ctx.fillRect(rightX, ly - 10, 10, 10);
    ctx.fillStyle = p.ink; ctx.font = `400 15px ${UI_FONT}`;
    const tail = hideDuration ? "" : ` · ${labels.durationFormatter(b.seconds)}`;
    ctx.fillText(b.title + tail, rightX + 18, ly, rightW - 22);
  });

  y = calTop + 6 * cellH + 34;
  if (includeRhythm) {
    const peak = Math.max(1, ...model.rhythm);
    ctx.fillStyle = p.muted; ctx.font = `600 16px ${LETTER_FONT}`;
    ctx.fillText(labels.rhythmHeading, pad, y);
    const bw = inner / 24;
    model.rhythm.forEach((v, hr) => {
      const bh = Math.max(2, Math.round((v / peak) * 34));
      ctx.fillStyle = p.ink; ctx.globalAlpha = v > 0 ? 0.55 : 0.14;
      ctx.fillRect(pad + hr * bw, y + 52 - bh, bw - 5, bh);
    });
    ctx.globalAlpha = 1;
    ctx.fillStyle = p.muted; ctx.font = `400 15px ${LETTER_FONT}`;
    ctx.fillText(labels.rhythmSummary, pad, y + 78, inner);
    y += 116;
  }

  if (showEx && excerpt) {
    ctx.fillStyle = p.surface; ctx.fillRect(pad, y, inner, 76 + exLines.length * 34);
    ctx.fillStyle = p.seal; ctx.fillRect(pad, y, 4, 76 + exLines.length * 34);
    ctx.fillStyle = p.ink; ctx.font = `400 20px ${LETTER_FONT}`;
    let ey = y + 38;
    for (const ln of exLines) { ctx.fillText(ln, pad + 24, ey); ey += 34; }
    ctx.fillStyle = p.muted; ctx.font = `400 14px ${UI_FONT}`;
    ctx.fillText(`《${excerpt.bookTitle}》`, pad + 24, ey + 6);
  }

  ctx.strokeStyle = p.line; ctx.beginPath(); ctx.moveTo(pad, H - 72); ctx.lineTo(W - pad, H - 72); ctx.stroke();
  ctx.fillStyle = p.muted; ctx.font = `400 14px ${LETTER_FONT}`;
  ctx.fillText(labels.colophon, pad, H - 42);
  return canvas;
}

function drawAnnual(input: AnnualKeepsakeInput): HTMLCanvasElement {
  const { model, covers, bookOfYearKey, epigraph, excerpt, labels } = input;
  const p = PAPER_PALETTES[input.paper];
  const W = 1080, pad = 76, inner = W - pad * 2, H = 1360;
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = p.sheet; ctx.fillRect(0, 0, W, H);
  drawHeaderAndStamp(ctx, W, pad, p, labels.brandLabel, labels.stampTop, labels.stampSub);

  let y = pad + 104;
  ctx.fillStyle = p.ink; ctx.font = `600 50px ${LETTER_FONT}`; ctx.fillText(labels.title, pad, y);
  y += 46;
  ctx.fillStyle = p.muted; ctx.font = `400 18px ${LETTER_FONT}`; ctx.fillText(labels.subtitle, pad, y);
  y += 54;

  ctx.fillStyle = p.muted; ctx.font = `600 16px ${LETTER_FONT}`; ctx.fillText(labels.monthsHeading, pad, y);
  y += 22;
  const gw = (inner - 36) / 4, gh = 112;
  model.months.forEach((mo, idx) => {
    const col = idx % 4, row = Math.floor(idx / 4);
    const x = pad + col * (gw + 12), my = y + row * (gh + 12);
    ctx.strokeStyle = p.line; ctx.strokeRect(x, my, gw, gh);
    if (mo.topBookKey) {
      drawBookCover(ctx, mo.topBookKey, mo.topBookTitle, covers, x + 16, my + 22, 42, 64, true);
    }
    ctx.fillStyle = p.ink; ctx.font = `600 16px ${LETTER_FONT}`; ctx.fillText(labels.monthLabel(mo.month), x + 74, my + 44);
    ctx.fillStyle = p.muted; ctx.font = `400 13px ${UI_FONT}`; ctx.fillText(labels.daysCount(mo.days), x + 74, my + 68);
  });
  y += 3 * (gh + 12) + 42;

  const chosen = model.featuredBooks.find((b) => b.bookKey === bookOfYearKey) ?? model.featuredBooks[0] ?? null;
  if (chosen) {
    ctx.fillStyle = p.muted; ctx.font = `600 16px ${LETTER_FONT}`; ctx.fillText(labels.choiceHeading, pad, y);
    y += 22;
    ctx.fillStyle = p.surface; ctx.fillRect(pad, y, inner, 176);
    ctx.strokeStyle = p.seal; ctx.strokeRect(pad, y, inner, 176);
    drawBookCover(ctx, chosen.bookKey, chosen.title, covers, pad + 28, y + 24, 84, 126, false);
    ctx.fillStyle = p.seal; ctx.font = `600 13px ${LETTER_FONT}`; ctx.fillText(labels.choiceBadge, pad + 136, y + 48);
    ctx.fillStyle = p.ink; ctx.font = `600 28px ${LETTER_FONT}`; ctx.fillText(`《${chosen.title}》`, pad + 130, y + 86, inner - 160);
    ctx.fillStyle = p.muted; ctx.font = `400 16px ${UI_FONT}`;
    ctx.fillText([chosen.creator, labels.daysWithBook(chosen.days)].filter(Boolean).join(" · "), pad + 136, y + 118, inner - 160);
    if (epigraph.trim()) {
      ctx.fillStyle = p.ink; ctx.font = `400 17px ${LETTER_FONT}`;
      ctx.fillText(`“${epigraph.trim()}”`, pad + 136, y + 152, inner - 160);
    }
    y += 216;
  }

  if (excerpt) {
    ctx.fillStyle = p.surface; ctx.fillRect(pad, y, inner, 118);
    ctx.fillStyle = p.seal; ctx.fillRect(pad, y, 4, 118);
    ctx.fillStyle = p.ink; ctx.font = `400 20px ${LETTER_FONT}`;
    const ql = wrapLines(ctx, `“${excerpt.quote}”`, inner - 48).slice(0, 2);
    ql.forEach((ln, i) => ctx.fillText(ln, pad + 24, y + 38 + i * 32));
    ctx.fillStyle = p.muted; ctx.font = `400 14px ${UI_FONT}`;
    ctx.fillText(`《${excerpt.bookTitle}》`, pad + 24, y + 98);
  }

  ctx.strokeStyle = p.line; ctx.beginPath(); ctx.moveTo(pad, H - 72); ctx.lineTo(W - pad, H - 72); ctx.stroke();
  ctx.fillStyle = p.muted; ctx.font = `400 14px ${LETTER_FONT}`;
  ctx.fillText(labels.colophon, pad, H - 42);
  return canvas;
}

export async function renderReadingLetterPngBlob(
  input: MonthlyKeepsakeInput | AnnualKeepsakeInput,
): Promise<{ blob: Blob; fileName: string; previewUrl: string }> {
  if (typeof document !== "undefined" && document.fonts?.ready) {
    await document.fonts.ready;
  }
  const canvas = input.kind === "annual" ? drawAnnual(input) : drawMonthly(input);
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((out) => (out ? resolve(out) : reject(new Error("canvas-to-blob-failed"))), "image/png");
  });
  return {
    blob,
    fileName: input.labels.fileName,
    previewUrl: URL.createObjectURL(blob),
  };
}
