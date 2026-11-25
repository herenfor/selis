// Remembers the reader's last choice for the two book-content grants. The live
// grants stay with the open book (see useBookContentPermissions); this only
// seeds the next book, so enabling networking or JavaScript once is enough.
// Device-local: kept out of ReaderSettings and portable archives.
const KEY = "epub-reader:book-content-permissions";

export interface BookContentDefaults {
  networkEnabled: boolean;
  javascriptEnabled: boolean;
}

export function readBookContentDefaults(): BookContentDefaults {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { networkEnabled: false, javascriptEnabled: false };
    const parsed = JSON.parse(raw) as Partial<BookContentDefaults>;
    return {
      networkEnabled: parsed.networkEnabled === true,
      javascriptEnabled: parsed.javascriptEnabled === true,
    };
  } catch {
    return { networkEnabled: false, javascriptEnabled: false };
  }
}

export function writeBookContentDefaults(defaults: BookContentDefaults): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(defaults));
  } catch {
    /* Storage unavailable: the switch still applies to the open book. */
  }
}
