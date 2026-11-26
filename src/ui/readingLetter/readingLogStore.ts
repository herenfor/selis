import type { ShelfEntry } from "../shelf/types";

export const READING_LOG_STORAGE_KEY = "selis:reading-log:v1";
export const MAX_DELTA_SECONDS = 180;
export const MIN_DELTA_SECONDS = 5;
const MAX_LOG_DAYS = 800;

export interface DayReadingRecord {
  books: Record<string, number>;
  hours: Record<string, number>;
  firstMinute?: number;
  lastMinute?: number;
}

export interface BookReadingSnapshot {
  title: string;
  creator: string;
  finishedMonth?: string;
}

export interface LongestSessionRecord {
  day: number;
  bookKey: string;
  seconds: number;
}

export interface ReadingLogData {
  version: 1;
  days: Record<string, DayReadingRecord>;
  bookMeta: Record<string, BookReadingSnapshot>;
  longestByMonth: Record<string, LongestSessionRecord>;
}

export interface LetterExcerpt {
  bookKey: string;
  bookTitle: string;
  quote: string;
  note: string;
  day: number;
  month: number;
}

export interface MonthlyBookSummary {
  bookKey: string;
  title: string;
  creator: string;
  seconds: number;
  days: number;
  progressPct: number;
  finished: boolean;
  entry?: ShelfEntry;
}

export interface MonthlyDaySummary {
  day: number;
  totalSeconds: number;
  books: Array<{ bookKey: string; title: string; seconds: number; entry?: ShelfEntry }>;
  topBookKey: string;
  firstMinute?: number;
  lastMinute?: number;
  notes: LetterExcerpt[];
}

export interface MonthlyLetterModel {
  year: number;
  month: number;
  periodKey: string;
  totalSeconds: number;
  activeDays: number;
  finishedCount: number;
  books: MonthlyBookSummary[];
  days: Record<number, MonthlyDaySummary>;
  rhythm: number[];
  longestSession: LongestSessionRecord | null;
  excerpts: LetterExcerpt[];
}

export interface AnnualMonthSummary {
  month: number;
  seconds: number;
  days: number;
  topBookKey: string | null;
  topBookTitle: string;
  topEntry?: ShelfEntry;
}

export interface AnnualLetterModel {
  year: number;
  periodKey: string;
  totalSeconds: number;
  totalBooks: number;
  activeDays: number;
  finishedCount: number;
  months: AnnualMonthSummary[];
  featuredBooks: Array<{ bookKey: string; title: string; creator: string; days: number; seconds: number; entry?: ShelfEntry }>;
  excerpts: LetterExcerpt[];
}

export function emptyReadingLog(): ReadingLogData {
  return { version: 1, days: {}, bookMeta: {}, longestByMonth: {} };
}

export function bookKeyForEntry(entry: Pick<ShelfEntry, "id" | "contentHash">): string {
  return entry.contentHash && entry.contentHash.trim() ? entry.contentHash : entry.id;
}

export function toDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function toMonthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function pruneOldDays(days: Record<string, DayReadingRecord>): Record<string, DayReadingRecord> {
  const keys = Object.keys(days).sort();
  if (keys.length <= MAX_LOG_DAYS) return days;
  const keep = keys.slice(keys.length - MAX_LOG_DAYS);
  const next: Record<string, DayReadingRecord> = {};
  for (const k of keep) next[k] = days[k];
  return next;
}

/** Records a small verified reading-time increment into a pure ReadingLogData snapshot. */
export function recordReadingDelta(
  log: ReadingLogData,
  input: { bookKey: string; title: string; creator: string; seconds: number; sessionSeconds?: number; now: Date },
): ReadingLogData {
  const sec = Math.min(MAX_DELTA_SECONDS, Math.floor(input.seconds));
  if (!input.bookKey || !Number.isFinite(sec) || sec < MIN_DELTA_SECONDS) return log;

  const dk = toDateKey(input.now);
  const mk = toMonthKey(input.now.getFullYear(), input.now.getMonth() + 1);
  const hourKey = String(input.now.getHours());
  const minuteOfDay = input.now.getHours() * 60 + input.now.getMinutes();

  const prevDay = log.days[dk] ?? { books: {}, hours: {} };
  const nextDay: DayReadingRecord = {
    books: { ...prevDay.books, [input.bookKey]: (prevDay.books[input.bookKey] ?? 0) + sec },
    hours: { ...prevDay.hours, [hourKey]: (prevDay.hours[hourKey] ?? 0) + sec },
    firstMinute: prevDay.firstMinute == null ? minuteOfDay : Math.min(prevDay.firstMinute, minuteOfDay),
    lastMinute: prevDay.lastMinute == null ? minuteOfDay : Math.max(prevDay.lastMinute, minuteOfDay),
  };

  const prevMeta = log.bookMeta[input.bookKey];
  const nextMeta: BookReadingSnapshot = {
    title: input.title || prevMeta?.title || "",
    creator: input.creator || prevMeta?.creator || "",
    ...(prevMeta?.finishedMonth ? { finishedMonth: prevMeta.finishedMonth } : {}),
  };

  const candidateSession = Math.max(sec, Math.floor(input.sessionSeconds ?? sec));
  const prevLongest = log.longestByMonth[mk];
  const nextLongest = !prevLongest || candidateSession > prevLongest.seconds
    ? { day: input.now.getDate(), bookKey: input.bookKey, seconds: candidateSession }
    : prevLongest;

  return {
    version: 1,
    days: pruneOldDays({ ...log.days, [dk]: nextDay }),
    bookMeta: { ...log.bookMeta, [input.bookKey]: nextMeta },
    longestByMonth: { ...log.longestByMonth, [mk]: nextLongest },
  };
}

/** Marks a book as finished during the month of `now` if not already recorded. */
export function markBookFinishedInLog(
  log: ReadingLogData,
  bookKey: string,
  title: string,
  creator: string,
  now: Date,
): ReadingLogData {
  if (!bookKey) return log;
  const prev = log.bookMeta[bookKey];
  const mk = toMonthKey(now.getFullYear(), now.getMonth() + 1);
  if (prev?.finishedMonth) return log;
  return {
    ...log,
    bookMeta: {
      ...log.bookMeta,
      [bookKey]: {
        title: title || prev?.title || "",
        creator: creator || prev?.creator || "",
        finishedMonth: mk,
      },
    },
  };
}

function buildEntryIndex(entries: readonly ShelfEntry[]): Map<string, ShelfEntry> {
  const map = new Map<string, ShelfEntry>();
  for (const e of entries) {
    map.set(bookKeyForEntry(e), e);
    if (!map.has(e.id)) map.set(e.id, e);
  }
  return map;
}

function collectExcerpts(
  entries: readonly ShelfEntry[],
  year: number,
  month?: number,
): LetterExcerpt[] {
  const list: Array<LetterExcerpt & { ts: number }> = [];
  for (const entry of entries) {
    const key = bookKeyForEntry(entry);
    for (const note of entry.notes ?? []) {
      const text = (note.selectedText || "").trim();
      if (!text) continue;
      const d = new Date(note.createdAtMs);
      if (d.getFullYear() !== year) continue;
      const m = d.getMonth() + 1;
      if (month !== undefined && m !== month) continue;
      list.push({
        bookKey: key,
        bookTitle: entry.title,
        quote: text,
        note: (note.content || "").trim(),
        day: d.getDate(),
        month: m,
        ts: note.createdAtMs,
      });
    }
  }
  list.sort((a, b) => b.ts - a.ts);
  return list.slice(0, 12).map(({ ts: _ts, ...rest }) => rest);
}

/** Aggregates local reading activity and notes into a monthly letter model. */
export function buildMonthlyLetterData(
  log: ReadingLogData,
  entries: readonly ShelfEntry[],
  year: number,
  month: number,
  excludedBookKeys?: ReadonlySet<string>,
): MonthlyLetterModel {
  const mk = toMonthKey(year, month);
  const prefix = `${mk}-`;
  const entryMap = buildEntryIndex(entries);
  const allExcerpts = collectExcerpts(entries, year, month);
  const excerpts = excludedBookKeys
    ? allExcerpts.filter((x) => !excludedBookKeys.has(x.bookKey))
    : allExcerpts;

  const bookAgg = new Map<string, { seconds: number; days: Set<number> }>();
  const rhythm = new Array<number>(24).fill(0);
  const days: Record<number, MonthlyDaySummary> = {};
  let totalSeconds = 0;

  for (const [dateKey, rec] of Object.entries(log.days)) {
    if (!dateKey.startsWith(prefix)) continue;
    const dayNum = Number(dateKey.slice(prefix.length));
    if (!Number.isInteger(dayNum) || dayNum < 1 || dayNum > 31) continue;

    const dayBooks: MonthlyDaySummary["books"] = [];
    let daySum = 0;
    for (const [bk, sec] of Object.entries(rec.books)) {
      if (excludedBookKeys?.has(bk) || sec <= 0) continue;
      const e = entryMap.get(bk);
      const title = e?.title || log.bookMeta[bk]?.title || bk;
      dayBooks.push({ bookKey: bk, title, seconds: sec, entry: e });
      daySum += sec;
      totalSeconds += sec;
      const cur = bookAgg.get(bk) ?? { seconds: 0, days: new Set<number>() };
      cur.seconds += sec;
      cur.days.add(dayNum);
      bookAgg.set(bk, cur);
    }
    if (daySum <= 0) continue;

    dayBooks.sort((a, b) => b.seconds - a.seconds);
    for (const [hrStr, sec] of Object.entries(rec.hours)) {
      const hr = Number(hrStr);
      if (hr >= 0 && hr < 24 && sec > 0) rhythm[hr] += sec;
    }
    days[dayNum] = {
      day: dayNum,
      totalSeconds: daySum,
      books: dayBooks,
      topBookKey: dayBooks[0].bookKey,
      firstMinute: rec.firstMinute,
      lastMinute: rec.lastMinute,
      notes: excerpts.filter((x) => x.day === dayNum),
    };
  }

  const books: MonthlyBookSummary[] = [...bookAgg.entries()].map(([bk, agg]) => {
    const e = entryMap.get(bk);
    const snap = log.bookMeta[bk];
    const finished = snap?.finishedMonth === mk || (e?.progressPct ?? 0) >= 99;
    return {
      bookKey: bk,
      title: e?.title || snap?.title || bk,
      creator: e?.creator || snap?.creator || "",
      seconds: agg.seconds,
      days: agg.days.size,
      progressPct: Math.min(100, Math.max(0, Math.round(e?.progressPct ?? (finished ? 100 : 0)))),
      finished,
      entry: e,
    };
  }).sort((a, b) => b.seconds - a.seconds || b.days - a.days);

  const longest = log.longestByMonth[mk];
  const longestValid = longest && !excludedBookKeys?.has(longest.bookKey) ? longest : null;

  return {
    year,
    month,
    periodKey: mk,
    totalSeconds,
    activeDays: Object.keys(days).length,
    finishedCount: books.filter((b) => b.finished).length,
    books,
    days,
    rhythm,
    longestSession: longestValid,
    excerpts,
  };
}

/** Aggregates a full calendar year of reading logs and highlights into an annual letter model. */
export function buildAnnualLetterData(
  log: ReadingLogData,
  entries: readonly ShelfEntry[],
  year: number,
): AnnualLetterModel {
  const entryMap = buildEntryIndex(entries);
  const yearPrefix = `${year}-`;
  const months: AnnualMonthSummary[] = [];
  const bookTotals = new Map<string, { seconds: number; days: Set<string> }>();
  const activeDateKeys = new Set<string>();
  let totalSeconds = 0;

  for (let m = 1; m <= 12; m++) {
    const mp = `${toMonthKey(year, m)}-`;
    let mSec = 0;
    const mDays = new Set<string>();
    const mBooks = new Map<string, number>();

    for (const [dk, rec] of Object.entries(log.days)) {
      if (!dk.startsWith(mp)) continue;
      let hasDay = false;
      for (const [bk, sec] of Object.entries(rec.books)) {
        if (sec <= 0) continue;
        hasDay = true;
        mSec += sec;
        totalSeconds += sec;
        mBooks.set(bk, (mBooks.get(bk) ?? 0) + sec);
        const bt = bookTotals.get(bk) ?? { seconds: 0, days: new Set<string>() };
        bt.seconds += sec;
        bt.days.add(dk);
        bookTotals.set(bk, bt);
      }
      if (hasDay) {
        mDays.add(dk);
        activeDateKeys.add(dk);
      }
    }

    const topPair = [...mBooks.entries()].sort((a, b) => b[1] - a[1])[0];
    const topKey = topPair?.[0] ?? null;
    const topEntry = topKey ? entryMap.get(topKey) : undefined;
    const topTitle = topKey ? (topEntry?.title || log.bookMeta[topKey]?.title || topKey) : "";
    months.push({ month: m, seconds: mSec, days: mDays.size, topBookKey: topKey, topBookTitle: topTitle, topEntry });
  }

  const featuredBooks = [...bookTotals.entries()].map(([bk, agg]) => {
    const e = entryMap.get(bk);
    const snap = log.bookMeta[bk];
    return {
      bookKey: bk,
      title: e?.title || snap?.title || bk,
      creator: e?.creator || snap?.creator || "",
      days: agg.days.size,
      seconds: agg.seconds,
      entry: e,
    };
  }).sort((a, b) => b.seconds - a.seconds || b.days - a.days).slice(0, 6);

  let finishedCount = 0;
  for (const bk of bookTotals.keys()) {
    const e = entryMap.get(bk);
    const fm = log.bookMeta[bk]?.finishedMonth;
    if ((fm && fm.startsWith(yearPrefix)) || (e?.progressPct ?? 0) >= 99) finishedCount++;
  }

  return {
    year,
    periodKey: String(year),
    totalSeconds,
    totalBooks: bookTotals.size,
    activeDays: activeDateKeys.size,
    finishedCount,
    months,
    featuredBooks,
    excerpts: collectExcerpts(entries, year),
  };
}

export function readReadingLog(storage: Pick<Storage, "getItem"> = localStorage): ReadingLogData {
  try {
    const raw = storage.getItem(READING_LOG_STORAGE_KEY);
    if (!raw) return emptyReadingLog();
    const parsed = JSON.parse(raw) as Partial<ReadingLogData>;
    if (parsed.version !== 1 || typeof parsed.days !== "object" || !parsed.days) return emptyReadingLog();
    return {
      version: 1,
      days: parsed.days,
      bookMeta: parsed.bookMeta ?? {},
      longestByMonth: parsed.longestByMonth ?? {},
    };
  } catch {
    return emptyReadingLog();
  }
}

export function writeReadingLog(log: ReadingLogData, storage: Pick<Storage, "setItem"> = localStorage): void {
  try {
    storage.setItem(READING_LOG_STORAGE_KEY, JSON.stringify(log));
  } catch {
    /* ignore storage quota failures */
  }
}
