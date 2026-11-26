import { useEffect, useState } from "react";
import { descriptorForEntry, type ThumbnailProvider } from "../thumbnail";
import type { ShelfEntry } from "../shelf/types";

export interface BookClothTone {
  bg: string;
  fg: string;
  mat: string;
}

const BOOK_CLOTH_PALETTE: readonly BookClothTone[] = [
  { bg: "#234750", fg: "#fff8e7", mat: "#c9d9d6" },
  { bg: "#5a4638", fg: "#f7efe3", mat: "#e5d7c4" },
  { bg: "#6c4841", fg: "#fbf2ea", mat: "#e2cbc4" },
  { bg: "#3b4f3e", fg: "#eef2e6", mat: "#ced9cd" },
  { bg: "#4a3f55", fg: "#f6efe2", mat: "#d7d0de" },
  { bg: "#465261", fg: "#f3f6f8", mat: "#d1dae2" },
];

export function bookClothToneForKey(key: string): BookClothTone {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return BOOK_CLOTH_PALETTE[(hash >>> 0) % BOOK_CLOTH_PALETTE.length];
}

export interface LetterCoverSubject {
  bookKey: string;
  entry?: ShelfEntry;
}

export interface LoadedLetterCover {
  url: string;
  image: HTMLImageElement | null;
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/**
 * Loads transient cover Blob URLs & decoded Image elements for the books shown
 * in the open Reading Letter, revoking every object URL when unmounted.
 */
export function useLetterCovers(
  subjects: readonly LetterCoverSubject[],
  provider: ThumbnailProvider | undefined,
): ReadonlyMap<string, LoadedLetterCover> {
  const [covers, setCovers] = useState<Map<string, LoadedLetterCover>>(() => new Map());

  useEffect(() => {
    if (!provider || subjects.length === 0) {
      setCovers(new Map());
      return;
    }
    let cancelled = false;
    const createdUrls: string[] = [];

    void (async () => {
      const next = new Map<string, LoadedLetterCover>();
      const seen = new Set<string>();
      for (const { bookKey, entry } of subjects) {
        if (!bookKey || !entry || seen.has(bookKey)) continue;
        seen.add(bookKey);
        try {
          const desc = descriptorForEntry(entry);
          const asset = (await provider.readCachedThumbnail(desc)) ?? (await provider.readSourceCover(desc));
          if (!asset || asset.bytes.byteLength === 0 || cancelled) continue;
          const copy = new Uint8Array(asset.bytes);
          const blob = new Blob([copy], { type: asset.mime || "image/jpeg" });
          const url = URL.createObjectURL(blob);
          createdUrls.push(url);
          const image = await loadImage(url);
          if (cancelled) continue;
          next.set(bookKey, { url, image });
        } catch {
          /* fall back cleanly to typographic bookplate cover */
        }
      }
      if (!cancelled) setCovers(next);
    })();

    return () => {
      cancelled = true;
      for (const url of createdUrls) URL.revokeObjectURL(url);
    };
  }, [provider, subjects]);

  return covers;
}
