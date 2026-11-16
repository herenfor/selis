import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { formatListKey } from "../bookFormatText";
import { MENU_CLOSE_MS, useExitPresence } from "../menuMotion";
import { useUiText } from "../localization/UiLanguageProvider";
import { shortTabTitle } from "../readerTabs";
import type { ShelfSpaceKind } from "../shelfSpaces";
import {
  BookAddIcon,
  BookLogoIcon,
  CheckIcon,
  ChevronDownIcon,
  DeviceTransferIcon,
  FolderAddIcon,
  LockIcon,
  NewTabIcon,
  PlusIcon,
} from "./icons";
import { useShelfSubmenuBack, type ShelfSubmenuBackProps } from "./submenuBack";

interface ShelfImportButtonProps extends ShelfSubmenuBackProps {
  compact: boolean;
  disabled: boolean;
  /** Drag-and-drop works only with a mouse; hide the hint on touch. */
  showDropHint: boolean;
  /** Open folder the main action imports into; absent = shelf root. */
  targetName?: string;
  onImport(): void;
  onImportFolder?(): void;
  /** 设备互传, also reachable from 设置 → 数据与备份. */
  onOpenLanTransfer?(): void;
  lanTransferDisabled?: boolean;
  /** A34 (Windows): the remembered "copy into the library" choice; absent hides it. */
  copyToLibrary?: boolean;
  onCopyToLibraryChange?(copy: boolean): void;
}

/**
 * Shelf import entry. With directory import or device transfer available it is
 * a split button (main action = 导入图书, caret = menu); on phones the whole 导入
 * button opens the menu. The menu animates in/out with the shared popover motion.
 */
export function ShelfImportButton(props: ShelfImportButtonProps) {
  const { t } = useUiText();
  const importTip = props.targetName === undefined
    ? t(formatListKey("shelf.import.tip"))
    : t(formatListKey("shelf.import.toFolder.tip"), { name: props.targetName });
  const [open, setOpen] = useState(false);
  const { present, closing } = useExitPresence(open);
  const wrapRef = useRef<HTMLDivElement>(null);

  useShelfSubmenuBack(open, () => setOpen(false), props);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (props.disabled) setOpen(false);
  }, [props.disabled]);

  if (!props.onImportFolder && !props.onOpenLanTransfer) {
    return (
      <button
        className={`shelf-btn-primary${props.compact ? " shelf-mobile-import-btn" : ""}`}
        type="button"
        onClick={() => props.onImport()}
        disabled={props.disabled}
        title={importTip}
      >
        <PlusIcon />
        <span>{props.compact ? t("shelf.import.short") : t("shelf.import.books")}</span>
      </button>
    );
  }

  const choose = (action: () => void) => {
    setOpen(false);
    action();
  };

  return (
    <div className="shelf-import-split" ref={wrapRef}>
      {props.compact ? (
        <button
          className="shelf-btn-primary shelf-mobile-import-btn"
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          disabled={props.disabled}
          title={t("shelf.import.menu.tip")}
        >
          <PlusIcon />
          <span>{t("shelf.import.short")}</span>
        </button>
      ) : (
        <>
          <button
            className="shelf-btn-primary shelf-import-main"
            type="button"
            onClick={() => props.onImport()}
            disabled={props.disabled}
            title={importTip}
          >
            <PlusIcon />
            <span>{t("shelf.import.books")}</span>
          </button>
          <button
            className="shelf-btn-primary shelf-import-caret"
            type="button"
            aria-label={t("shelf.import.more")}
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
            disabled={props.disabled}
          >
            <ChevronDownIcon />
          </button>
        </>
      )}
      {present && (
        <div className={`shelf-import-menu${closing ? " is-closing" : ""}`} role="menu" aria-label={t("shelf.import.menu")}>
          <button className="shelf-import-menu-item" type="button" role="menuitem" onClick={() => choose(props.onImport)}>
            <span className="shelf-import-menu-icon"><BookAddIcon /></span>
            <span className="shelf-import-menu-text">
              <strong>{t("shelf.import.books")}</strong>
              <small>{t(formatListKey("shelf.import.books.detail"))}</small>
            </span>
          </button>
          {props.onImportFolder && (
            <button className="shelf-import-menu-item" type="button" role="menuitem" onClick={() => choose(props.onImportFolder!)}>
              <span className="shelf-import-menu-icon"><FolderAddIcon /></span>
              <span className="shelf-import-menu-text">
                <strong>{t("shelf.import.folder")}</strong>
                <small>{t("shelf.import.folder.detail")}</small>
              </span>
            </button>
          )}
          {props.onOpenLanTransfer && (
            <button
              className="shelf-import-menu-item"
              type="button"
              role="menuitem"
              disabled={props.lanTransferDisabled}
              onClick={() => choose(props.onOpenLanTransfer!)}
            >
              <span className="shelf-import-menu-icon"><DeviceTransferIcon /></span>
              <span className="shelf-import-menu-text">
                <strong>{t("shelfMenu.lan")}</strong>
                <small>{t("shelf.import.lan.detail")}</small>
              </span>
            </button>
          )}
          {props.copyToLibrary !== undefined && props.onCopyToLibraryChange && (
            <label className="shelf-import-menu-check">
              <input
                type="checkbox"
                checked={props.copyToLibrary}
                onChange={(event) => props.onCopyToLibraryChange!(event.target.checked)}
              />
              <span className="shelf-import-menu-text">
                <strong>{t("shelf.import.copy")}</strong>
                <small>{t("shelf.import.copy.detail")}</small>
              </span>
            </label>
          )}
          {props.showDropHint && <p className="shelf-import-menu-hint">{t(formatListKey(props.onImportFolder ? "shelf.import.dropHint" : "shelf.import.dropHint.booksOnly"))}</p>}
        </div>
      )}
    </div>
  );
}

export interface ShelfSwitchProps {
  active: ShelfSpaceKind;
  /** Shelves offered besides the library, in menu order. */
  spaces: readonly ShelfSpaceKind[];
  /** A configured password: the private row reads “needs password” instead of “set a password”. */
  privateConfigured: boolean;
  onSelect(kind: ShelfSpaceKind): void;
  /** Leaves a locked shelf for the library. */
  onLock(): void;
}

/**
 * The shelf title. With other shelves available it is a switcher: the menu
 * lists the library and each other shelf, and a locked shelf adds a 锁定
 * button beside the title that returns to the library.
 */
export function ShelfBrand(props: { switcher?: ShelfSwitchProps; disabled: boolean } & ShelfSubmenuBackProps) {
  const { t } = useUiText();
  const switcher = props.switcher;
  const [open, setOpen] = useState(false);
  const { present, closing } = useExitPresence(open);
  const wrapRef = useRef<HTMLDivElement>(null);
  useShelfSubmenuBack(open, () => setOpen(false), props);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  useEffect(() => {
    if (props.disabled) setOpen(false);
  }, [props.disabled]);

  const isPrivate = switcher?.active === "private";
  const title = isPrivate ? t("shelfMain.space.private") : t("shelfMain.brand");
  const badge = (
    <div className="shelf-logo-badge" aria-hidden="true">
      {isPrivate ? <LockIcon logo /> : <BookLogoIcon />}
    </div>
  );
  if (!switcher || switcher.spaces.length === 0) {
    return (
      <div className="shelf-brand-zone-zen">
        {badge}
        <span className="shelf-brand-title">{title}</span>
      </div>
    );
  }
  const choose = (kind: ShelfSpaceKind) => {
    setOpen(false);
    if (kind !== switcher.active) switcher.onSelect(kind);
  };
  const row = (kind: ShelfSpaceKind) => {
    const library = kind === "library";
    const detail = library || kind === switcher.active ? null
      : switcher.privateConfigured ? t("shelfMain.space.private.locked") : t("shelfMain.space.private.setup");
    return (
      <button key={kind} className="shelf-import-menu-item" type="button" role="menuitemradio"
        aria-checked={kind === switcher.active} disabled={props.disabled} onClick={() => choose(kind)}>
        <span className="shelf-import-menu-icon">{library ? <BookLogoIcon /> : <LockIcon />}</span>
        <span className="shelf-import-menu-text">
          <strong>{library ? t("shelfMain.brand") : t("shelfMain.space.private")}</strong>
          {detail && <small>{detail}</small>}
        </span>
        {kind === switcher.active && <span className="shelf-space-check"><CheckIcon /></span>}
      </button>
    );
  };
  return (
    <div className="shelf-brand-zone-zen shelf-space-zone" ref={wrapRef}>
      <button className="shelf-space-switch" type="button" aria-haspopup="menu" aria-expanded={open}
        aria-label={t("shelfMain.space.switch")} title={t("shelfMain.space.switch")}
        disabled={props.disabled} onClick={() => setOpen((value) => !value)}>
        {badge}
        <span className="shelf-brand-title">{title}</span>
        <ChevronDownIcon />
      </button>
      {isPrivate && (
        <button className="shelf-space-lock" type="button" onClick={switcher.onLock}
          title={t("shelfMain.space.lock.tip")} disabled={props.disabled}>
          <LockIcon />
          <span>{t("shelfMain.space.lock")}</span>
        </button>
      )}
      {present && (
        <div className={`shelf-import-menu shelf-space-menu${closing ? " is-closing" : ""}`} role="menu" aria-label={t("shelfMain.space.switch")}>
          {(["library", ...switcher.spaces] as ShelfSpaceKind[]).map(row)}
        </div>
      )}
    </div>
  );
}

/**
 * A11: “choose a book for a new tab”, started from the reader's + panel. Esc or
 * Cancel goes back to the book the reader came from; open books carry a badge.
 */
export function ShelfTabPickBar(props: {
  pick: { count: number; returnTitle: string | null; onCancel(): void };
  max: number;
  openIds: ReadonlySet<string>;
}) {
  const { t } = useUiText();
  const { onCancel } = props.pick;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);
  const escape = (id: string) => (typeof CSS !== "undefined" && CSS.escape ? CSS.escape(id) : id.replace(/["\\]/g, "\\$&"));
  const badge = [...props.openIds].map((id) => `.shelf-view.is-tab-pick [data-book-id="${escape(id)}"]`).join(",");
  return <>
    {badge && <style>{`${badge} { --shelf-tab-open-badge: ${JSON.stringify(t("shelf.tabPick.open"))}; }`}</style>}
    <div className="shelf-tab-pick" role="status">
      <NewTabIcon />
      <span className="shelf-tab-pick-title">{t("shelf.tabPick.title")}</span>
      <span className="shelf-tab-pick-count">{t("shelf.tabPick.count", { count: props.pick.count, max: props.max })}</span>
      <button type="button" className="ui-btn shelf-tab-pick-cancel" onClick={onCancel}>
        {props.pick.returnTitle ? t("shelf.tabPick.cancel", { title: shortTabTitle(props.pick.returnTitle, 12) }) : t("shelf.tabPick.cancelPlain")}
      </button>
    </div>
  </>;
}

/** The one presentation for an empty shelf, an empty scope and a list with no match. */
export function ShelfEmptyState(props: { icon: ReactNode; title: string; hint: string; children?: ReactNode }) {
  return (
    <div className="shelf-empty">
      <div className="shelf-empty-icon" aria-hidden="true">
        {props.icon}
      </div>
      <div className="shelf-empty-title">{props.title}</div>
      <div className="shelf-empty-hint">{props.hint}</div>
      {props.children}
    </div>
  );
}

/* =========================================================================
 * 极简下拉选择组件
 * ========================================================================= */

export interface ShelfSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export function ShelfSelect(props: ShelfSubmenuBackProps & {
  value: string;
  options: ShelfSelectOption[];
  onChange(value: string): void;
  title?: string;
  ariaLabel?: string;
  placeholder?: string;
  className?: string;
  busy?: boolean;
  portal?: boolean;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [portalStyle, setPortalStyle] = useState<{ style: CSSProperties; openUp: boolean } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<number | null>(null);

  const closeDropdown = useCallback(() => {
    if (!open || closing) return;
    setClosing(true);
    timerRef.current = window.setTimeout(() => {
      setOpen(false);
      setClosing(false);
      timerRef.current = null;
    }, MENU_CLOSE_MS);
  }, [open, closing]);

  useShelfSubmenuBack(open, closeDropdown, props);

  const updatePortalPosition = useCallback(() => {
    if (!props.portal || !ref.current || typeof window === "undefined") {
      setPortalStyle(null);
      return;
    }
    const rect = ref.current.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      setPortalStyle(null);
      return;
    }
    const margin = 12;
    const minWidth = Math.max(140, Math.round(rect.width));
    const maxWidth = Math.min(360, Math.max(180, window.innerWidth - margin * 2));
    const spaceBelow = Math.max(0, window.innerHeight - rect.bottom - margin);
    const spaceAbove = Math.max(0, rect.top - margin);
    const estHeight = Math.min(280, Math.max(48, props.options.length * 34 + 10));
    const openUp = spaceBelow < estHeight && spaceAbove > spaceBelow;
    const maxHeight = Math.max(120, Math.min(280, openUp ? spaceAbove : spaceBelow));
    const preferRight = props.align === "right" || rect.left + minWidth > window.innerWidth - margin;
    const style: CSSProperties = {
      minWidth: `${minWidth}px`,
      maxWidth: `${maxWidth}px`,
      maxHeight: `${Math.round(maxHeight)}px`,
      ...(preferRight
        ? { right: `${Math.max(margin, Math.round(window.innerWidth - rect.right))}px`, left: "auto" }
        : { left: `${Math.max(margin, Math.round(rect.left))}px`, right: "auto" }),
      ...(openUp
        ? { bottom: `${Math.max(margin, Math.round(window.innerHeight - rect.top + 5))}px`, top: "auto", transformOrigin: "bottom center" }
        : { top: `${Math.round(rect.bottom + 5)}px`, bottom: "auto", transformOrigin: "top center" }),
    };
    setPortalStyle({ style, openUp });
  }, [props.portal, props.align, props.options.length]);

  const toggleDropdown = useCallback(() => {
    if (closing) return;
    if (open) {
      closeDropdown();
    } else {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setClosing(false);
      setOpen(true);
    }
  }, [open, closing, closeDropdown]);

  useLayoutEffect(() => {
    if (!props.portal || (!open && !closing)) return;
    updatePortalPosition();
  }, [props.portal, open, closing, updatePortalPosition]);

  useEffect(() => {
    if (!open || closing) return;
    const onDown = (e: PointerEvent): void => {
      const target = e.target as Node | null;
      if (!target) return;
      if (!ref.current?.contains(target) && !popRef.current?.contains(target)) closeDropdown();
    };
    // Capture and claim Escape so a dialog around the dropdown stays open.
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      closeDropdown();
    };
    const onScroll = (e: Event): void => {
      if (!props.portal) return;
      const target = e.target as Node | null;
      if (target && popRef.current?.contains(target)) return;
      updatePortalPosition();
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey, true);
    if (props.portal) {
      window.addEventListener("scroll", onScroll, true);
      window.addEventListener("resize", updatePortalPosition);
    }
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey, true);
      if (props.portal) {
        window.removeEventListener("scroll", onScroll, true);
        window.removeEventListener("resize", updatePortalPosition);
      }
    };
  }, [open, closing, closeDropdown, props.portal, updatePortalPosition]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const matched = props.options.find((o) => o.value === props.value);
  const label = matched?.label ?? props.placeholder ?? props.options[0]?.label ?? "";
  const isPlaceholder = !matched && props.placeholder !== undefined;
  const wrapClass = `shelf-select-wrap${props.className ? ` ${props.className}` : ""}`;

  const popNode = (open || closing) ? (
    <div
      ref={popRef}
      className={`shelf-select-pop${props.portal && portalStyle ? " is-portal" : ""}${portalStyle?.openUp ? " is-up" : ""}${closing ? " closing" : ""}`}
      role="listbox"
      style={props.portal ? portalStyle?.style : undefined}
    >
      {props.options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={`shelf-select-option${o.value === props.value ? " selected" : ""}`}
          role="option"
          aria-selected={o.value === props.value}
          disabled={o.disabled}
          onClick={() => {
            props.onChange(o.value);
            closeDropdown();
          }}
        >
          <span>{o.label}</span>
          {o.value === props.value ? (
            <span className="shelf-select-check">
              <CheckIcon />
            </span>
          ) : null}
        </button>
      ))}
    </div>
  ) : null;

  const portalHost = props.portal && typeof document !== "undefined"
    ? ((ref.current?.closest(".app") as HTMLElement | null) ?? document.body)
    : null;

  return (
    <div className={wrapClass} ref={ref}>
      <button
        type="button"
        className={`shelf-select-btn${open && !closing ? " open" : ""}${isPlaceholder ? " is-placeholder" : ""}`}
        title={props.title}
        aria-label={props.ariaLabel}
        disabled={props.busy}
        aria-expanded={open && !closing}
        onClick={toggleDropdown}
      >
        <span>{label}</span>
        <span className="shelf-select-arrow" aria-hidden="true" />
      </button>
      {popNode && (portalHost ? createPortal(popNode, portalHost) : popNode)}
    </div>
  );
}

/* =========================================================================
 * 首字母快速索引轨与拼音边界算法 (A-Z Fast Index Rail)
 * ========================================================================= */

const AZ_LETTERS = [
  "A", "B", "C", "D", "E", "F", "G", "H", "I", "J",
  "K", "L", "M", "N", "O", "P", "Q", "R", "S", "T",
  "U", "V", "W", "X", "Y", "Z", "#"
];

const PINYIN_BOUNDS = [
  { letter: "A", char: "阿" },
  { letter: "B", char: "八" },
  { letter: "C", char: "嚓" },
  { letter: "D", char: "哒" },
  { letter: "E", char: "妸" },
  { letter: "F", char: "发" },
  { letter: "G", char: "旮" },
  { letter: "H", char: "哈" },
  { letter: "J", char: "击" },
  { letter: "K", char: "咔" },
  { letter: "L", char: "垃" },
  { letter: "M", char: "妈" },
  { letter: "N", char: "拿" },
  { letter: "O", char: "噢" },
  { letter: "P", char: "妑" },
  { letter: "Q", char: "七" },
  { letter: "R", char: "呥" },
  { letter: "S", char: "仨" },
  { letter: "T", char: "他" },
  { letter: "W", char: "穵" },
  { letter: "X", char: "夕" },
  { letter: "Y", char: "丫" },
  { letter: "Z", char: "帀" },
];

export function getInitialLetter(str: string): string {
  if (!str) return "#";
  const ch = str.trim().charAt(0);
  if (/[a-zA-Z]/.test(ch)) return ch.toUpperCase();
  if (/[\u4e00-\u9fa5]/.test(ch)) {
    for (let i = PINYIN_BOUNDS.length - 1; i >= 0; i--) {
      if (ch.localeCompare(PINYIN_BOUNDS[i].char, "zh-Hans-CN") >= 0) {
        return PINYIN_BOUNDS[i].letter;
      }
    }
  }
  return "#";
}

interface ShelfAZRailProps {
  letterIndexMap: Map<string, number>;
  onSelectLetter(letter: string, targetIndex: number): void;
}

export const ShelfAZRail = memo(function ShelfAZRail({ letterIndexMap, onSelectLetter }: ShelfAZRailProps) {
  const { t } = useUiText();
  return (
    <div className="shelf-az-rail" aria-label={t("shelfMenu.azRail")}>
      {AZ_LETTERS.map((letter) => {
        const hasBooks = letterIndexMap.has(letter);
        return (
          <button
            key={letter}
            className={`shelf-az-letter${!hasBooks ? " disabled" : ""}`}
            type="button"
            disabled={!hasBooks}
            onClick={() => {
              const idx = letterIndexMap.get(letter);
              if (idx !== undefined) {
                onSelectLetter(letter, idx);
              }
            }}
            title={hasBooks ? t("shelfMenu.azRail.jump", { letter }) : undefined}
          >
            {letter}
          </button>
        );
      })}
    </div>
  );
});
