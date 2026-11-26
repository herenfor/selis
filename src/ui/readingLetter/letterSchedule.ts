import type { ShelfEntry } from "../shelf/types";
import { toDateKey, toMonthKey, type ReadingLogData } from "./readingLogStore";

export const LETTER_STATE_STORAGE_KEY = "selis:reading-letter-state:v1";
export const LETTER_PREVIEW_STORAGE_KEY = "selis:reading-letter-preview";

export type LetterKind = "monthly" | "annual";
export type LetterPreviewMode = "monthly" | "annual" | "empty";

export interface AnnualChoice {
  bookKey: string;
  epigraph: string;
}

export interface ReadingLetterState {
  version: 1;
  /** Maps periodKey ("YYYY-MM" or "YYYY") -> first opened date ("YYYY-MM-DD"). Option B folds the next day. */
  openedOnDayByPeriod: Record<string, string>;
  /** Reader-chosen Book of the Year and personal epigraph keyed by year string. */
  annualChoices: Record<string, AnnualChoice>;
  /** Preferred paper tone while reading letters. */
  paperTone?: "paper" | "sepia" | "night";
}

export interface ActiveLetterDescriptor {
  kind: LetterKind;
  year: number;
  /** 1..12 for monthly letters; undefined for annual letters. */
  month?: number;
  periodKey: string;
  deliveryDate: Date;
  graceEndDate: Date;
  alreadyOpenedToday: boolean;
  isPreview: boolean;
}

export function emptyLetterState(): ReadingLetterState {
  return { version: 1, openedOnDayByPeriod: {}, annualChoices: {} };
}

function prevMonthOf(year: number, month: number): { year: number; month: number } {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

/**
 * Option B (温和珍稀 · 信箱静置) schedule resolver:
 * - Annual letter arrives Jan 1–7 for the preceding year.
 * - Monthly letter arrives days 1–3 of months Feb–Dec for the preceding month.
 * - Once opened, stays available for the remainder of that local day and folds away on any subsequent day.
 * - Never triggers on a brand-new empty library unless previewOverride is explicitly requested.
 */
export function resolveActiveLetter(
  now: Date,
  state: ReadingLetterState,
  log: ReadingLogData,
  entries: readonly ShelfEntry[],
  previewOverride?: LetterPreviewMode | null,
): ActiveLetterDescriptor | null {
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  const todayKey = toDateKey(now);

  if (previewOverride) {
    const prev = prevMonthOf(year, month);
    if (previewOverride === "annual") {
      return {
        kind: "annual",
        year: year - 1,
        periodKey: String(year - 1),
        deliveryDate: new Date(year, 0, 1),
        graceEndDate: new Date(year, 0, 7),
        alreadyOpenedToday: false,
        isPreview: true,
      };
    }
    return {
      kind: "monthly",
      year: prev.year,
      month: prev.month,
      periodKey: previewOverride === "empty" ? `empty-${toMonthKey(prev.year, prev.month)}` : toMonthKey(prev.year, prev.month),
      deliveryDate: new Date(year, month - 1, 1),
      graceEndDate: new Date(year, month - 1, 3),
      alreadyOpenedToday: false,
      isPreview: true,
    };
  }

  const hasLibraryHistory = entries.length > 0 || Object.keys(log.days).length > 0;
  if (!hasLibraryHistory) return null;

  if (month === 1 && day <= 7) {
    const targetYear = year - 1;
    const periodKey = String(targetYear);
    const openedDay = state.openedOnDayByPeriod[periodKey];
    if (openedDay && todayKey > openedDay) return null;
    return {
      kind: "annual",
      year: targetYear,
      periodKey,
      deliveryDate: new Date(year, 0, 1),
      graceEndDate: new Date(year, 0, 7),
      alreadyOpenedToday: openedDay === todayKey,
      isPreview: false,
    };
  }

  if (month >= 2 && day <= 3) {
    const prev = prevMonthOf(year, month);
    const periodKey = toMonthKey(prev.year, prev.month);
    const openedDay = state.openedOnDayByPeriod[periodKey];
    if (openedDay && todayKey > openedDay) return null;
    return {
      kind: "monthly",
      year: prev.year,
      month: prev.month,
      periodKey,
      deliveryDate: new Date(year, month - 1, 1),
      graceEndDate: new Date(year, month - 1, 3),
      alreadyOpenedToday: openedDay === todayKey,
      isPreview: false,
    };
  }

  return null;
}

export function markLetterOpened(state: ReadingLetterState, periodKey: string, now: Date): ReadingLetterState {
  if (state.openedOnDayByPeriod[periodKey]) return state;
  return {
    ...state,
    openedOnDayByPeriod: { ...state.openedOnDayByPeriod, [periodKey]: toDateKey(now) },
  };
}

export function saveAnnualChoice(
  state: ReadingLetterState,
  year: number,
  choice: AnnualChoice,
): ReadingLetterState {
  return {
    ...state,
    annualChoices: { ...state.annualChoices, [String(year)]: choice },
  };
}

export function readLetterState(storage: Pick<Storage, "getItem"> = localStorage): ReadingLetterState {
  try {
    const raw = storage.getItem(LETTER_STATE_STORAGE_KEY);
    if (!raw) return emptyLetterState();
    const parsed = JSON.parse(raw) as Partial<ReadingLetterState>;
    if (parsed.version !== 1) return emptyLetterState();
    return {
      version: 1,
      openedOnDayByPeriod: parsed.openedOnDayByPeriod ?? {},
      annualChoices: parsed.annualChoices ?? {},
      paperTone: parsed.paperTone,
    };
  } catch {
    return emptyLetterState();
  }
}

export function writeLetterState(state: ReadingLetterState, storage: Pick<Storage, "setItem"> = localStorage): void {
  try {
    storage.setItem(LETTER_STATE_STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore storage quota failures */
  }
}

export function readLetterPreviewOverride(): LetterPreviewMode | null {
  try {
    const param = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("letterPreview") : null;
    const raw = param || (typeof localStorage !== "undefined" ? localStorage.getItem(LETTER_PREVIEW_STORAGE_KEY) : null);
    if (raw === "monthly" || raw === "annual" || raw === "empty") return raw;
    return null;
  } catch {
    return null;
  }
}
