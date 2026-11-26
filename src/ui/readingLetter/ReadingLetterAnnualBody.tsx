import { useState } from "react";
import { useUiText } from "../localization/UiLanguageProvider";
import type { LoadedLetterCover } from "./letterCovers";
import { formatReadingDuration, LetterBookCover } from "./letterFormat";
import type { AnnualLetterModel, LetterExcerpt } from "./readingLogStore";

export interface ReadingLetterAnnualBodyProps {
  model: AnnualLetterModel;
  covers: ReadonlyMap<string, LoadedLetterCover>;
  hideDuration: boolean;
  onToggleHideDuration(): void;
  bookOfYearKey: string | null;
  epigraph: string;
  onChooseBookOfYear(bookKey: string): void;
  onChangeEpigraph(epigraph: string): void;
  onPreviewKeepsake(excerpt: LetterExcerpt | null): void;
}

export function ReadingLetterAnnualBody({
  model,
  covers,
  hideDuration,
  onToggleHideDuration,
  bookOfYearKey,
  epigraph,
  onChooseBookOfYear,
  onChangeEpigraph,
  onPreviewKeepsake,
}: ReadingLetterAnnualBodyProps) {
  const { t } = useUiText();
  const initialMonth = [...model.months].reverse().find((m) => m.days > 0)?.month ?? 12;
  const [selectedMonth, setSelectedMonth] = useState(initialMonth);
  const [excerptIdx, setExcerptIdx] = useState(0);

  const activeMo = model.months[selectedMonth - 1];
  const chosenKey = bookOfYearKey ?? model.featuredBooks[0]?.bookKey ?? null;
  const activeExcerpt = model.excerpts[excerptIdx] ?? null;

  const ledger: Array<[string, string]> = hideDuration
    ? [
        [t("readingLetter.annual.ledgerBooks"), t("readingLetter.common.booksCount", { count: model.totalBooks })],
        [t("readingLetter.annual.ledgerDays"), t("readingLetter.common.daysCount", { days: model.activeDays })],
        [t("readingLetter.annual.ledgerFinished"), t("readingLetter.common.booksCount", { count: model.finishedCount })],
      ]
    : [
        [t("readingLetter.annual.ledgerHours"), formatReadingDuration(model.totalSeconds, t)],
        [t("readingLetter.annual.ledgerBooks"), t("readingLetter.common.booksCount", { count: model.totalBooks })],
        [t("readingLetter.annual.ledgerDays"), t("readingLetter.common.daysCount", { days: model.activeDays })],
        [t("readingLetter.annual.ledgerFinished"), t("readingLetter.common.booksCount", { count: model.finishedCount })],
      ];

  return (
    <>
      <h1 className="rl-title">{t("readingLetter.common.yearHeading", { year: model.year })}</h1>
      <p className="rl-sub">{t("readingLetter.annual.sub")}</p>
      <p className="rl-prose">{t("readingLetter.annual.prose")}</p>

      <div className="rl-ledger">
        {ledger.map(([label, value]) => (
          <div className="rl-ledger-cell" key={label}>
            <small>{label}</small>
            <strong>{value}</strong>
          </div>
        ))}
      </div>

      <div className="rl-fold">{t("readingLetter.annual.monthsHeading")}</div>
      <div className="rl-year-grid">
        {model.months.map((mo) => (
          <button
            key={mo.month}
            type="button"
            className="rl-year-cell"
            aria-pressed={selectedMonth === mo.month}
            onClick={() => setSelectedMonth(mo.month)}
          >
            {mo.topBookKey ? (
              <span className="rl-mini-wrap" style={{ width: "32px" }}>
                <LetterBookCover bookKey={mo.topBookKey} title={mo.topBookTitle} covers={covers} mini />
              </span>
            ) : null}
            <b>{t("readingLetter.common.monthUnit", { month: mo.month })}</b>
            <small>{mo.days > 0 ? t("readingLetter.common.daysCount", { days: mo.days }) : "—"}</small>
          </button>
        ))}
      </div>

      <div className="rl-slip" aria-live="polite">
        {activeMo && activeMo.days > 0 ? (
          <span>
            {t("readingLetter.annual.monthDetail", {
              month: activeMo.month,
              book: activeMo.topBookTitle,
              days: activeMo.days,
            })}
            {!hideDuration ? ` · ${formatReadingDuration(activeMo.seconds, t)}` : ""}
          </span>
        ) : (
          <span>{t("readingLetter.annual.monthEmpty", { month: selectedMonth })}</span>
        )}
      </div>

      {model.featuredBooks.length > 0 && (
        <>
          <div className="rl-fold">{t("readingLetter.annual.choiceHeading")}</div>
          <p className="rl-intro">{t("readingLetter.annual.choiceIntro")}</p>
          <div className="rl-choice-grid">
            {model.featuredBooks.map((book) => {
              const picked = chosenKey === book.bookKey;
              return (
                <button
                  key={book.bookKey}
                  type="button"
                  className="rl-choice-card"
                  aria-pressed={picked}
                  onClick={() => onChooseBookOfYear(book.bookKey)}
                >
                  <span style={{ width: "64px" }}>
                    <LetterBookCover bookKey={book.bookKey} title={book.title} covers={covers} />
                  </span>
                  <strong>{book.title}</strong>
                  <small>{t("readingLetter.annual.choiceDays", { days: book.days })}</small>
                  {picked && <span className="rl-choice-stamp">{t("readingLetter.annual.choiceStamp", { year: model.year })}</span>}
                </button>
              );
            })}
          </div>
          <label className="rl-epigraph-label" htmlFor="rl-annual-epigraph">
            {t("readingLetter.annual.epigraphLabel", { year: model.year })}
          </label>
          <input
            id="rl-annual-epigraph"
            className="rl-epigraph-input"
            type="text"
            maxLength={60}
            value={epigraph}
            placeholder={t("readingLetter.annual.epigraphPlaceholder")}
            onChange={(e) => onChangeEpigraph(e.target.value)}
          />
        </>
      )}

      {activeExcerpt && (
        <>
          <div className="rl-fold">{t("readingLetter.annual.excerptHeading")}</div>
          <div className="rl-excerpt">
            <blockquote>“{activeExcerpt.quote}”</blockquote>
            {activeExcerpt.note ? (
              <p className="rl-excerpt-note">{t("readingLetter.monthly.dayNote", { note: activeExcerpt.note })}</p>
            ) : null}
            <div className="rl-excerpt-foot">
              <span>《{activeExcerpt.bookTitle}》</span>
              {model.excerpts.length > 1 && (
                <button
                  className="rl-btn"
                  type="button"
                  onClick={() => setExcerptIdx((i) => (i + 1) % model.excerpts.length)}
                >
                  {t("readingLetter.monthly.excerptCycle")}
                </button>
              )}
            </div>
          </div>
        </>
      )}

      <footer className="rl-colophon">
        <p className="rl-prose">{t("readingLetter.annual.colophon")}</p>
        <div className="rl-keepsake-bar">
          <div className="rl-toggle-row">
            <button
              className="rl-chip"
              type="button"
              aria-pressed={hideDuration}
              onClick={onToggleHideDuration}
            >
              {t("readingLetter.privacy.hideDuration")}
            </button>
          </div>
          <button
            className="rl-btn primary"
            type="button"
            onClick={() => onPreviewKeepsake(activeExcerpt)}
          >
            {t("readingLetter.keepsake.previewBtn")}
          </button>
        </div>
      </footer>
    </>
  );
}
