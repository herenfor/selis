import { useEffect, useRef } from "react";
import type { ShelfEntry } from "../shelf/types";
import {
  bookKeyForEntry,
  markBookFinishedInLog,
  MAX_DELTA_SECONDS,
  MIN_DELTA_SECONDS,
  readReadingLog,
  recordReadingDelta,
  writeReadingLog,
} from "./readingLogStore";

const FLUSH_INTERVAL_MS = 30_000;
const IDLE_CUTOFF_MS = MAX_DELTA_SECONDS * 1000;

export interface ReadingActivityTrackerOptions {
  active: boolean;
  libraryServices: boolean;
  entry: ShelfEntry | null;
}

/**
 * Passively tracks local active reading time while the user reads a book in
 * the normal library. Disabled completely when `libraryServices` is false
 * (e.g. inside the private shelf) or when no book is open.
 */
export function useReadingActivityTracker({ active, libraryServices, entry }: ReadingActivityTrackerOptions): void {
  const sessionRef = useRef<{
    bookKey: string;
    title: string;
    creator: string;
    lastFlushMs: number;
    lastActivityMs: number;
    sessionSeconds: number;
  } | null>(null);

  const entryKey = entry ? bookKeyForEntry(entry) : "";
  const entryTitle = entry?.title ?? "";
  const entryCreator = entry?.creator ?? "";
  const entryProgress = entry?.progressPct ?? 0;

  useEffect(() => {
    if (!active || !libraryServices || !entryKey) {
      sessionRef.current = null;
      return;
    }

    const nowMs = Date.now();
    const session = {
      bookKey: entryKey,
      title: entryTitle,
      creator: entryCreator,
      lastFlushMs: nowMs,
      lastActivityMs: nowMs,
      sessionSeconds: 0,
    };
    sessionRef.current = session;

    const flush = (flushMs: number) => {
      if (document.visibilityState === "hidden" && flushMs - session.lastFlushMs < 1000) return;
      const idleElapsed = flushMs - session.lastActivityMs;
      const rawSec = Math.floor((flushMs - session.lastFlushMs) / 1000);
      const effectiveSec = idleElapsed > IDLE_CUTOFF_MS
        ? Math.max(0, Math.floor((session.lastActivityMs + IDLE_CUTOFF_MS - session.lastFlushMs) / 1000))
        : rawSec;
      session.lastFlushMs = flushMs;
      const clamped = Math.min(MAX_DELTA_SECONDS, effectiveSec);
      if (clamped < MIN_DELTA_SECONDS) return;

      session.sessionSeconds += clamped;
      const nextLog = recordReadingDelta(readReadingLog(), {
        bookKey: session.bookKey,
        title: session.title,
        creator: session.creator,
        seconds: clamped,
        sessionSeconds: session.sessionSeconds,
        now: new Date(flushMs),
      });
      writeReadingLog(nextLog);
    };

    const bumpActivity = () => {
      session.lastActivityMs = Date.now();
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush(Date.now());
      else session.lastFlushMs = session.lastActivityMs = Date.now();
    };
    const onPageHide = () => flush(Date.now());

    window.addEventListener("pointerdown", bumpActivity, { passive: true });
    window.addEventListener("keydown", bumpActivity, { passive: true });
    window.addEventListener("wheel", bumpActivity, { passive: true });
    window.addEventListener("touchstart", bumpActivity, { passive: true });
    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("visibilitychange", onVisibility);

    const timer = window.setInterval(() => {
      if (document.visibilityState !== "hidden") flush(Date.now());
    }, FLUSH_INTERVAL_MS);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("pointerdown", bumpActivity);
      window.removeEventListener("keydown", bumpActivity);
      window.removeEventListener("wheel", bumpActivity);
      window.removeEventListener("touchstart", bumpActivity);
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onVisibility);
      flush(Date.now());
      if (sessionRef.current === session) sessionRef.current = null;
    };
  }, [active, libraryServices, entryKey, entryTitle, entryCreator]);

  useEffect(() => {
    if (!active || !libraryServices || !entryKey) return;
    if (sessionRef.current?.bookKey === entryKey) {
      sessionRef.current.lastActivityMs = Date.now();
    }
    if (entryProgress >= 99) {
      const current = readReadingLog();
      const updated = markBookFinishedInLog(current, entryKey, entryTitle, entryCreator, new Date());
      if (updated !== current) writeReadingLog(updated);
    }
  }, [active, libraryServices, entryKey, entryTitle, entryCreator, entryProgress, entry?.spineIndex, entry?.page]);
}
