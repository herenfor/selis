import { useState } from "react";
import { uiText } from "../localization/UiLanguageProvider";

/** The entry stays one-based even when the reader groups two physical pages. */
export function PdfPageJump({ page, count, jump }: { page: number; count: number; jump(index: number): void }) {
  const [draft, setDraft] = useState<string | null>(null);
  return <form className="pdf-page-jump" onSubmit={event => {
    event.preventDefault();
    const value = Number(draft ?? page + 1);
    if (!Number.isInteger(value) || value < 1 || value > count) return;
    jump(value - 1);
    const field = event.currentTarget.elements.namedItem("page");
    if (field instanceof HTMLInputElement) field.blur();
  }}>
    <input name="page" type="number" aria-label={uiText("reader.pdf.pageNumber")} title={uiText("reader.pdf.pageNumber")}
      min={1} max={count} required inputMode="numeric" enterKeyHint="go" value={draft ?? page + 1}
      onFocus={event => event.currentTarget.select()} onBlur={() => setDraft(null)} onChange={event => setDraft(event.target.value)} />
    <span> / {count}</span>
  </form>;
}
