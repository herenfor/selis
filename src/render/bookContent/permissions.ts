/** Live permissions belong to one opened book, never to saved preferences. */
export interface BookContentPermissions {
  readonly chapterPath: string;
  readonly networkEnabled: boolean;
  readonly javascriptEnabled: boolean;
  readonly signal: AbortSignal;
}

export function permissionsForChapter(permissions: BookContentPermissions | undefined, path: string) {
  return permissions?.chapterPath === path && !permissions.signal.aborted ? permissions : undefined;
}

export const BOOK_CHAPTER_CSP = [
  "default-src 'none'", "style-src 'unsafe-inline' blob:", "img-src blob: data:",
  "font-src blob: data:", "media-src blob:", "script-src 'none'", "connect-src 'none'",
  "object-src 'none'", "frame-src 'none'", "base-uri 'none'", "form-action 'none'",
].join("; ");

export function remoteImageAddress(raw: string): string | undefined {
  if (raw.length > 4096 || !/^(?:https:)?\/\//i.test(raw)) return;
  try {
    const url = new URL(raw.startsWith("//") ? `https:${raw}` : raw);
    if (url.protocol !== "https:" || url.port || url.username || url.password) return;
    url.hash = "";
    return url.href;
  } catch { return; }
}

export function externalResource(raw: string): boolean {
  return /^(?:[\w+.-]+:|\/\/)/.test(raw.replace(/[\t\n\r]/g, "").trim());
}
