import { useUiText } from "../localization/UiLanguageProvider";
import type { LetterPaperTone } from "./letterKeepsakeRenderer";
import type { ActiveLetterDescriptor, LetterPreviewMode } from "./letterSchedule";

/** Maps SeLis's global app theme to the closest stationery paper tone for Reading Letters. */
export function paperToneForAppTheme(theme?: string, tone?: "dark"): LetterPaperTone {
  if (tone === "dark") return "night";
  if (theme === "sepia") return "sepia";
  return "paper";
}

export interface ReadingLetterPreviewSwitchProps {
  letter: ActiveLetterDescriptor;
  onSelect(mode: LetterPreviewMode): void;
}

/**
 * Rendered inside TitleBar only when `letter.isPreview === true` so testers can
 * inspect monthly/annual/empty states without reserving any page top bar.
 */
export function ReadingLetterPreviewSwitch({ letter, onSelect }: ReadingLetterPreviewSwitchProps) {
  const { t } = useUiText();
  if (!letter.isPreview) return null;

  const isEmpty = letter.periodKey.startsWith("empty-");
  return (
    <div className="rl-titlebar-preview" role="group" aria-label={t("readingLetter.env.monthlyBrand")}>
      {(["monthly", "annual", "empty"] as const).map((mode) => {
        const active =
          mode === "empty"
            ? isEmpty
            : mode === "annual"
              ? letter.kind === "annual"
              : letter.kind === "monthly" && !isEmpty;
        return (
          <button
            key={mode}
            type="button"
            className="rl-titlebar-preview-btn"
            aria-pressed={active}
            onClick={() => onSelect(mode)}
          >
            {t(`readingLetter.preview.${mode}`)}
          </button>
        );
      })}
    </div>
  );
}
