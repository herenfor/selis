import { invoke } from "@tauri-apps/api/core";
import { isTauriEnv } from "../shelf";
import {
  emptyLetterState,
  readLetterPreviewOverride,
  readLetterState,
  writeLetterState,
  type LetterPreviewMode,
  type ReadingLetterState,
} from "./letterSchedule";
import {
  markBookFinishedInLog,
  readReadingLog,
  recordReadingDelta,
  toDateKey,
  toMonthKey,
  writeReadingLog,
  type ReadingLogData,
} from "./readingLogStore";

export interface ReadingLetterSnapshot {
  log: ReadingLogData;
  state: ReadingLetterState;
  previewMode: LetterPreviewMode | null;
}

/**
 * Loads Reading Letter activity + state from native SQLite (`v10`) when running
 * inside Tauri, falling back to browser `localStorage` in Web dev mode.
 */
export async function loadReadingLetterSnapshot(): Promise<ReadingLetterSnapshot> {
  const localPreview = readLetterPreviewOverride();
  if (!isTauriEnv()) {
    return {
      log: readReadingLog(),
      state: readLetterState(),
      previewMode: localPreview,
    };
  }
  try {
    const snap = await invoke<{
      log: ReadingLogData;
      state: ReadingLetterState;
      previewMode?: string | null;
    }>("reading_letter_load");
    const dbPreview = snap.previewMode === "monthly" || snap.previewMode === "annual" || snap.previewMode === "empty"
      ? snap.previewMode
      : null;
    return {
      log: snap.log,
      state: snap.state ?? emptyLetterState(),
      previewMode: localPreview ?? dbPreview,
    };
  } catch {
    return {
      log: readReadingLog(),
      state: readLetterState(),
      previewMode: localPreview,
    };
  }
}

export async function recordReadingActivityDelta(input: {
  bookKey: string;
  title: string;
  creator: string;
  seconds: number;
  sessionSeconds: number;
  now: Date;
}): Promise<void> {
  const nextLog = recordReadingDelta(readReadingLog(), input);
  writeReadingLog(nextLog);
  if (!isTauriEnv()) return;
  try {
    await invoke("reading_letter_record_delta", {
      input: {
        dateKey: toDateKey(input.now),
        monthKey: toMonthKey(input.now.getFullYear(), input.now.getMonth() + 1),
        hourKey: String(input.now.getHours()),
        minuteOfDay: input.now.getHours() * 60 + input.now.getMinutes(),
        dayOfMonth: input.now.getDate(),
        bookKey: input.bookKey,
        title: input.title,
        creator: input.creator,
        seconds: Math.floor(input.seconds),
        sessionSeconds: Math.floor(input.sessionSeconds),
      },
    });
  } catch {
    /* keep local cache without interrupting active reading */
  }
}

export async function markReadingBookFinished(
  bookKey: string,
  title: string,
  creator: string,
  now: Date,
): Promise<void> {
  const current = readReadingLog();
  const updated = markBookFinishedInLog(current, bookKey, title, creator, now);
  if (updated !== current) writeReadingLog(updated);
  if (!isTauriEnv()) return;
  try {
    await invoke("reading_letter_mark_finished", {
      input: {
        bookKey,
        title,
        creator,
        monthKey: toMonthKey(now.getFullYear(), now.getMonth() + 1),
      },
    });
  } catch {
    /* non-fatal */
  }
}

export async function persistReadingLetterState(state: ReadingLetterState): Promise<void> {
  writeLetterState(state);
  if (!isTauriEnv()) return;
  try {
    await invoke("reading_letter_save_state", { state });
  } catch {
    /* non-fatal */
  }
}
