import { useLayoutEffect, useRef, type KeyboardEvent } from "react";
import { useUiText } from "../localization/UiLanguageProvider";
import { MinusIcon, PlusIcon } from "../readerIcons";
import { useScrollEdgeFade } from "../scrollEdgeFade";
import { canUseVertical, shareCardPalette, SHARE_RATIOS, SHARE_TEMPLATES, type ShareCardOptions, type ShareRatio } from "./shareCardModel";
import type { ShareSheetBook } from "./ShareSheet";
import type { buildShareExcerpt, createShareSource, ShareSentenceRange } from "./shareSourceModel";
import { ShareNoteChoices } from "./ShareNoteChoices";
import "./shareControlsPanel.css";

export function ShareFitWarning({ long, onLong }: { long: boolean; onLong(): void }) {
  const { t } = useUiText();
  return <p className="share-fit" role="status">{t(long ? "share.fit.longTruncated" : "share.fit.truncated")}{!long && <button className="share-text-button" type="button" onClick={onLong}>{t("share.fit.useLong")}</button>}</p>;
}

const SECTIONS = ["style", "range", "content"] as const;
export type ShareSection = (typeof SECTIONS)[number];
type Flag = "showMarks" | "showNote" | "showChapter" | "showCover" | "showBrand";

interface Props {
  options: ShareCardOptions;
  book: ShareSheetBook;
  accent?: string;
  coverTone: string | null;
  source: ReturnType<typeof createShareSource>;
  excerpt: ReturnType<typeof buildShareExcerpt>;
  section: ShareSection;
  truncated: boolean;
  onSection(section: ShareSection): void;
  onOptions(patch: Partial<ShareCardOptions>): void;
  onRange(edge: keyof ShareSentenceRange, step: number): void;
  onRestore(): void;
  onToggleNote(id: string): void;
}

const RATIO_SHAPES = {
  "3:4": { x: 4.5, y: 2, width: 11, height: 14 },
  "1:1": { x: 3.5, y: 2.5, width: 13, height: 13 },
  "9:16": { x: 5.5, y: 1.25, width: 9, height: 15.5 },
};

function RatioIcon({ ratio }: { ratio: ShareRatio }) {
  const shape = ratio === "long" ? null : RATIO_SHAPES[ratio];
  return <svg viewBox="0 0 20 18" className="share-ratio-icon" aria-hidden="true">
    {shape ? <rect {...shape} rx="2" /> : <><path d="M5 12.5v-9a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v9Z" /><path strokeDasharray="1 2" d="M5 15h10m-8 2h6" /></>}
    <path d={shape ? "M8 6.25h4m-4 3.25h3" : "M8 5h4M8 8h4"} />
  </svg>;
}

export function ShareControlsPanel({ options, book, accent, coverTone, source, excerpt, section, truncated, onSection, onOptions, onRange, onRestore, onToggleNote }: Props) {
  const { t } = useUiText();
  const side = useRef<HTMLDivElement>(null);
  useScrollEdgeFade(side);
  useLayoutEffect(() => { if (side.current && side.current.offsetWidth) side.current.scrollTop = 0; }, [section]);
  const { first, last } = excerpt.range;
  const locked = options.ratio === "long";
  const count = last - first + 1;
  const total = source.sentences.length;
  const verticalAllowed = canUseVertical(excerpt.quote, options.ratio);
  const activeTemplate = options.template === "vertical" && !verticalAllowed ? "paper" : options.template;
  const labels = { style: t("share.template"), range: t("share.tab.range"), content: t("share.tab.content") };
  const flags: { key: Flag; label: string; detail?: string; disabled?: boolean }[] = [
    { key: "showMarks", label: t("share.toggle.marks"), detail: t("share.marks.count", { count: excerpt.marks.length }), disabled: !excerpt.marks.length },
    { key: "showNote", label: t("share.toggle.note"), detail: t("share.notes.count", { kept: excerpt.included.length, total: excerpt.notes.length }), disabled: !excerpt.notes.length },
    { key: "showChapter", label: t("share.toggle.chapter"), detail: book.chapter, disabled: !book.chapter },
    { key: "showCover", label: t("share.toggle.cover"), detail: book.coverUrl ? book.title : undefined, disabled: !book.coverUrl },
    { key: "showBrand", label: t("share.toggle.brand"), detail: "SeLis" },
  ];
  const chooseTab = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = event.key === "ArrowRight" ? (index + 1) % SECTIONS.length : event.key === "ArrowLeft" ? (index + SECTIONS.length - 1) % SECTIONS.length : -1;
    if (next < 0) return;
    event.preventDefault();
    onSection(SECTIONS[next]);
    (event.currentTarget.parentElement?.children[next] as HTMLButtonElement | undefined)?.focus();
  };
  return <>
    <div role="tablist" className="share-tabs" aria-label={t("share.settings")}>
      {SECTIONS.map((key, index) => <button key={key} type="button" id={`share-tab-${key}`} role="tab"
        aria-controls={`share-panel-${key}`} aria-selected={section === key} tabIndex={section === key ? 0 : -1}
        onKeyDown={(event) => chooseTab(event, index)} onClick={() => onSection(key)}>
        {labels[key]}
        {key === "range" && <span>{count}/{total}</span>}
        {key === "content" && excerpt.included.length > 0 && options.showNote && <span>{excerpt.included.length}</span>}
      </button>)}
    </div>
    <div ref={side} className="share-side scrollbar-hidden" aria-label={t("share.settings")} data-section={section}>
      <section className="share-side-panel" id="share-panel-style" data-active={section === "style"} aria-label={labels.style}>
        <div className="share-group">
          <span className="share-label">{labels.style}</span>
          <div className="share-look-grid" role="group" aria-label={labels.style}>
            {SHARE_TEMPLATES.map((id) => {
              const label = t(`share.template.${id}`);
              const disabled = id === "vertical" && !verticalAllowed;
              const palette = shareCardPalette(id, accent, coverTone);
              return <button key={id} type="button" aria-pressed={id === activeTemplate} disabled={disabled}
                title={disabled ? t(locked ? "share.template.verticalNotLong" : "share.template.verticalOnlyCjk") : label}
                onClick={() => onOptions({ template: id })}>
                <span className="share-look-tile" data-vertical={id === "vertical"} style={{ background: palette.bg, color: palette.fg }} aria-hidden="true"><span>{id === "vertical" ? "文字" : "文"}</span></span>
                <span>{label}</span>
              </button>;
            })}
          </div>
        </div>
        <div className="share-group">
          <span className="share-label">{t("share.ratio")}</span>
          <div className="share-ratios" role="group" aria-label={t("share.ratio")}>
            {SHARE_RATIOS.map((ratio) => <button key={ratio} type="button" aria-pressed={ratio === options.ratio} onClick={() => onOptions({ ratio })}>
              <RatioIcon ratio={ratio} />{ratio === "long" ? t("share.ratio.long") : ratio}
            </button>)}
          </div>
        </div>
      </section>
      <section className="share-side-panel share-group" id="share-panel-range" data-active={section === "range"} aria-label={t("share.range")}>
        <div className="share-group-head">
          <span className="share-label">{t("share.range")}</span>
          <span className="share-meta" aria-live="polite">{t("share.range.count", { kept: count, total, chars: [...excerpt.quote].length })}</span>
          {!locked && count !== total && <button className="share-text-button" type="button" onClick={onRestore}>{t("share.range.restore")}</button>}
        </div>
        <div className="share-param-card">
          {([
            ["first", first, 1, first === 0, "share.range.first", "share.range.trimFirst", "share.range.undoFirst"],
            ["last", last, -1, last === total - 1, "share.range.last", "share.range.trimLast", "share.range.undoLast"],
          ] as const).map(([edge, index, step, atEnd, label, trim, undo]) => <div className="share-range-row" key={edge}>
            <span className="share-edge-badge">{t(label)}</span>
            <span className="share-edge-snippet" title={source.sentences[index].text}>{source.sentences[index].text}</span>
            <div className="share-stepper">
              <button type="button" aria-label={t(trim)} title={t(trim)} disabled={locked || first === last} onClick={() => onRange(edge, step)}><MinusIcon /></button>
              <button type="button" aria-label={t(undo)} title={t(undo)} disabled={locked || atEnd} onClick={() => onRange(edge, -step)}><PlusIcon /></button>
            </div>
          </div>)}
        </div>
        {locked && !truncated && <span className="share-meta">{t("share.range.locked")}</span>}
        {truncated && <ShareFitWarning long={locked} onLong={() => onOptions({ ratio: "long" })} />}
      </section>
      <section className="share-side-panel share-group" id="share-panel-content" data-active={section === "content"} aria-label={t("share.content")}>
        <span className="share-label">{t("share.content")}</span>
        <div className="share-param-card">
          {flags.map(({ key, label, detail, disabled }) => <div className="share-flag" key={key}>
            <button type="button" role="switch" aria-label={label} aria-checked={!disabled && options[key]} disabled={disabled} className="share-toggle-row" onClick={() => onOptions({ [key]: !options[key] })}>
              <span>{label}</span><span className="share-meta" title={detail}>{detail}</span><span className="share-switch" aria-hidden="true" />
            </button>
            {key === "showNote" && options.showNote && <ShareNoteChoices excerpt={excerpt} onToggle={onToggleNote} />}
          </div>)}
        </div>
      </section>
    </div>
  </>;
}
