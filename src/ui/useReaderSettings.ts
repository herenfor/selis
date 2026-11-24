import { useEffect, useMemo, useState } from "react";
import { isValidUiScale } from "./uiScale";
import type { PortablePreferences } from "../core/portableState/portable-state-types";
import { normalizePageOptions } from "../render/pageLayout";
import {
  DEFAULT_SETTINGS,
  normalizePageDirection,
  normalizeTurnAnimation,
  type PageDirectionSetting,
  type PageMarginsPx,
  type ReaderSettings,
  type SpreadGapMode,
  type TurnAnimation,
} from "../render/settings";
import type { UserFont } from "./fontStore";
import { readSavedSettings, savedTheme, toSavedReaderSettings, writeSavedSettings } from "./storage";

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Settings state and stable operations; navigation and theme transactions stay with the host. */
export function useReaderSettings() {
  const [settings, setSettings] = useState<ReaderSettings>(() => {
    const saved = readSavedSettings();
    return {
      ...DEFAULT_SETTINGS,
      fontSizePx: saved.fontSizePx ?? DEFAULT_SETTINGS.fontSizePx,
      theme: savedTheme(saved) ?? DEFAULT_SETTINGS.theme,
      lineHeight: saved.lineHeight,
      fontWeight: saved.fontWeight,
      letterSpacingPx: saved.letterSpacingPx,
      wordSpacingPx: saved.wordSpacingPx,
      customFontName: saved.customFontName,
      fontSource: saved.fontSource === "system" || saved.fontSource === "imported" ? saved.fontSource : undefined,
      customFontId: saved.customFontId,
      forceFontOverride: saved.forceFontOverride === true,
      splitHeadingFont: saved.splitHeadingFont === true,
      headingFontName: saved.headingFontName,
      headingFontSource: saved.headingFontSource === "system" || saved.headingFontSource === "imported" ? saved.headingFontSource : undefined,
      headingFontId: saved.headingFontId,
      footnoteFontSource: saved.footnoteFontSource === "system" || saved.footnoteFontSource === "imported" ? saved.footnoteFontSource : undefined,
      footnoteFontName: typeof saved.footnoteFontName === "string" ? saved.footnoteFontName : undefined,
      footnoteFontId: typeof saved.footnoteFontId === "string" ? saved.footnoteFontId : undefined,
      customCss: saved.customCss,
      forceHorizontal: saved.forceHorizontal === true,
      txtIndent: saved.txtIndent === true,
      preloadNextChapter: saved.preloadNextChapter === true,
      seamlessChapterTurn: saved.seamlessChapterTurn === true,
      turnAnimation: normalizeTurnAnimation(saved.turnAnimation),
      pageDirection: normalizePageDirection(saved.pageDirection),
      fullBleedImages: saved.fullBleedImages !== false,
      // Normalize page options only at the saved-settings boundary.
      ...normalizePageOptions({
        readingMode: saved.readingMode,
        pageMarginsPx: saved.pageMarginsPx,
        columnsPerView: saved.columnsPerView,
        gapPx: saved.gapPx,
        spreadGapMode: saved.spreadGapMode,
      }),
    };
  });
  // UI scale is independent of the book's font size.
  const [uiScale, setUiScale] = useState<number>(() => {
    const saved = readSavedSettings();
    return isValidUiScale(saved.uiScale) ? saved.uiScale : 1;
  });

  const settingsActions = useMemo(() => {
    const adjustFont = (delta: number): void => {
      setSettings((s) => {
        const fontSizePx = clamp(s.fontSizePx + delta, 12, 32);
        return fontSizePx === s.fontSizePx ? s : { ...s, fontSizePx };
      });
    };
    return {
      setFontSize(v: number) {
        setSettings((s2) => {
          const fontSizePx = clamp(v, 12, 32);
          return fontSizePx === s2.fontSizePx ? s2 : { ...s2, fontSizePx };
        });
      },
      decreaseFont: () => adjustFont(-2),
      increaseFont: () => adjustFont(2),
      setLineHeight(v: number) {
        setSettings((s2) => {
          const lineHeight = clamp(v, 1.2, 2.4);
          return lineHeight === s2.lineHeight ? s2 : { ...s2, lineHeight };
        });
      },
      resetLineHeight: () => setSettings((s2) => ({ ...s2, lineHeight: undefined })),
      setFontWeight: (v: number | undefined) => setSettings((s2) => ({ ...s2, fontWeight: v })),
      setLetterSpacing: (v: number | undefined) => setSettings((s2) => ({ ...s2, letterSpacingPx: v })),
      setWordSpacing: (v: number | undefined) => setSettings((s2) => ({ ...s2, wordSpacingPx: v })),
      setGap: (gap: number) => setSettings((s2) => ({ ...s2, gapPx: gap, spreadGapMode: "manual" })),
      setSpreadGapMode: (mode: SpreadGapMode) => setSettings((s2) => ({ ...s2, spreadGapMode: mode })),
      setUiScale,
      setPageMargins: (margins: PageMarginsPx) => setSettings((s2) => ({ ...s2, pageMarginsPx: margins })),
      setPresentation: (patch: { readingMode?: "paginated" | "scroll"; columnsPerView?: 1 | 2 }) =>
        setSettings((s2) => ({ ...s2, ...patch })),
      setTurnAnimation: (turnAnimation: TurnAnimation) => setSettings((s2) => ({ ...s2, turnAnimation })),
      setForceHorizontal: (enabled: boolean) => setSettings((s2) => ({ ...s2, forceHorizontal: enabled })),
      setTxtIndent: (enabled: boolean) => setSettings((s2) => ({ ...s2, txtIndent: enabled })),
      setPageDirection: (pageDirection: PageDirectionSetting) => setSettings((s2) => ({ ...s2, pageDirection })),
      setFullBleedImages: (enabled: boolean) => setSettings((s2) => ({ ...s2, fullBleedImages: enabled })),
      setPreloadNextChapter: (enabled: boolean) => setSettings((s2) => ({ ...s2, preloadNextChapter: enabled })),
      setSeamlessChapterTurn: (enabled: boolean) => setSettings((s2) => ({ ...s2, seamlessChapterTurn: enabled })),
      setCustomCss: (css: string) => setSettings((s2) => ({ ...s2, customCss: css })),
      setForceFontOverride: (enabled: boolean) => setSettings((s) => ({ ...s, forceFontOverride: enabled })),
      setSplitHeadingFont: (enabled: boolean) => setSettings((s) => ({ ...s, splitHeadingFont: enabled })),
      selectSystemHeadingFont: (family: string) =>
        setSettings((s) => ({ ...s, headingFontSource: "system", headingFontName: family, headingFontId: undefined })),
      selectHeadingBookFont: () =>
        setSettings((s) => ({ ...s, headingFontSource: undefined, headingFontName: undefined, headingFontId: undefined })),
      selectImportedHeadingFont: (font: Pick<UserFont, "id" | "family">) =>
        setSettings((s) => ({ ...s, headingFontSource: "imported", headingFontId: font.id, headingFontName: font.family })),
      selectFootnoteBookFont: () =>
        setSettings((s) => ({ ...s, footnoteFontSource: undefined, footnoteFontId: undefined, footnoteFontName: undefined })),
      selectSystemFootnoteFont: (family: string) =>
        setSettings((s) => ({ ...s, footnoteFontSource: "system", footnoteFontId: undefined, footnoteFontName: family })),
      selectImportedFootnoteFont: (font: Pick<UserFont, "id" | "family">) =>
        setSettings((s) => ({ ...s, footnoteFontSource: "imported", footnoteFontId: font.id, footnoteFontName: font.family })),
      selectSystemFont: (family: string) =>
        setSettings((s) => ({ ...s, fontSource: "system", customFontName: family, customFontId: undefined })),
      selectBookFont: () =>
        setSettings((s) => ({ ...s, fontSource: undefined, customFontName: undefined, customFontId: undefined })),
      selectImportedFont: (font: Pick<UserFont, "id" | "family">) =>
        setSettings((s) => ({ ...s, fontSource: "imported", customFontId: font.id, customFontName: font.family })),
      resetDefaults() {
        setSettings({ ...DEFAULT_SETTINGS });
        setUiScale(1);
      },
      applyPortablePreferences(preferences: PortablePreferences) {
        setSettings((previous) => {
          const next = { ...previous };
          if (preferences.theme === "light" || preferences.theme === "dark" || preferences.theme === "sepia" || preferences.theme === "gray") {
            next.theme = preferences.theme;
          }
          if (typeof preferences.fontSizePx === "number" && preferences.fontSizePx >= 12 && preferences.fontSizePx <= 32) {
            next.fontSizePx = preferences.fontSizePx;
          }
          if (typeof preferences.lineHeight === "number" && preferences.lineHeight >= 1 && preferences.lineHeight <= 3) {
            next.lineHeight = preferences.lineHeight;
          }
          if (typeof preferences.fontWeight === "number" && preferences.fontWeight >= 100 && preferences.fontWeight <= 900) {
            next.fontWeight = preferences.fontWeight;
          }
          if (typeof preferences.letterSpacingPx === "number" && preferences.letterSpacingPx >= 0 && preferences.letterSpacingPx <= 32) {
            next.letterSpacingPx = preferences.letterSpacingPx;
          }
          if (typeof preferences.wordSpacingPx === "number" && preferences.wordSpacingPx >= 0 && preferences.wordSpacingPx <= 64) {
            next.wordSpacingPx = preferences.wordSpacingPx;
          }
          return next;
        });
      },
    };
  }, [setSettings, setUiScale]);

  return { settings, setSettings, uiScale, settingsActions };
}

/** Called at the host's original persistence position to retain effect ordering. */
export function useReaderSettingsPersistence(settings: ReaderSettings, uiScale: number): void {
  useEffect(() => {
    writeSavedSettings(toSavedReaderSettings(settings, uiScale));
  }, [settings, uiScale]);
}
