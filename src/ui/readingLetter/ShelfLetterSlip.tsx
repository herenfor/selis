import { useState } from "react";
import { useUiText } from "../localization/UiLanguageProvider";
import type { ActiveLetterDescriptor } from "./letterSchedule";
import "./readingLetter.css";

export interface ShelfLetterSlipProps {
  letter: ActiveLetterDescriptor;
  onOpen(): void;
}

/**
 * Quiet, non-intrusive paper slip resting on the shelf on Option B delivery
 * days. No modal, no notification badge dot, and dismissible for the session.
 */
export function ShelfLetterSlip({ letter, onOpen }: ShelfLetterSlipProps) {
  const { t, locale } = useUiText();
  const [dismissed, setDismissed] = useState(false);
  const [folding, setFolding] = useState(false);

  if (dismissed) return null;

  const periodLabel = letter.kind === "annual"
    ? String(letter.year)
    : t("readingLetter.common.yearMonthHeading", { year: letter.year, month: letter.month ?? 1 });
  const graceEnd = new Intl.DateTimeFormat(locale, { month: "numeric", day: "numeric" }).format(letter.graceEndDate);

  const handleLater = () => {
    setFolding(true);
    window.setTimeout(() => setDismissed(true), 170);
  };

  return (
    <aside className={`shelf-letter-slip${folding ? " is-folding" : ""}`} aria-label={t("readingLetter.env.monthlyBrand")}>
      <div className="shelf-letter-slip-copy">
        <strong>
          {letter.kind === "annual"
            ? t("readingLetter.slip.titleAnnual", { period: periodLabel })
            : t("readingLetter.slip.titleMonthly", { period: periodLabel })}
        </strong>
        <span>{t("readingLetter.slip.sub", { graceEnd })}</span>
      </div>
      <div className="shelf-letter-slip-actions">
        <button className="shelf-letter-slip-later" type="button" onClick={handleLater}>
          {t("readingLetter.slip.later")}
        </button>
        <button className="shelf-letter-slip-btn" type="button" onClick={onOpen}>
          {t("readingLetter.slip.open")}
        </button>
      </div>
    </aside>
  );
}
