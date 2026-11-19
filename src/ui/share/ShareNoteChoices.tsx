import { useUiText } from "../localization/UiLanguageProvider";
import { highlightColorProps } from "../highlightModel";
import type { ShareAnnotation } from "./shareDraftBuilder";
import type { buildShareExcerpt } from "./shareSourceModel";

export function ShareCheckIcon() {
  return <svg viewBox="0 0 24 24" width="14" height="14" className="share-line-icon" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>;
}

export function ShareNoteChoices({ excerpt, onToggle, onJump }: {
  excerpt: ReturnType<typeof buildShareExcerpt>;
  onToggle(id: string): void;
  onJump?(note: ShareAnnotation, returnTo: HTMLButtonElement): void;
}) {
  const { t } = useUiText();
  if (!excerpt.notes.length) return null;
  return <div className="share-note-list" role="group" aria-label={t("share.notes.choose")}>
    {excerpt.notes.map((note) => {
      const checked = excerpt.included.includes(note);
      const ink = highlightColorProps(note.color);
      const preview = <><i className={`share-note-rule ${ink.className}`} style={ink.style} aria-hidden="true" /><span>{note.note}</span></>;
      return <div key={note.id} className="share-note-row" data-included={checked}>
        <button className="share-note-check" type="button" role="checkbox" aria-checked={checked} aria-label={note.note} onClick={() => onToggle(note.id)}>
          <span><ShareCheckIcon /></span>{!onJump && preview}
        </button>
        {onJump && (note.unmapped ? <span className="share-note-jump">{preview}</span> :
          <button className="share-note-jump" type="button" aria-label={t("share.notes.jump", { note: note.note })} onClick={(event) => onJump(note, event.currentTarget)}>{preview}<span aria-hidden="true">↗</span></button>)}
      </div>;
    })}
  </div>;
}
