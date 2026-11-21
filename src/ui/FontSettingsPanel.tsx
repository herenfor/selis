import type { FontRole } from "../render/settings";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent } from "react";
import type { SystemFont, UserFont } from "./fontStore";
import { createDragDepthTracker } from "./fontDrop";
import { ArrowLeftIcon } from "./readerIcons";
import { CheckIcon, CloseIcon } from "./shelfView/icons";
import { useSheetDrag } from "./sheetDrag";
import { useScrollEdgeFade } from "./scrollEdgeFade";
import { useUiText } from "./localization/UiLanguageProvider";
import "./aaPopover.css";
import "./fontSettings.css";
import { Switch } from "./controls/Switch";
import { Segmented } from "./controls/Segmented";

export interface FontSettingsPanelProps {
  source?: "system" | "imported";
  customFontId?: string;
  customFontName?: string;
  forceFontOverride?: boolean;
  onForceFontOverrideChange?(enabled: boolean): void;
  /** 标题与正文分开设置；关闭时标题沿用正文字体（现行为）。 */
  splitHeadingFont?: boolean;
  headingFontSource?: "system" | "imported";
  headingFontId?: string;
  headingFontName?: string;
  footnoteFontSource?: "system" | "imported";
  footnoteFontId?: string;
  footnoteFontName?: string;
  onSelectFootnoteSystem(family: string): void;
  onSelectFootnoteBook(): void;
  onSelectFootnoteImported(font: UserFont): void;
  onSplitHeadingFontChange?(enabled: boolean): void;
  onSelectHeadingSystem?(family: string): void;
  onSelectHeadingBook?(): void;
  onSelectHeadingImported?(font: UserFont): void;
  systemFonts: SystemFont[];
  userFonts: UserFont[];
  busy: boolean;
  onSelectSystem(family: string): void;
  onSelectBook(): void;
  onSelectImported(font: UserFont): void;
  onDelete(id: string): void;
  onImport(files: File[], role?: FontRole): Promise<void> | void;
  onClose(): void;
  nativeDragActive?: boolean;
  systemFontsStatus?: "idle" | "loading" | "ready" | "error";
  systemFontsError?: string | null;
  onLoadSystemFonts?(): void;
}

export const FONT_ROW_HEIGHT = 36;
export interface FontVirtualWindow<T> {
  items: T[];
  start: number;
  end: number;
  top: number;
  bottom: number;
  totalHeight: number;
}

/** Fixed-size window with spacers keeps rendering bounded and scrollable. */
export function computeFontVirtualWindow<T>(items: readonly T[], scrollTop: number, viewportHeight: number, rowHeight = FONT_ROW_HEIGHT, overscan = 4): FontVirtualWindow<T> {
  const count = items.length;
  const safeRow = Math.max(1, rowHeight);
  const safeTop = Math.max(0, Number.isFinite(scrollTop) ? scrollTop : 0);
  const safeViewport = Math.max(0, Number.isFinite(viewportHeight) ? viewportHeight : 0);
  const first = Math.min(count, Math.max(0, Math.floor(safeTop / safeRow) - Math.max(0, Math.floor(overscan))));
  const last = Math.min(count, Math.max(first, Math.ceil((safeTop + safeViewport) / safeRow) + Math.max(0, Math.floor(overscan))));
  return { items: items.slice(first, last), start: first, end: last, top: first * safeRow, bottom: Math.max(0, (count - last) * safeRow), totalHeight: count * safeRow };
}

/** Compatibility helper for callers that already have a row offset. */
export function visibleFontWindow<T>(items: readonly T[], offset: number, size: number): T[] {
  const start = Math.max(0, Math.min(items.length, Math.floor(offset)));
  return items.slice(start, start + Math.max(0, Math.floor(size)));
}

export function FontSettingsPanel(props: FontSettingsPanelProps) {
  const { t } = useUiText();
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<FontRole>("body");
  const [tab, setTab] = useState<"system" | "imported">("system");
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(520);
  const [rowHeight, setRowHeight] = useState(FONT_ROW_HEIGHT);
  const [dropBusy, setDropBusy] = useState(false);
  const [htmlDragActive, setHtmlDragActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragDepthRef = useRef(createDragDepthTracker());
  useEffect(() => {
    if (props.systemFontsStatus === "idle") props.onLoadSystemFonts?.();
  }, [props.systemFontsStatus, props.onLoadSystemFonts]);
  const split = props.splitHeadingFont === true;
  const activeRole = role === "heading" && !split ? "body" : role;
  const choices = {
    body: {
      roleSource: props.source,
      roleFontId: props.customFontId,
      roleFontName: props.customFontName,
      selectFollow: props.onSelectBook,
      selectSystem: props.onSelectSystem,
      selectImported: props.onSelectImported,
    },
    heading: {
      roleSource: props.headingFontSource,
      roleFontId: props.headingFontId,
      roleFontName: props.headingFontName,
      selectFollow: props.onSelectHeadingBook,
      selectSystem: props.onSelectHeadingSystem,
      selectImported: props.onSelectHeadingImported,
    },
    footnote: {
      roleSource: props.footnoteFontSource,
      roleFontId: props.footnoteFontId,
      roleFontName: props.footnoteFontName,
      selectFollow: props.onSelectFootnoteBook,
      selectSystem: props.onSelectFootnoteSystem,
      selectImported: props.onSelectFootnoteImported,
    },
  };
  const { roleSource, roleFontId, roleFontName, selectFollow, selectSystem, selectImported } = choices[activeRole];
  const followLabel = activeRole === "heading" ? t("fonts.followBody") : t("fonts.followBook");
  const normalized = query.trim().toLocaleLowerCase();
  const systems = useMemo(() => props.systemFonts.filter((font) => {
    if (!normalized) return true;
    return [font.family, ...font.localizedNames.map((item) => item.name)]
      .some((name) => name.toLocaleLowerCase().includes(normalized));
  }), [props.systemFonts, normalized]);
  const imported = useMemo(() => props.userFonts.filter((font) => {
    if (!normalized) return true;
    return `${font.family} ${font.fileName}`.toLocaleLowerCase().includes(normalized);
  }), [props.userFonts, normalized]);
  const virtual = tab === "system"
    ? computeFontVirtualWindow(systems, scrollTop, viewportHeight, rowHeight)
    : computeFontVirtualWindow(imported, scrollTop, viewportHeight, rowHeight);
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    // This persistent sibling has the same row CSS as the virtual items (36px
    // desktop, 48px touch). CSS owns the size; the window must use that same pitch.
    const row = element.parentElement?.querySelector<HTMLElement>(".font-follow-book");
    const sync = () => {
      setViewportHeight(current => element.clientHeight === current ? current : element.clientHeight);
      const height = row ? Number.parseFloat(getComputedStyle(row).height) : 0;
      if (height > 0) setRowHeight(current => current === height ? current : height);
    };
    sync();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(sync);
    observer?.observe(element);
    if (row) observer?.observe(row);
    window.addEventListener("resize", sync);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", sync);
    };
  }, []);
  const resetScroll = () => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    setScrollTop(0);
  };
  const selectTab = (next: "system" | "imported") => { setTab(next); resetScroll(); };
  useEffect(() => {
    if (!split) setRole((current) => current === "heading" ? "body" : current);
  }, [split]);
  const importFiles = async (files: File[]) => {
    if (props.busy || dropBusy || files.length === 0) return;
    setDropBusy(true);
    try {
      await props.onImport(files, activeRole);
    } finally {
      setDropBusy(false);
    }
  };
  const onDragEnter = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!event.dataTransfer.types.includes("Files")) return;
    setHtmlDragActive(dragDepthRef.current.enter());
  };
  const onDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setHtmlDragActive(dragDepthRef.current.leave());
  };
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setHtmlDragActive(dragDepthRef.current.reset());
    void importFiles(Array.from(event.dataTransfer.files));
  };
  const dragActive = htmlDragActive || props.nativeDragActive === true;
  const effectiveBusy = props.busy || dropBusy;
  // Aa 的子页：把手下拉和左上返回都回到 Aa 主页，不关闭整个 Aa。
  const panelRef = useRef<HTMLDivElement>(null);
  const { dragging, grip } = useSheetDrag({ sheetRef: panelRef, onDismiss: props.onClose });
  useScrollEdgeFade(scrollRef);
  return <div ref={panelRef} data-font-role={activeRole} className={`font-settings-panel${dragActive ? " font-drag-active" : ""}${dragging ? " is-dragging" : ""}`} role="dialog" aria-modal="true" aria-label={t("fonts.dialog")}
    onDragEnter={onDragEnter}
    onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = effectiveBusy ? "none" : "copy"; }}
    onDragLeave={onDragLeave} onDrop={onDrop}>
    <div className="drawer-drag-handle font-settings-grip" aria-hidden="true" {...grip} />
    <div className="aa-subpage-head font-settings-head">
      <button type="button" className="aa-back-btn" onClick={props.onClose} title={t("fonts.back")} aria-label={t("fonts.back")}>
        <ArrowLeftIcon size={14} />
        <span>{t("aa.back.short")}</span>
      </button>
      <span className="aa-subpage-title">{t("fonts.title")}</span>
    </div>

    {(props.onSplitHeadingFontChange || props.onForceFontOverrideChange) && (
      <div className="font-settings-options">
        {props.onSplitHeadingFontChange && (
          <label className="font-settings-option" title={t("fonts.split.hint")}>
            <span>{t("fonts.split")}</span>
            <Switch inRow checked={split} onChange={(checked) => {
              props.onSplitHeadingFontChange?.(checked);
            }} />
          </label>
        )}
        {props.onForceFontOverrideChange && (
          <label className="font-settings-option" title={t(split ? "fonts.override.hint.split" : "fonts.override.hint")}>
            <span>{t("fonts.override")}</span>
            <Switch inRow checked={props.forceFontOverride === true} disabled={!props.source && !(split && props.headingFontName)}
              onChange={(checked) => props.onForceFontOverrideChange?.(checked)} />
          </label>
        )}
        {props.onForceFontOverrideChange && (
          <p className="font-settings-option-hint" title={split ? t("fonts.override.hint.split") : t("fonts.override.hint")}>
            {t("fonts.override.hint.short")}
          </p>
        )}
      </div>
    )}

    <div className="font-settings-rolebar">
      <span className="font-settings-rolebar-label">{t("fonts.role")}</span>
      <Segmented label={t("fonts.role")} value={activeRole} className="font-settings-tabs font-settings-roles"
        options={[
          { value: "body", label: t("fonts.role.body") },
          ...(split ? [{ value: "heading" as const, label: t("fonts.role.heading") }] : []),
          { value: "footnote", label: t("fonts.role.footnote") },
        ]}
        onChange={(next) => { setRole(next); resetScroll(); }} />
    </div>

    <div className="font-settings-toolbar">
      <input className="font-search" type="search" placeholder={t("fonts.search")} aria-label={t("fonts.search")} value={query}
        onChange={(event) => { setQuery(event.target.value); resetScroll(); }} />
      <button type="button" className="font-import-btn" onClick={() => inputRef.current?.click()} disabled={effectiveBusy}>{effectiveBusy ? t("fonts.importing") : t("fonts.import")}</button>
    </div>

    <Segmented label={t("fonts.tabs")} value={tab} className="font-settings-tabs font-settings-source"
      options={[
        { value: "system", label: t("fonts.tab.system", { count: systems.length }) },
        { value: "imported", label: t("fonts.tab.imported", { count: imported.length }) },
      ]}
      onChange={selectTab} />

    <div className={`font-settings-row-wrap font-follow-book${!roleSource ? " active" : ""}`}>
      <button className="font-settings-row" onClick={selectFollow}>{followLabel}</button>
      <span className="font-settings-row-mark" aria-hidden="true">{!roleSource ? <CheckIcon /> : null}</span>
    </div>

    <div ref={scrollRef} className="font-settings-scroll scrollbar-hidden" onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}>
      {tab === "system" && props.systemFontsStatus === "loading" && <div className="font-empty">{t("fonts.system.loading")}</div>}
      {tab === "system" && props.systemFontsStatus === "error" && <div className="font-empty">{t("fonts.system.failed", { error: props.systemFontsError ?? t("fonts.unknownError") })}<br /><button className="menu-item" onClick={props.onLoadSystemFonts}>{t("fonts.retry")}</button></div>}
      {tab === "system" && props.systemFontsStatus !== "loading" && props.systemFontsStatus !== "error" && roleSource === "system" && roleFontName && props.systemFontsStatus === "ready" && !systems.some((font) => font.family === roleFontName) && <div className="font-empty">{t("fonts.unavailable", { name: roleFontName })}</div>}
      {tab === "system" && systems.length === 0 && props.systemFontsStatus === "ready" && <div className="font-empty">{t("fonts.system.none")}</div>}
      {tab === "imported" && imported.length === 0 && <div className="font-empty">{t("fonts.imported.none")}</div>}
      <div style={{ height: virtual.totalHeight, position: "relative" }}>
        <div style={{ height: virtual.top }} />
        {virtual.items.map((font) => {
          if (tab === "system") {
            const family = (font as SystemFont).family;
            const active = roleSource === "system" && roleFontName === family;
            return (
              <div key={family} className={`font-settings-row-wrap${active ? " active" : ""}`}>
                <button className="font-settings-row" onClick={() => selectSystem?.(family)}>{family}</button>
                <span className="font-settings-row-mark" aria-hidden="true">{active ? <CheckIcon /> : null}</span>
              </div>
            );
          }
          const item = font as UserFont;
          const active = roleSource === "imported" && roleFontId === item.id;
          return (
            <div key={item.id} className={`font-settings-row-wrap${active ? " active" : ""}`}>
              <button className="font-settings-row" onClick={() => selectImported?.(item)} title={item.fileName}>{item.family}</button>
              <span className="font-settings-row-mark" aria-hidden="true">{active ? <CheckIcon /> : null}</span>
              <button className="font-delete" onClick={() => props.onDelete(item.id)} disabled={effectiveBusy} title={t("fonts.delete")} aria-label={t("fonts.delete")}><CloseIcon /></button>
            </div>
          );
        })}
        <div style={{ height: virtual.bottom }} />
      </div>
    </div>

    <div className="font-drop-zone" aria-live="polite" aria-label={t("fonts.drop")}>
      {effectiveBusy ? t("fonts.importing") : dragActive ? t("fonts.dropRelease") : t("fonts.dropHint")}
    </div>
    <input ref={inputRef} type="file" accept=".ttf,.otf,.woff,.woff2" multiple hidden onChange={(event) => {
      const files = Array.from(event.target.files ?? []); void importFiles(files); event.target.value = "";
    }} />
  </div>;
}
