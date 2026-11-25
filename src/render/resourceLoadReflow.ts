/** Only content resources can change the reader's measured layout. */
export function isLayoutResourceLoad(event: Event): boolean {
  const target = event.target as { localName?: unknown } | null;
  if (!target || typeof target.localName !== "string") return false;
  const tag = target.localName.toLowerCase();
  return tag === "img" || tag === "link";
}
