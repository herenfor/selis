import type { Translate } from "../localization/UiLanguageProvider";
import { bookClothToneForKey, type LoadedLetterCover } from "./letterCovers";

export function formatReadingDuration(seconds: number, t: Translate): string {
  const mins = Math.max(1, Math.round(seconds / 60));
  if (mins < 60) return t("readingLetter.common.durationMinutes", { minutes: mins });
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem > 0
    ? t("readingLetter.common.durationHoursMinutes", { hours, minutes: rem })
    : t("readingLetter.common.durationHours", { hours });
}

export function LetterBookCover({
  bookKey,
  title,
  covers,
  mini = false,
}: {
  bookKey: string;
  title: string;
  covers: ReadonlyMap<string, LoadedLetterCover>;
  mini?: boolean;
}) {
  const loaded = covers.get(bookKey);
  const tone = bookClothToneForKey(bookKey);
  return (
    <span className="rl-cover" style={{ backgroundColor: tone.bg, color: tone.fg }} aria-hidden="true">
      {loaded ? <img src={loaded.url} alt="" /> : !mini ? <span className="rl-cover-title">{title}</span> : null}
    </span>
  );
}
