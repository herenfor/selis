import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Segmented } from "../controls/Segmented";
import { CloseIcon, HistoryBackIcon, ShareIcon } from "../readerIcons";
import { useScrollEdgeFade } from "../scrollEdgeFade";
import { useUiText } from "../localization/UiLanguageProvider";
import type { ShareDraft } from "../readerForeground";
import { coverToneFromImage } from "./coverTone";
import type { ShareCardContent, ShareCardOptions } from "./shareCardModel";
import { drawShareCard, shareCardHeight, shareCardPng } from "./shareCardRenderer";
import { useShareOptions } from "./shareOptions";
import {
  canCopyImage, copyShareImage, copyShareText, saveShareImage, saveShareImageToGallery, shareActions, shareFileName,
  shareImageNative, type ShareActionId, type ShareSurface,
} from "./shareOutput";
import { formatShareCitation } from "./shareText";
import { ShareControlsPanel, ShareFitWarning, type ShareSection } from "./ShareControlsPanel";
import { ShareSourceFolio } from "./ShareSourceFolio";
import { buildShareExcerpt, createShareSource, editShareRange, intersectShareRange, paintShareInk, type ShareInkRange, type ShareSentenceRange } from "./shareSourceModel";
import type { ShareTextRange } from "./shareDraftBuilder";
import "./shareSheet.css";

export interface ShareSheetBook {
  title: string;
  author?: string;
  chapter?: string;
  /** An object URL of the cover thumbnail, when one is cached. */
  coverUrl?: string | null;
}

export interface ShareSheetProps {
  draft: ShareDraft;
  book: ShareSheetBook;
  surface: ShareSurface;
  onClose(): void;
  onNotice(text: string, kind: "ok" | "warn" | "error"): void;
}

/**
 * The share panel (ER-0119): a live card preview drawn by the same renderer
 * that exports the PNG, the card choices, and the platform's share actions.
 * A centred dialog on desktop, a bottom sheet on phones (CSS only).
 */
export function ShareSheet({ draft, book, surface, onClose, onNotice }: ShareSheetProps) {
  const { t } = useUiText();
  const { shareOptions: options, updateShareOptions } = useShareOptions();
  const source = useMemo(() => createShareSource(draft), [draft]);
  const [range, setRange] = useState(source.full);
  const [inks, setInks] = useState<ShareInkRange[]>([]);
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(() => new Set());
  const [view, setView] = useState<"proof" | "source">("proof");
  const [section, setSection] = useState<ShareSection>("style");
  const [recent, setRecent] = useState<ShareTextRange | null>(null);
  const [recall, setRecall] = useState(0);
  const long = options.ratio === "long";
  const excerpt = useMemo(() => buildShareExcerpt(source, long ? source.full : range, inks, excluded), [source, long, range, inks, excluded]);

  const changeView = (next: "proof" | "source") => { setView(next); setRecall(0); };
  const changeOptions = (patch: Partial<ShareCardOptions>) => {
    if (patch.template || patch.ratio) changeView("proof");
    updateShareOptions(patch);
  };
  const changeRange = (edge: keyof ShareSentenceRange, step: number) => {
    if (!long) setRange((current) => editShareRange(current, source.full, edge, step));
  };
  const toggleNote = (id: string) => setExcluded((current) => {
    const next = new Set(current);
    if (!next.delete(id)) next.add(id);
    return next;
  });

  const [cover, setCover] = useState<HTMLImageElement | null>(null);
  const [coverTone, setCoverTone] = useState<string | null>(null);
  useEffect(() => {
    if (!book.coverUrl) return;
    let live = true;
    const image = new Image();
    image.onload = () => {
      if (!live) return;
      setCover(image);
      setCoverTone(coverToneFromImage(image));
    };
    image.src = book.coverUrl;
    return () => { live = false; };
  }, [book.coverUrl]);

  const content: ShareCardContent = useMemo(() => ({
    quote: excerpt.quote, notes: excerpt.included, marks: excerpt.cardMarks, inks: excerpt.cardInks, rubies: excerpt.cardRubies,
    bookTitle: book.title, author: book.author, chapter: book.chapter, accent: draft.accent,
  }), [excerpt, draft.accent, book.title, book.author, book.chapter]);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  useScrollEdgeFade(stageRef, long);
  useLayoutEffect(() => {
    if (stageRef.current) stageRef.current.scrollTop = 0;
  }, [options.ratio]);
  const [truncated, setTruncated] = useState(false);
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const assets = { cover, coverTone };
    const height = shareCardHeight(ctx, content, options, assets);
    if (canvas.width !== 1080) canvas.width = 1080;
    if (canvas.height !== height) canvas.height = height;
    const result = drawShareCard(ctx, content, options, assets);
    setTruncated(result.truncated);
  }, [content, options, cover, coverTone]);

  const [copyImageFailed, setCopyImageFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const actions = shareActions(surface, { clipboardImage: canCopyImage() && !copyImageFailed });

  const run = async (action: ShareActionId) => {
    if (busy) return;
    setBusy(true);
    try {
      const fileName = shareFileName(book.title);
      const png = action === "copyText" ? null : await shareCardPng(canvasRef.current!);
      switch (action) {
        case "copyText":
          await copyShareText(formatShareCitation(content, { showChapter: options.showChapter }));
          onNotice(t("share.done.copyText"), "ok");
          break;
        case "copyImage":
          try {
            await copyShareImage(png!);
            onNotice(t("share.done.copyImage"), "ok");
          } catch (error) {
            setCopyImageFailed(true);
            throw error;
          }
          break;
        case "saveImage":
          if (await saveShareImage(png!, fileName, surface, { title: t("share.action.saveImage"), filter: t("share.filter") })) {
            onNotice(t("share.done.saved"), "ok");
          }
          break;
        case "saveGallery":
          await saveShareImageToGallery(png!, fileName);
          onNotice(t("share.done.gallery"), "ok");
          break;
        case "share":
          await shareImageNative(png!, fileName, formatShareCitation(content, { showChapter: options.showChapter }));
          break;
      }
    } catch (error) {
      onNotice(t("share.failed", { error: error instanceof Error ? error.message : String(error) }), "error");
    } finally {
      setBusy(false);
    }
  };

  const actionsText: Record<ShareActionId, string> = {
    copyText: t("share.action.copyText"), copyImage: t("share.action.copyImage"), saveImage: t("share.action.saveImage"),
    saveGallery: t("share.action.saveGallery"), share: t("share.action.share"),
  };
  const identity = [book.title, book.author].filter(Boolean).join(" · ");
  const availableRecent = recent && intersectShareRange(recent, excerpt.bounds);
  return <>
    <div className="share-backdrop" aria-hidden="true" onClick={onClose} />
    <div className="share-sheet" role="dialog" aria-modal="true" aria-labelledby="share-sheet-title" onKeyDown={(event) => {
      if (event.key !== "Tab") return;
      const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled), [tabindex='0']")].filter((el) => el.tabIndex >= 0 && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden");
      const target = event.shiftKey ? focusable[focusable.length - 1] : focusable[0];
      const boundary = event.shiftKey ? focusable[0] : focusable[focusable.length - 1];
      if (event.target === boundary && target) { event.preventDefault(); target.focus(); }
    }}>
      <header className="share-head">
        <span className="share-grabber" aria-hidden="true" />
        <div className="share-title-group"><h1 id="share-sheet-title">{t("share.title")}</h1><span>{identity}</span></div>
        <button type="button" autoFocus className="ui-quiet-btn share-close" aria-label={t("share.close")} title={t("share.close")} onClick={onClose}><CloseIcon /></button>
      </header>
      <div className="share-stage-wrap">
        <div className="share-stage-bar">
          <Segmented label={t("share.view")} value={view} variant="compact"
            options={[{ value: "proof", label: t("share.proof") }, { value: "source", label: t("share.source") }]} onChange={changeView} />
          {view === "source" && availableRecent && <button className="share-recent ui-quiet-btn" type="button" title={t("share.ink.recent")} aria-label={t("share.ink.recent")} onClick={() => setRecall((n) => n + 1)}><HistoryBackIcon size={14} /><span>{t("share.ink.recent")}</span></button>}
        </div>
        <div hidden={view !== "proof"} ref={stageRef} className="share-stage scrollbar-hidden" data-long={long || undefined}>
          <canvas ref={canvasRef} className="share-canvas" role="img" aria-label={t("share.preview")} width={1080} height={1440} />
        </div>
        {view === "source" && <ShareSourceFolio book={book} source={source} excerpt={excerpt} inks={inks} recent={recent} recall={recall}
          long={long} showMarks={options.showMarks} showNote={options.showNote} onRange={changeRange} onToggleNote={toggleNote}
          onInk={(selection, ink) => { setInks((current) => paintShareInk(current, selection, ink)); setRecent(selection); }} />}
        {truncated && <div className="share-fit-mobile"><ShareFitWarning long={long} onLong={() => changeOptions({ ratio: "long" })} /></div>}
      </div>
      <ShareControlsPanel options={options} book={book} accent={draft.accent} coverTone={coverTone} source={source} excerpt={excerpt}
        section={section} truncated={truncated} onSection={setSection} onOptions={changeOptions} onRange={changeRange}
        onRestore={() => setRange(source.full)} onToggleNote={toggleNote} />
      <footer className="share-actions">
        {actions.map((action, index) => <button key={action} type="button" disabled={busy} aria-label={actionsText[action]} title={actionsText[action]}
          className={`share-action${index === actions.length - 1 ? " is-primary" : ""}`} onClick={() => void run(action)}>
          <ShareActionIcon action={action} /><span>{actionsText[action]}</span>
        </button>)}
      </footer>
    </div>
  </>;
}

function ShareActionIcon({ action }: { action: ShareActionId }) {
  if (action === "share") return <ShareIcon size={16} />;
  const path = action === "copyText" ? "M4 6h16M4 12h12M4 18h14"
    : action === "copyImage" ? "M4 4h16v16H4zM4 16l5-5 3 3 2-2 6 6M15 8h.01"
      : "M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4";
  return <svg className="share-line-icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d={path} /></svg>;
}
