import { useCallback, useEffect, useMemo, useState } from "react";
import { runPageTransition } from "../pageTransition";
import type { ShelfEntry } from "../shelf/types";
import {
  emptyLetterState,
  resolveActiveLetter,
  type ActiveLetterDescriptor,
  type LetterPreviewMode,
  type ReadingLetterState,
} from "./letterSchedule";
import { loadReadingLetterSnapshot, persistReadingLetterState } from "./readingLetterStorage";
import { emptyReadingLog, type ReadingLogData } from "./readingLogStore";
import { useReadingActivityTracker } from "./useReadingActivityTracker";

export interface UseReadingLetterHostOptions {
  view: "shelf" | "reader";
  libraryServices: boolean;
  currentShelfId: string | null;
  shelfEntries: readonly ShelfEntry[];
}

export function useReadingLetterHost({
  view,
  libraryServices,
  currentShelfId,
  shelfEntries,
}: UseReadingLetterHostOptions) {
  const activeReadingEntry = useMemo(
    () => (view === "reader" && currentShelfId ? (shelfEntries.find((e) => e.id === currentShelfId) ?? null) : null),
    [view, currentShelfId, shelfEntries],
  );
  useReadingActivityTracker({ active: view === "reader", libraryServices, entry: activeReadingEntry });

  const [snapshot, setSnapshot] = useState<{
    log: ReadingLogData;
    state: ReadingLetterState;
    previewMode: LetterPreviewMode | null;
  }>(() => ({
    log: emptyReadingLog(),
    state: emptyLetterState(),
    previewMode: null,
  }));
  const [previewOverride, setPreviewOverride] = useState<LetterPreviewMode | null>(null);
  const [activeLetter, setActiveLetter] = useState<ActiveLetterDescriptor | null>(null);

  const reload = useCallback(() => {
    if (!libraryServices) return;
    let cancelled = false;
    void loadReadingLetterSnapshot().then((next) => {
      if (!cancelled) setSnapshot(next);
    });
    return () => { cancelled = true; };
  }, [libraryServices]);

  useEffect(() => {
    if (!libraryServices || view !== "shelf") return;
    return reload();
  }, [libraryServices, view, reload]);

  useEffect(() => {
    if ((!libraryServices || view === "reader") && activeLetter) setActiveLetter(null);
  }, [libraryServices, view, activeLetter]);

  const effectivePreview = previewOverride ?? snapshot.previewMode;
  const pendingLetter = useMemo(() => {
    if (!libraryServices || view !== "shelf") return null;
    return resolveActiveLetter(new Date(), snapshot.state, snapshot.log, shelfEntries, effectivePreview);
  }, [libraryServices, view, snapshot.state, snapshot.log, shelfEntries, effectivePreview]);

  const openLetter = useCallback(() => {
    if (!pendingLetter) return;
    void runPageTransition("forward", () => setActiveLetter(pendingLetter));
  }, [pendingLetter]);

  const closeLetter = useCallback(() => {
    void runPageTransition("back", () => {
      setActiveLetter(null);
      reload();
    });
  }, [reload]);

  const switchPreviewMode = useCallback((mode: LetterPreviewMode) => {
    setPreviewOverride(mode);
    const next = resolveActiveLetter(new Date(), snapshot.state, snapshot.log, shelfEntries, mode);
    if (next) setActiveLetter(next);
  }, [snapshot.state, snapshot.log, shelfEntries]);

  const updateLetterState = useCallback((nextState: ReadingLetterState) => {
    setSnapshot((prev) => ({ ...prev, state: nextState }));
    void persistReadingLetterState(nextState);
  }, []);

  return {
    log: snapshot.log,
    letterState: snapshot.state,
    activeLetter,
    slip: libraryServices && pendingLetter ? { letter: pendingLetter, onOpen: openLetter } : undefined,
    closeLetter,
    switchPreviewMode,
    updateLetterState,
  };
}
