import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { spineItemPath } from "../core/book";
import type { Book } from "../core/types";
import type { AppPlatform } from "../config/appPlatform";
import type { BookContentPermissions } from "../render/bookContent/permissions";
import { readBookContentDefaults, writeBookContentDefaults, type BookContentDefaults } from "./bookContentPreferences";

interface Grants {
  book: Book;
  networkEnabled: boolean;
  javascriptEnabled: boolean;
}

export interface BookContentPermissionControls {
  available: boolean;
  networkEnabled: boolean;
  javascriptEnabled: boolean;
  setNetworkEnabled(enabled: boolean): void;
  setJavascriptEnabled(enabled: boolean): void;
  renderPermissions: BookContentPermissions | undefined;
}

export function useBookContentPermissions(book: Book | null, spineIndex: number, platform: AppPlatform): BookContentPermissionControls {
  if ((platform !== "windows" && platform !== "android") || (book?.sourceFormat ?? "epub") !== "epub") book = null;
  const chapterPath = book ? spineItemPath(book, spineIndex) : undefined;
  // Remembered last choice seeds every newly opened book; the live grants below
  // still belong to one book and reset when the book changes.
  const [defaults, setDefaults] = useState<BookContentDefaults>(readBookContentDefaults);
  // Only update() writes the defaults, so the ref always holds the latest choice
  // even before React commits the state update.
  const defaultsRef = useRef(defaults);
  const [grants, setGrants] = useState<Grants | null>(null);
  const networkEnabled = !!book && (grants?.book === book ? grants.networkEnabled : defaults.networkEnabled);
  const javascriptEnabled = !!book && (grants?.book === book ? grants.javascriptEnabled : defaults.javascriptEnabled);
  const controller = useMemo(() => new AbortController(), [book, chapterPath, networkEnabled, javascriptEnabled]);
  const current = useRef(book);
  useLayoutEffect(() => {
    current.current = book;
    setGrants(previous => previous?.book === book ? previous : null);
    return () => { current.current = null; };
  }, [book]);
  useLayoutEffect(() => () => controller.abort(), [controller]);

  function update(key: "networkEnabled" | "javascriptEnabled", enabled: boolean): void {
    if (!book || !chapterPath || current.current !== book) return;
    // Persist the latest choice so the next book opens with it already on/off.
    const next = { ...defaultsRef.current, [key]: enabled };
    defaultsRef.current = next;
    writeBookContentDefaults(next);
    setDefaults(next);
    setGrants(previous => {
      const active = previous?.book === book ? previous : { book, ...next };
      return active[key] === enabled ? previous : { ...active, [key]: enabled };
    });
  }

  const renderPermissions = useMemo(() => chapterPath && (networkEnabled || javascriptEnabled)
    ? { chapterPath, networkEnabled, javascriptEnabled, signal: controller.signal } : undefined,
  [chapterPath, networkEnabled, javascriptEnabled, controller]);
  return {
    available: !!book && !!chapterPath,
    networkEnabled,
    javascriptEnabled,
    setNetworkEnabled: enabled => update("networkEnabled", enabled),
    setJavascriptEnabled: enabled => update("javascriptEnabled", enabled),
    renderPermissions,
  };
}
