import { useState } from "react";
import { useUiText } from "../localization/UiLanguageProvider";
import { bookClothToneForKey, type LoadedLetterCover } from "./letterCovers";
import { formatReadingDuration, LetterBookCover } from "./letterFormat";
import type { LetterExcerpt, MonthlyLetterModel } from "./readingLogStore";

export interface ReadingLetterMonthlyBodyProps {
  /** Unfiltered month data (so excluded books can still be restored from the ledger). */
  allBooksModel: MonthlyLetterModel;
  /** Filtered month data reflecting hiddenBookKeys. */
  visibleModel: MonthlyLetterModel;
  covers: ReadonlyMap<string, LoadedLetterCover>;
  hiddenBookKeys: ReadonlySet<string>;
  onToggleBookHidden(bookKey: string): void;
  hideDuration: boolean;
  onToggleHideDuration(): void;
  includeRhythm: boolean;
  onToggleIncludeRhythm(): void;
  includeExcerpt: boolean;
  onToggleIncludeExcerpt(): void;
  onPreviewKeepsake(excerpt: LetterExcerpt | null, prose: string): void;
}

export function ReadingLetterMonthlyBody({
  allBooksModel,
  visibleModel,
  covers,
  hiddenBookKeys,
  onToggleBookHidden,
  hideDuration,
  onToggleHideDuration,
  includeRhythm,
  onToggleIncludeRhythm,
  includeExcerpt,
  onToggleIncludeExcerpt,
  onPreviewKeepsake,
}: ReadingLetterMonthlyBodyProps) {
  const { t } = useUiText();
  const activeDayKeys = Object.keys(visibleModel.days).map(Number).sort((a, b) => a - b);
  const [selectedDay, setSelectedDay] = useState<number>(() => activeDayKeys[0] ?? 1);
  const [selectedBook, setSelectedBook] = useState<string>(() => visibleModel.books[0]?.bookKey ?? "");
  const [excerptIdx, setExcerptIdx] = useState(0);

  const effectiveDay = visibleModel.days[selectedDay] ? selectedDay : (activeDayKeys[0] ?? 0);
  const dayRec = effectiveDay ? visibleModel.days[effectiveDay] : undefined;
  const activeExcerpt = visibleModel.excerpts[excerptIdx % Math.max(1, visibleModel.excerpts.length)] ?? null;

  const prose = visibleModel.books.length === 0
    ? t("readingLetter.monthly.proseExcluded")
    : hideDuration
      ? t("readingLetter.monthly.proseHiddenDuration", {
          days: visibleModel.activeDays,
          books: visibleModel.books.slice(0, 3).map((b) => `《${b.title}》`).join("、"),
          topBook: visibleModel.books[0].title,
        })
      : t("readingLetter.monthly.proseFull", {
          duration: formatReadingDuration(visibleModel.totalSeconds, t),
          days: visibleModel.activeDays,
          topBook: visibleModel.books[0].title,
        });

  const ledger: Array<[string, string]> = hideDuration
    ? [
        [t("readingLetter.monthly.ledgerBooks"), t("readingLetter.common.booksCount", { count: visibleModel.books.length })],
        [t("readingLetter.monthly.ledgerDays"), t("readingLetter.common.daysCount", { days: visibleModel.activeDays })],
        [t("readingLetter.monthly.ledgerExcerpts"), t("readingLetter.common.excerptsCount", { count: visibleModel.excerpts.length })],
      ]
    : [
        [t("readingLetter.monthly.ledgerDuration"), formatReadingDuration(visibleModel.totalSeconds, t)],
        [t("readingLetter.monthly.ledgerBooks"), t("readingLetter.common.booksCount", { count: visibleModel.books.length })],
        [t("readingLetter.monthly.ledgerDays"), t("readingLetter.common.daysCount", { days: visibleModel.activeDays })],
        [t("readingLetter.monthly.ledgerExcerpts"), t("readingLetter.common.excerptsCount", { count: visibleModel.excerpts.length })],
      ];

  const firstDow = (new Date(visibleModel.year, visibleModel.month - 1, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(visibleModel.year, visibleModel.month, 0).getDate();
  const weekdays = t("readingLetter.monthly.weekdays").split(",");
  const rhythmLabels = t("readingLetter.monthly.rhythmLabels").split(",");
  const rhythmPeak = Math.max(1, ...visibleModel.rhythm);
  const longestBookTitle = visibleModel.longestSession
    ? (visibleModel.books.find((b) => b.bookKey === visibleModel.longestSession?.bookKey)?.title ?? "")
    : "";

  const topMosaicBooks = visibleModel.books.slice(0, 4);
  const totalMosaicSeconds = topMosaicBooks.reduce((a, b) => a + b.seconds, 0) || 1;
  const restMosaicSeconds = topMosaicBooks.slice(1).reduce((a, b) => a + b.seconds, 0) || 1;

  return (
    <>
      <h1 className="rl-title">{t("readingLetter.common.yearMonthHeading", { year: visibleModel.year, month: visibleModel.month })}</h1>
      <p className="rl-sub">{t("readingLetter.monthly.sub", { year: visibleModel.year, month: visibleModel.month })}</p>
      <p className="rl-prose">{prose}</p>

      <div className="rl-ledger">
        {ledger.map(([label, value]) => (
          <div className="rl-ledger-cell" key={label}>
            <small>{label}</small>
            <strong>{value}</strong>
          </div>
        ))}
      </div>

      <div className="rl-fold">{t("readingLetter.monthly.calHeading")}</div>
      <p className="rl-intro">{t("readingLetter.monthly.calIntro")}</p>
      <div className="rl-cal">
        {weekdays.map((w, idx) => <span className="rl-weekday" key={`${w}-${idx}`}>{w}</span>)}
        {Array.from({ length: firstDow }, (_, idx) => <span key={`pad-${idx}`} />)}
        {Array.from({ length: daysInMonth }, (_, idx) => {
          const d = idx + 1;
          const rec = visibleModel.days[d];
          if (!rec) {
            return <span className="rl-day" key={d}><span className="rl-day-num">{d}</span></span>;
          }
          const topB = rec.books[0];
          return (
            <button
              key={d}
              type="button"
              className="rl-day active"
              aria-pressed={effectiveDay === d}
              aria-label={`${visibleModel.month}/${d} ${topB.title}`}
              onClick={() => setSelectedDay(d)}
            >
              <span className="rl-day-num">{d}</span>
              <span className="rl-mini-wrap">
                <LetterBookCover bookKey={topB.bookKey} title={topB.title} covers={covers} mini />
              </span>
              {rec.notes.length > 0 && <i className="rl-note-dot" />}
            </button>
          );
        })}
      </div>

      <div className="rl-slip" aria-live="polite">
        {dayRec ? (
          <>
            <div className="rl-slip-head">
              <strong>
                {hideDuration
                  ? t("readingLetter.monthly.dayHeaderNoDuration", { month: visibleModel.month, day: dayRec.day })
                  : t("readingLetter.monthly.dayHeaderWithDuration", {
                      month: visibleModel.month,
                      day: dayRec.day,
                      duration: formatReadingDuration(dayRec.totalSeconds, t),
                    })}
              </strong>
              {dayRec.firstMinute != null && dayRec.lastMinute != null && (
                <span>
                  {`${String(Math.floor(dayRec.firstMinute / 60)).padStart(2, "0")}:${String(dayRec.firstMinute % 60).padStart(2, "0")} – ${String(Math.floor(dayRec.lastMinute / 60)).padStart(2, "0")}:${String(dayRec.lastMinute % 60).padStart(2, "0")}`}
                </span>
              )}
            </div>
            <div>
              {dayRec.books
                .map((b) => `《${b.title}》${hideDuration ? "" : ` ${formatReadingDuration(b.seconds, t)}`}`)
                .join("　/　")}
            </div>
            {dayRec.notes[0] && (
              <p className="rl-slip-note">
                {t("readingLetter.monthly.dayNote", { note: dayRec.notes[0].note || dayRec.notes[0].quote })}
              </p>
            )}
          </>
        ) : (
          <span>{t("readingLetter.monthly.dayEmpty")}</span>
        )}
      </div>

      <div className="rl-fold">{t("readingLetter.monthly.booksHeading")}</div>
      <p className="rl-intro">{t("readingLetter.monthly.booksIntro")}</p>
      {topMosaicBooks.length > 0 && (
        <div className="rl-mosaic">
          <button
            type="button"
            className="rl-tile"
            style={{
              flexGrow: topMosaicBooks[0].seconds || 1,
              backgroundColor: bookClothToneForKey(topMosaicBooks[0].bookKey).mat,
            }}
            aria-pressed={selectedBook === topMosaicBooks[0].bookKey}
            aria-label={topMosaicBooks[0].title}
            onClick={() => setSelectedBook(topMosaicBooks[0].bookKey)}
          >
            <LetterBookCover bookKey={topMosaicBooks[0].bookKey} title={topMosaicBooks[0].title} covers={covers} />
          </button>
          {topMosaicBooks.length > 1 && (
            <div className="rl-mosaic-group" style={{ flexDirection: "column", flexGrow: Math.max(1, totalMosaicSeconds - topMosaicBooks[0].seconds) }}>
              {topMosaicBooks.slice(1).map((b) => (
                <button
                  key={b.bookKey}
                  type="button"
                  className="rl-tile"
                  style={{
                    flexGrow: Math.max(1, Math.round((b.seconds / restMosaicSeconds) * 100)),
                    backgroundColor: bookClothToneForKey(b.bookKey).mat,
                  }}
                  aria-pressed={selectedBook === b.bookKey}
                  aria-label={b.title}
                  onClick={() => setSelectedBook(b.bookKey)}
                >
                  <LetterBookCover bookKey={b.bookKey} title={b.title} covers={covers} />
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="rl-book-ledger">
        {allBooksModel.books.map((book) => {
          const excluded = hiddenBookKeys.has(book.bookKey);
          return (
            <div
              key={book.bookKey}
              className={`rl-book-row${selectedBook === book.bookKey && !excluded ? " active" : ""}${excluded ? " excluded" : ""}`}
            >
              <div style={{ width: "34px" }}>
                <LetterBookCover bookKey={book.bookKey} title={book.title} covers={covers} mini />
              </div>
              <div className="rl-book-meta">
                <strong onClick={() => !excluded && setSelectedBook(book.bookKey)}>
                  {book.title}
                  {book.finished && <span className="rl-seal-tag">{t("readingLetter.monthly.bookFinished")}</span>}
                </strong>
                <span>
                  {excluded
                    ? `${book.creator ? `${book.creator} · ` : ""}${t("readingLetter.monthly.bookExcludedMeta")}`
                    : [
                        book.creator,
                        t("readingLetter.monthly.bookDays", { days: book.days }),
                        hideDuration ? "" : formatReadingDuration(book.seconds, t),
                        t("readingLetter.monthly.bookProgress", { pct: book.progressPct }),
                      ].filter(Boolean).join(" · ")}
                </span>
                <div className="rl-progress"><i style={{ width: `${book.progressPct}%` }} /></div>
              </div>
              <button
                type="button"
                className="rl-chip"
                aria-pressed={excluded}
                onClick={() => onToggleBookHidden(book.bookKey)}
              >
                {excluded ? t("readingLetter.monthly.bookRestore") : t("readingLetter.monthly.bookHide")}
              </button>
            </div>
          );
        })}
      </div>

      <div className="rl-fold">{t("readingLetter.monthly.rhythmHeading")}</div>
      <div className={`rl-rhythm${includeRhythm ? "" : " dimmed"}`}>
        <div className="rl-rhythm-bars" aria-hidden="true">
          {visibleModel.rhythm.map((sec, hr) => {
            const pct = sec > 0 ? Math.max(8, Math.round((sec / rhythmPeak) * 100)) : 4;
            return (
              <i
                key={hr}
                style={{
                  height: `${Math.round(pct * 0.42)}px`,
                  opacity: sec > 0 ? 0.28 + (sec / rhythmPeak) * 0.62 : 0.12,
                }}
              />
            );
          })}
        </div>
        <div className="rl-rhythm-labels">
          {rhythmLabels.map((lbl, idx) => <span key={`${lbl}-${idx}`}>{lbl}</span>)}
        </div>
        <p className="rl-rhythm-text">
          {!hideDuration && visibleModel.longestSession && longestBookTitle
            ? t("readingLetter.monthly.rhythmSummary", {
                day: visibleModel.longestSession.day,
                book: longestBookTitle,
                duration: formatReadingDuration(visibleModel.longestSession.seconds, t),
              })
            : t("readingLetter.monthly.rhythmSummaryNoDuration")}
        </p>
      </div>

      {activeExcerpt && (
        <div className={`rl-excerpt${includeExcerpt ? "" : " dimmed"}`}>
          <blockquote>“{activeExcerpt.quote}”</blockquote>
          {activeExcerpt.note && <p className="rl-excerpt-note">{t("readingLetter.monthly.dayNote", { note: activeExcerpt.note })}</p>}
          <div className="rl-excerpt-foot">
            <span>《{activeExcerpt.bookTitle}》</span>
            {visibleModel.excerpts.length > 1 && (
              <button className="rl-btn" type="button" onClick={() => setExcerptIdx((i) => (i + 1) % visibleModel.excerpts.length)}>
                {t("readingLetter.monthly.excerptCycle")}
              </button>
            )}
          </div>
        </div>
      )}

      <footer className="rl-colophon">
        <p className="rl-prose">{t("readingLetter.monthly.colophon", { month: visibleModel.month })}</p>
        <div className="rl-keepsake-bar">
          <div className="rl-toggle-row">
            <button className="rl-chip" type="button" aria-pressed={hideDuration} onClick={onToggleHideDuration}>
              {t("readingLetter.privacy.hideDuration")}
            </button>
            <button className="rl-chip" type="button" aria-pressed={includeRhythm} onClick={onToggleIncludeRhythm}>
              {t("readingLetter.privacy.includeRhythm")}
            </button>
            <button className="rl-chip" type="button" aria-pressed={includeExcerpt} onClick={onToggleIncludeExcerpt}>
              {t("readingLetter.privacy.includeExcerpt")}
            </button>
          </div>
          <button className="rl-btn primary" type="button" onClick={() => onPreviewKeepsake(activeExcerpt, prose)}>
            {t("readingLetter.keepsake.previewBtn")}
          </button>
        </div>
      </footer>
    </>
  );
}
