import { useUiText } from "./localization/UiLanguageProvider";

/**
 * Reader-side search navigation: visible while the current book has a search
 * query with published hits and the result panel is closed. Every action goes
 * through the existing precise-navigation entry; this bar owns no position.
 */
export function SearchNavigationBar(props: {
  count: number;
  current: number | null;
  scanning: boolean;
  busy?: boolean;
  waiting?: boolean;
  onPrevious(): void;
  onNext(): void;
  onBackToResults(): void;
}) {
  const { t } = useUiText();
  const position = props.current === null ? 0 : props.current + 1;
  const atEnd = props.current === null ? props.count === 0 : props.current >= props.count - 1;
  return (
    <div className="search-nav-bar" role="group" aria-label={t("search.title")}>
      <span className="search-nav-position" aria-live="polite">
        {t("search.nav.progress", { current: position, total: props.count })}
      </span>
      <button
        type="button"
        className="search-nav-btn"
        onClick={props.onPrevious}
        disabled={props.busy || props.current === null || props.current <= 0}
      >
        {t("search.nav.prev")}
      </button>
      <button
        type="button"
        className="search-nav-btn"
        onClick={props.onNext}
        disabled={props.busy || (atEnd && !props.scanning)}
      >
        {t("search.nav.next")}
      </button>
      {props.waiting && <span className="search-nav-waiting">{t("search.nav.waiting")}</span>}
      <button type="button" className="search-nav-btn search-nav-back" onClick={props.onBackToResults}>
        {t("search.nav.back")}
      </button>
    </div>
  );
}
