import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useUiText } from "../localization/UiLanguageProvider";
import { highlightColorProps } from "../highlightModel";
import { useScrollEdgeFade } from "../scrollEdgeFade";
import { resolveNoteHighlightLook } from "../../render/noteHighlights";
import { ShareCheckIcon, ShareNoteChoices } from "./ShareNoteChoices";
import { shareFolioDomRange, shareFolioSelection } from "./shareFolioSelection";
import type { ShareSheetBook } from "./ShareSheet";
import type { ShareTextRange } from "./shareDraftBuilder";
import { intersectShareRange, SHARE_INKS, shareRubySegments, shareSourceRuns, type buildShareExcerpt, type createShareSource, type ShareInk, type ShareInkRange } from "./shareSourceModel";
import "./shareSourceFolio.css";

interface Props {
  book: ShareSheetBook;
  source: ReturnType<typeof createShareSource>;
  excerpt: ReturnType<typeof buildShareExcerpt>;
  inks: readonly ShareInkRange[];
  recent: ShareTextRange | null;
  recall: number;
  long: boolean;
  showMarks: boolean;
  showNote: boolean;
  onRange(edge: "first" | "last", step: number): void;
  onInk(range: ShareTextRange, ink?: ShareInk): void;
  onToggleNote(id: string): void;
}

function inkStyle(ink: ShareInk): CSSProperties {
  const [light, dark] = SHARE_INKS[ink];
  return { "--share-ink-light": light, "--share-ink-dark": dark } as CSSProperties;
}

const PHRASE_HIGHLIGHT = "share-phrase-selection";

export function ShareSourceFolio({ book, source, excerpt, inks, recent, recall, long, showMarks, showNote, onRange, onInk, onToggleNote }: Props) {
  const { t } = useUiText();
  const workspace = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const passage = useRef<HTMLDivElement>(null);
  const tools = useRef<HTMLDivElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const focusTools = useRef(false);
  const handledRecall = useRef(0);
  const [phrase, setPhrase] = useState<ShareTextRange | null>(null);
  const { bounds, range } = excerpt;
  const active = useMemo(() => phrase && intersectShareRange(phrase, bounds), [phrase, bounds]);
  const nativeHighlight = typeof Highlight !== "undefined" && !!globalThis.CSS?.highlights;
  useScrollEdgeFade(scroller);

  const open = (range: ShareTextRange, origin?: HTMLElement) => {
    returnTo.current = origin ?? null;
    focusTools.current = !!origin;
    setPhrase(range);
  };
  const close = useCallback((focus = false) => {
    if (focus) (returnTo.current ?? passage.current)?.focus({ preventScroll: true });
    setPhrase(null);
    returnTo.current = null;
    const selection = passage.current?.ownerDocument.getSelection();
    if (selection?.anchorNode && passage.current?.contains(selection.anchorNode)) selection.removeAllRanges();
  }, []);

  useEffect(() => {
    const doc = passage.current?.ownerDocument;
    if (!doc) return;
    let frame = 0;
    let selecting = false;
    const sync = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (selecting || !passage.current || tools.current?.contains(doc.activeElement)) return;
        const selected = shareFolioSelection(passage.current);
        const clipped = selected && intersectShareRange(selected, bounds);
        if (clipped) open(clipped);
      });
    };
    const start = (event: PointerEvent) => {
      const target = event.target as Node;
      selecting = !!passage.current?.contains(target);
      if (!selecting && !tools.current?.contains(target)) close();
    };
    const finish = () => { if (selecting) { selecting = false; sync(); } };
    doc.addEventListener("pointerdown", start);
    doc.addEventListener("pointerup", finish);
    doc.addEventListener("pointercancel", finish);
    doc.addEventListener("selectionchange", sync);
    return () => {
      cancelAnimationFrame(frame);
      doc.removeEventListener("pointerdown", start);
      doc.removeEventListener("pointerup", finish);
      doc.removeEventListener("pointercancel", finish);
      doc.removeEventListener("selectionchange", sync);
    };
  }, [bounds, close]);

  useLayoutEffect(() => {
    if (!active || !passage.current || !workspace.current || !scroller.current || !tools.current) return;
    const root = passage.current, wrap = workspace.current, scroll = scroller.current, bar = tools.current;
    const mark = shareFolioDomRange(root, active);
    if (mark && nativeHighlight) CSS.highlights.set(PHRASE_HIGHLIGHT, new Highlight(mark));
    const position = () => {
      const target = mark?.getBoundingClientRect();
      if (!target) return;
      const outer = wrap.getBoundingClientRect();
      const viewport = scroll.getBoundingClientRect();
      const x = target.left + target.width / 2 - outer.left - bar.offsetWidth / 2;
      const above = target.top - outer.top - bar.offsetHeight - 8;
      const below = target.bottom - outer.top + 8;
      const left = Math.max(4, Math.min(x, outer.width - bar.offsetWidth - 4));
      bar.style.left = `${left}px`;
      bar.style.top = `${Math.max(4, Math.min(above >= 4 ? above : below, outer.height - bar.offsetHeight - 4))}px`;
      bar.dataset.below = String(above < 4);
      bar.style.setProperty("--share-phrase-arrow", `${Math.max(14, Math.min(bar.offsetWidth - 14, x - left + bar.offsetWidth / 2))}px`);
      bar.style.visibility = target.bottom < viewport.top || target.top > viewport.bottom ? "hidden" : "visible";
    };
    position();
    const resize = new ResizeObserver(position);
    resize.observe(wrap);
    scroll.addEventListener("scroll", position, { passive: true });
    if (focusTools.current) {
      focusTools.current = false;
      (bar.querySelector<HTMLButtonElement>('[aria-pressed="true"]') ?? bar.querySelector("button"))?.focus({ preventScroll: true });
    }
    return () => {
      resize.disconnect();
      scroll.removeEventListener("scroll", position);
      if (nativeHighlight) CSS.highlights.delete(PHRASE_HIGHLIGHT);
    };
  }, [active, inks, nativeHighlight]);

  useLayoutEffect(() => {
    if (!recall) { handledRecall.current = 0; return; }
    if (recall === handledRecall.current || !recent || !passage.current) return;
    handledRecall.current = recall;
    const clipped = intersectShareRange(recent, bounds);
    if (!clipped) return;
    const dom = shareFolioDomRange(passage.current, clipped);
    dom?.startContainer.parentElement?.scrollIntoView({ block: "nearest" });
    open(clipped, passage.current.ownerDocument.activeElement as HTMLElement | undefined);
  }, [recall, recent, bounds]);

  const trim = (edge: "first" | "last", step: number) => { close(); onRange(edge, step); };
  const inkAtSelection = active && inks.find((item) => item.start <= active.start && active.end <= item.end)?.ink;
  const hasInk = active && inks.some((item) => intersectShareRange(item, active));
  const meta = [book.author, book.chapter].filter(Boolean).join(" · ");
  return <div ref={workspace} className="share-source-workspace" onKeyDownCapture={(event) => {
    if (event.key === "Escape" && active) { event.stopPropagation(); event.preventDefault(); close(true); }
  }}>
    <div ref={scroller} className="share-source-scroll scrollbar-hidden" aria-label={t("share.source")}>
      <article className="share-folio">
        <header className="share-folio-head"><div><h2>{book.title}</h2>{meta && <small>{meta}</small>}</div><span>{t("share.source.hint")}</span></header>
        {!showMarks && excerpt.marks.length > 0 && <p className="share-marks-notice">{t("share.source.marksOff")}</p>}
        <div ref={passage} className="share-passage" tabIndex={-1} onClick={(event) => {
          if (!shareFolioSelection(event.currentTarget)) close();
        }}>
          {source.sentences.map((sentence, index) => {
            const segments = shareRubySegments(sentence, source.rubies);
            if (index < range.first || index > range.last) {
              const edge = index < range.first ? "first" : "last";
              return <span key={index} role="button" tabIndex={0} className="share-faded-sentence"
                onClick={(event) => { event.stopPropagation(); trim(edge, index - range[edge]); }}
                onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); trim(edge, index - range[edge]); } }}>
                {segments.map(({ start, end, reading }) => reading
                  ? <ruby key={start}>{source.passage.slice(start, end)}<rt>{reading}</rt></ruby>
                  : source.passage.slice(start, end))}
              </span>;
            }
            return <span className="share-source-sentence" key={index}>
              {index === range.first && range.first < range.last && !long && <button className="share-inline-trim" type="button" title={t("share.range.trimFirst")} onClick={(event) => { event.stopPropagation(); trim("first", 1); }}>{t("share.range.inlineFirst")}</button>}
              {segments.map((segment) => {
                const base = shareSourceRuns(segment, excerpt.marks, inks, nativeHighlight ? null : active).map(({ start, end, mark, ink, picked }) => {
                  const look = mark ? highlightColorProps(mark.color) : null;
                  const style = mark ? resolveNoteHighlightLook(mark)?.style ?? "underline" : undefined;
                  return <span key={start} data-share-start={start} data-mark={style} data-ink={ink} data-picked={picked || undefined}
                    className={look?.className} style={ink ? { ...look?.style, ...inkStyle(ink) } : look?.style}
                    onClick={(event) => {
                      if (shareFolioSelection(event.currentTarget.closest<HTMLElement>(".share-passage")!)) return;
                      const colored = ink && inks.find((item) => item.start <= start && start < item.end);
                      const target = colored || mark;
                      if (target) { event.stopPropagation(); const clipped = intersectShareRange(target, bounds); if (clipped) open(clipped); }
                    }}>
                    {source.passage.slice(start, end)}
                  </span>;
                });
                return segment.reading ? <ruby key={segment.start}>{base}<rt>{segment.reading}</rt></ruby> : base;
              })}
              {index === range.last && range.first < range.last && !long && <button className="share-inline-trim" type="button" title={t("share.range.trimLast")} onClick={(event) => { event.stopPropagation(); trim("last", -1); }}>{t("share.range.inlineLast")}</button>}
            </span>;
          })}
        </div>
        {showNote && <ShareNoteChoices excerpt={excerpt} onToggle={onToggleNote} onJump={(note, origin) => {
          const clipped = intersectShareRange(note, bounds);
          if (!clipped || !passage.current) return;
          shareFolioDomRange(passage.current, clipped)?.startContainer.parentElement?.scrollIntoView({ block: "nearest" });
          open(clipped, origin);
        }} />}
      </article>
    </div>
    {active && <div className="share-phrase" role="group" aria-label={t("share.ink.label")} ref={tools}>
      <span>{t("share.ink.label")}</span>
      {(["original", "blue", "red", "green"] as const).map((key) => <button type="button" key={key} data-ink={key}
        aria-label={t(`share.ink.${key}`)} title={t(`share.ink.${key}`)} aria-pressed={key === "original" ? !hasInk : inkAtSelection === key}
        onPointerDown={(event) => { if (event.pointerType === "mouse") event.preventDefault(); }}
        onClick={() => { passage.current?.ownerDocument.getSelection()?.removeAllRanges(); onInk(active, key === "original" ? undefined : key); }}>
        <i style={key === "original" ? undefined : inkStyle(key)} />
      </button>)}
      <button type="button" className="share-phrase-done" aria-label={t("share.ink.done")} title={t("share.ink.done")} onClick={() => close(true)}><ShareCheckIcon /></button>
    </div>}
  </div>;
}
