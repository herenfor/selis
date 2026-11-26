import { useEffect, useMemo, useState } from "react";
import type { AppPlatform } from "../../config/platformValue";
import { useUiText } from "../localization/UiLanguageProvider";
import { ICON_BOX, ICON_PAGES_PATH, ICON_RADIUS } from "../share/brandMark";
import {
  canCopyImage,
  copyShareImage,
  saveShareImage,
  saveShareImageToGallery,
  shareActions,
  shareImageNative,
  type ShareSurface,
} from "../share/shareOutput";
import type { ShelfEntry } from "../shelf/types";
import type { ThumbnailProvider } from "../thumbnail";
import { useLetterCovers } from "./letterCovers";
import { formatReadingDuration } from "./letterFormat";
import { renderReadingLetterPngBlob, type LetterPaperTone } from "./letterKeepsakeRenderer";
import {
  markLetterOpened,
  readLetterState,
  saveAnnualChoice,
  writeLetterState,
  type ActiveLetterDescriptor,
} from "./letterSchedule";
import { ReadingLetterAnnualBody } from "./ReadingLetterAnnualBody";
import { ReadingLetterMonthlyBody } from "./ReadingLetterMonthlyBody";
import {
  buildAnnualLetterData,
  buildMonthlyLetterData,
  readReadingLog,
  type LetterExcerpt,
} from "./readingLogStore";
import "./readingLetter.css";

export interface ReadingLetterViewProps {
  letter: ActiveLetterDescriptor;
  entries: readonly ShelfEntry[];
  thumbnailProvider?: ThumbnailProvider;
  platform: AppPlatform;
  onBack(): void;
  onNotice?(message: string): void;
}

function isReducedMotion(): boolean {
  if (typeof document !== "undefined" && document.documentElement.dataset.motion === "reduced") return true;
  try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; }
}

export function ReadingLetterView({
  letter,
  entries,
  thumbnailProvider,
  platform,
  onBack,
  onNotice,
}: ReadingLetterViewProps) {
  const { t } = useUiText();
  const [letterState, setLetterState] = useState(() => readLetterState());
  const log = useMemo(() => readReadingLog(), [letter.periodKey]);

  const [stage, setStage] = useState<"envelope" | "unfolded">(() =>
    letter.alreadyOpenedToday ? "unfolded" : "envelope",
  );
  const [opening, setOpening] = useState(false);
  const [unfolding, setUnfolding] = useState(letter.alreadyOpenedToday);
  const [paper, setPaper] = useState<LetterPaperTone>(() => letterState.paperTone ?? "paper");

  const [hideDuration, setHideDuration] = useState(false);
  const [includeRhythm, setIncludeRhythm] = useState(true);
  const [includeExcerpt, setIncludeExcerpt] = useState(true);
  const [hiddenBookKeys, setHiddenBookKeys] = useState<Set<string>>(() => new Set());
  const [keepsake, setKeepsake] = useState<{ blob: Blob; fileName: string; previewUrl: string } | null>(null);
  const [exporting, setExporting] = useState(false);

  const isPreviewEmpty = letter.periodKey.startsWith("empty-");
  const allMonthModel = useMemo(
    () => buildMonthlyLetterData(log, entries, letter.year, letter.month ?? 1),
    [log, entries, letter.year, letter.month],
  );
  const visibleMonthModel = useMemo(
    () => buildMonthlyLetterData(log, entries, letter.year, letter.month ?? 1, hiddenBookKeys),
    [log, entries, letter.year, letter.month, hiddenBookKeys],
  );
  const annualModel = useMemo(
    () => buildAnnualLetterData(log, entries, letter.year),
    [log, entries, letter.year],
  );

  const coverSubjects = useMemo(() => {
    if (letter.kind === "annual") {
      const list: Array<{ bookKey: string; entry?: ShelfEntry }> = annualModel.featuredBooks.map((b) => ({ bookKey: b.bookKey, entry: b.entry }));
      for (const m of annualModel.months) if (m.topBookKey) list.push({ bookKey: m.topBookKey, entry: m.topEntry });
      return list;
    }
    return allMonthModel.books.map((b) => ({ bookKey: b.bookKey, entry: b.entry }));
  }, [letter.kind, annualModel, allMonthModel]);

  const covers = useLetterCovers(
    coverSubjects.map((s) => s.entry),
    coverSubjects.map((s) => s.bookKey),
    thumbnailProvider,
  );

  useEffect(() => {
    return () => {
      if (keepsake?.previewUrl) URL.revokeObjectURL(keepsake.previewUrl);
    };
  }, [keepsake]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (keepsake) setKeepsake(null);
      else onBack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [keepsake, onBack]);

  const updatePaper = (next: LetterPaperTone) => {
    setPaper(next);
    const updated = { ...letterState, paperTone: next };
    setLetterState(updated);
    writeLetterState(updated);
  };

  const handleUnwrap = () => {
    if (opening) return;
    const finish = () => {
      const nextState = letter.isPreview ? letterState : markLetterOpened(letterState, letter.periodKey, new Date());
      if (nextState !== letterState) {
        setLetterState(nextState);
        writeLetterState(nextState);
      }
      setOpening(false);
      setUnfolding(true);
      setStage("unfolded");
    };
    if (isReducedMotion()) {
      finish();
      return;
    }
    setOpening(true);
    window.setTimeout(finish, 560);
  };

  const toggleBookHidden = (bookKey: string) => {
    setHiddenBookKeys((prev) => {
      const next = new Set(prev);
      if (next.has(bookKey)) next.delete(bookKey); else next.add(bookKey);
      return next;
    });
  };

  const savedAnnual = letterState.annualChoices[String(letter.year)];
  const bookOfYearKey = savedAnnual?.bookKey ?? annualModel.featuredBooks[0]?.bookKey ?? null;
  const epigraph = savedAnnual?.epigraph ?? "";

  const updateAnnualChoice = (nextBookKey: string | null, nextEpigraph: string) => {
    const key = nextBookKey ?? annualModel.featuredBooks[0]?.bookKey ?? "";
    const nextState = saveAnnualChoice(letterState, letter.year, { bookKey: key, epigraph: nextEpigraph });
    setLetterState(nextState);
    writeLetterState(nextState);
  };

  const stampDate = `${letter.deliveryDate.getFullYear()}.${String(letter.deliveryDate.getMonth() + 1).padStart(2, "0")}.${String(letter.deliveryDate.getDate()).padStart(2, "0")}`;
  const periodLabel = letter.kind === "annual"
    ? String(letter.year)
    : t("readingLetter.common.yearMonthHeading", { year: letter.year, month: letter.month ?? 1 });

  const handlePreviewMonthlyKeepsake = async (excerpt: LetterExcerpt | null, prose: string) => {
    if (exporting) return;
    setExporting(true);
    try {
      const ledger: Array<[string, string]> = hideDuration
        ? [
            [t("readingLetter.monthly.ledgerBooks"), t("readingLetter.common.booksCount", { count: visibleMonthModel.books.length })],
            [t("readingLetter.monthly.ledgerDays"), t("readingLetter.common.daysCount", { days: visibleMonthModel.activeDays })],
          ]
        : [
            [t("readingLetter.monthly.ledgerDuration"), formatReadingDuration(visibleMonthModel.totalSeconds, t)],
            [t("readingLetter.monthly.ledgerBooks"), t("readingLetter.common.booksCount", { count: visibleMonthModel.books.length })],
            [t("readingLetter.monthly.ledgerDays"), t("readingLetter.common.daysCount", { days: visibleMonthModel.activeDays })],
          ];
      const longestTitle = visibleMonthModel.longestSession
        ? (visibleMonthModel.books.find((b) => b.bookKey === visibleMonthModel.longestSession?.bookKey)?.title ?? "")
        : "";
      const out = await renderReadingLetterPngBlob({
        kind: "monthly",
        paper,
        model: visibleMonthModel,
        covers,
        hideDuration,
        includeRhythm,
        includeExcerpt,
        excerpt,
        labels: {
          brandLabel: t("readingLetter.env.monthlyBrand"),
          stampTop: stampDate,
          stampSub: `${letter.month ?? 1}月`,
          title: periodLabel,
          subtitle: t("readingLetter.monthly.sub", { year: letter.year, month: letter.month ?? 1 }),
          prose,
          ledger,
          calHeading: t("readingLetter.monthly.calHeading"),
          mosaicHeading: t("readingLetter.monthly.booksHeading"),
          weekdays: t("readingLetter.monthly.weekdays").split(","),
          rhythmHeading: t("readingLetter.monthly.rhythmHeading"),
          rhythmSummary: !hideDuration && visibleMonthModel.longestSession && longestTitle
            ? t("readingLetter.monthly.rhythmSummary", {
                day: visibleMonthModel.longestSession.day,
                book: longestTitle,
                duration: formatReadingDuration(visibleMonthModel.longestSession.seconds, t),
              })
            : t("readingLetter.monthly.rhythmSummaryNoDuration"),
          colophon: t("readingLetter.monthly.colophon", { month: visibleMonthModel.month }),
          fileName: `SeLis-reading-letter-${visibleMonthModel.periodKey}.png`,
          durationFormatter: (s) => formatReadingDuration(s, t),
        },
      });
      setKeepsake(out);
    } catch {
      onNotice?.(t("readingLetter.keepsake.failedNotice"));
    } finally {
      setExporting(false);
    }
  };

  const handlePreviewAnnualKeepsake = async (excerpt: LetterExcerpt | null) => {
    if (exporting) return;
    setExporting(true);
    try {
      const out = await renderReadingLetterPngBlob({
        kind: "annual",
        paper,
        model: annualModel,
        covers,
        hideDuration,
        bookOfYearKey,
        epigraph,
        excerpt,
        labels: {
          brandLabel: t("readingLetter.env.annualBrand"),
          stampTop: stampDate,
          stampSub: String(letter.year),
          title: t("readingLetter.common.yearHeading", { year: letter.year }),
          subtitle: hideDuration
            ? `${t("readingLetter.common.booksCount", { count: annualModel.totalBooks })} · ${t("readingLetter.common.daysCount", { days: annualModel.activeDays })}`
            : `${formatReadingDuration(annualModel.totalSeconds, t)} · ${t("readingLetter.common.booksCount", { count: annualModel.totalBooks })} · ${t("readingLetter.common.daysCount", { days: annualModel.activeDays })}`,
          monthsHeading: t("readingLetter.annual.monthsHeading"),
          monthLabel: (m) => t("readingLetter.common.monthUnit", { month: m }),
          daysCount: (d) => (d > 0 ? t("readingLetter.common.daysCount", { days: d }) : "—"),
          choiceHeading: t("readingLetter.annual.choiceHeading"),
          choiceBadge: t("readingLetter.annual.choiceStamp", { year: letter.year }),
          daysWithBook: (d) => t("readingLetter.annual.choiceDays", { days: d }),
          colophon: t("readingLetter.annual.colophon"),
          fileName: `SeLis-annual-letter-${letter.year}.png`,
        },
      });
      setKeepsake(out);
    } catch {
      onNotice?.(t("readingLetter.keepsake.failedNotice"));
    } finally {
      setExporting(false);
    }
  };

  const surface: ShareSurface = platform === "android" ? "android" : platform === "web" ? "browser" : "desktop";
  const exportActions = shareActions(surface, { clipboardImage: canCopyImage(), androidNative: true }).filter((a) => a !== "copyText");

  const runKeepsakeAction = async (action: "copyImage" | "saveImage" | "saveGallery" | "share") => {
    if (!keepsake) return;
    try {
      if (action === "copyImage") {
        await copyShareImage(keepsake.blob);
        onNotice?.(t("readingLetter.keepsake.copiedNotice"));
      } else if (action === "saveImage") {
        const saved = await saveShareImage(keepsake.blob, keepsake.fileName, surface, {
          title: t("readingLetter.keepsake.saveImage"),
          filter: "PNG",
        });
        if (saved) onNotice?.(t("readingLetter.keepsake.savedNotice"));
      } else if (action === "saveGallery") {
        await saveShareImageToGallery(keepsake.blob, keepsake.fileName);
        onNotice?.(t("readingLetter.keepsake.galleryNotice"));
      } else if (action === "share") {
        await shareImageNative(keepsake.blob, keepsake.fileName, periodLabel);
      }
    } catch {
      onNotice?.(t("readingLetter.keepsake.failedNotice"));
    }
  };

  const isEmptyLetter = isPreviewEmpty || (letter.kind === "monthly" ? allMonthModel.activeDays === 0 : annualModel.activeDays === 0);

  return (
    <div className="reading-letter-page" data-paper={paper}>
      <nav className="rl-topbar" aria-label={t("readingLetter.env.monthlyBrand")}>
        <button className="rl-btn ghost" type="button" onClick={onBack}>
          {t("readingLetter.nav.back")}
        </button>
        <div className="rl-pills" role="group">
          {(["paper", "sepia", "night"] as const).map((tone) => (
            <button
              key={tone}
              type="button"
              className="rl-pill"
              aria-pressed={paper === tone}
              onClick={() => updatePaper(tone)}
            >
              {t(`readingLetter.tone.${tone}`)}
            </button>
          ))}
        </div>
      </nav>

      <div className="rl-stage">
        {stage === "envelope" ? (
          <section className={`rl-envelope${opening ? " is-opening" : ""}`}>
            <div className="rl-env-card">
              <div className="rl-env-inner" aria-hidden="true">
                <small>{periodLabel}</small>
              </div>
              <div className="rl-env-flap" aria-hidden="true" />
              <button
                type="button"
                className="rl-env-seal"
                aria-label={t("readingLetter.env.sealAria")}
                onClick={handleUnwrap}
              >
                <svg width="24" height="24" viewBox={`0 0 ${ICON_BOX} ${ICON_BOX}`} aria-hidden="true">
                  <path fill="currentColor" d={ICON_PAGES_PATH} />
                </svg>
              </button>
              <div className="rl-env-body">
                <div className="rl-letterhead" style={{ borderBottom: 0, paddingBottom: 0 }}>
                  <div className="rl-mark-line">
                    <span>{t(letter.kind === "annual" ? "readingLetter.env.annualBrand" : "readingLetter.env.monthlyBrand")}</span>
                  </div>
                  <div className="rl-postmark"><b>{stampDate}</b></div>
                </div>
                <h1 className="rl-title">
                  {letter.kind === "annual"
                    ? t("readingLetter.env.annualTitle", { period: periodLabel })
                    : t("readingLetter.env.monthlyTitle", { period: periodLabel })}
                </h1>
                <p className="rl-prose">{t("readingLetter.env.body")}</p>
                <button className="rl-btn primary" type="button" onClick={handleUnwrap}>
                  {t("readingLetter.env.open")}
                </button>
              </div>
            </div>
          </section>
        ) : (
          <article className={`rl-sheet${isEmptyLetter ? " compact" : ""}${unfolding ? " is-unfolding" : ""}`}>
            <header className="rl-letterhead">
              <div className="rl-mark-line">
                <svg width="20" height="20" viewBox={`0 0 ${ICON_BOX} ${ICON_BOX}`} aria-hidden="true">
                  <rect width={ICON_BOX} height={ICON_BOX} rx={ICON_RADIUS} fill="currentColor" />
                  <path fill="var(--rl-sheet)" d={ICON_PAGES_PATH} />
                </svg>
                <span>{t(letter.kind === "annual" ? "readingLetter.env.annualBrand" : "readingLetter.env.monthlyBrand")}</span>
              </div>
              <div className="rl-postmark"><b>{stampDate}</b></div>
            </header>

            {isEmptyLetter ? (
              <>
                <h1 className="rl-title">{t("readingLetter.empty.title")}</h1>
                <p className="rl-prose">{t("readingLetter.empty.body", { period: periodLabel })}</p>
              </>
            ) : letter.kind === "annual" ? (
              <ReadingLetterAnnualBody
                model={annualModel}
                covers={covers}
                hideDuration={hideDuration}
                onToggleHideDuration={() => setHideDuration((v) => !v)}
                bookOfYearKey={bookOfYearKey}
                epigraph={epigraph}
                onChooseBookOfYear={(k) => updateAnnualChoice(k, epigraph)}
                onChangeEpigraph={(text) => updateAnnualChoice(bookOfYearKey, text)}
                onPreviewKeepsake={(ex) => void handlePreviewAnnualKeepsake(ex)}
              />
            ) : (
              <ReadingLetterMonthlyBody
                allBooksModel={allMonthModel}
                visibleModel={visibleMonthModel}
                covers={covers}
                hiddenBookKeys={hiddenBookKeys}
                onToggleBookHidden={toggleBookHidden}
                hideDuration={hideDuration}
                onToggleHideDuration={() => setHideDuration((v) => !v)}
                includeRhythm={includeRhythm}
                onToggleIncludeRhythm={() => setIncludeRhythm((v) => !v)}
                includeExcerpt={includeExcerpt}
                onToggleIncludeExcerpt={() => setIncludeExcerpt((v) => !v)}
                onPreviewKeepsake={(ex, proseText) => void handlePreviewMonthlyKeepsake(ex, proseText)}
              />
            )}

            <div className="rl-sheet-actions">
              <button className="rl-btn ghost" type="button" onClick={() => { setUnfolding(false); setStage("envelope"); }}>
                {t("readingLetter.env.replay")}
              </button>
              <button className="rl-btn ghost" type="button" onClick={onBack}>
                {t("readingLetter.nav.back")}
              </button>
            </div>
          </article>
        )}
      </div>

      {keepsake && (
        <div
          className="rl-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="rl-keepsake-title"
          onClick={(e) => { if (e.target === e.currentTarget) setKeepsake(null); }}
        >
          <div className="rl-modal-card">
            <div className="rl-modal-head">
              <strong id="rl-keepsake-title">{t("readingLetter.keepsake.modalTitle")}</strong>
              <button className="rl-btn ghost" type="button" onClick={() => setKeepsake(null)}>
                {t("readingLetter.keepsake.close")}
              </button>
            </div>
            <div className="rl-modal-body">
              <img src={keepsake.previewUrl} alt={t("readingLetter.keepsake.modalTitle")} />
            </div>
            <div className="rl-modal-foot">
              <small>{t("readingLetter.keepsake.modalHint")}</small>
              <div className="rl-toggle-row">
                {exportActions.map((act) => (
                  <button
                    key={act}
                    type="button"
                    className={`rl-btn${act === "saveImage" || act === "share" ? " primary" : ""}`}
                    onClick={() => void runKeepsakeAction(act)}
                  >
                    {t(`readingLetter.keepsake.${act}`)}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
