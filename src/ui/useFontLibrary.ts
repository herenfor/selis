import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { FontRole, ReaderSettings } from "../render/settings";
import { createFontImportController } from "./fontImport";
import {
  fontFamilyFromFileName,
  fontIdFromHash,
  getFontStore,
  listSystemFonts,
  type SystemFont,
  type UserFont,
} from "./fontStore";
import { createLazyFontController } from "./fontRuntime";
import { sha256Hex } from "./importBooks";
import { uiText } from "./localization/UiLanguageProvider";
import type { ShelfNotice } from "./useShelfLibrary";
import type { useReaderSettings } from "./useReaderSettings";

type ReaderSettingsActions = ReturnType<typeof useReaderSettings>["settingsActions"];

export interface FontLibraryDeps {
  settings: ReaderSettings;
  setSettings: Dispatch<SetStateAction<ReaderSettings>>;
  settingsActions: ReaderSettingsActions;
  setShelfNotice: Dispatch<SetStateAction<ShelfNotice>>;
}

export function useFontLibrary({ settings, setSettings, settingsActions, setShelfNotice }: FontLibraryDeps) {
  // ---- 用户自定义字体 ----
  const [userFonts, setUserFonts] = useState<UserFont[]>([]);
  const [fontUrls, setFontUrls] = useState<Record<string, string>>({});
  const [fontBusy, setFontBusy] = useState(false);
  const [systemFonts, setSystemFonts] = useState<SystemFont[]>([]);
  const [userFontsLoaded, setUserFontsLoaded] = useState(false);
  const [systemFontsStatus, setSystemFontsStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [systemFontsError, setSystemFontsError] = useState<string | null>(null);
  const fontRuntimeRef = useRef<ReturnType<typeof createLazyFontController> | null>(null);
  if (!fontRuntimeRef.current) {
    fontRuntimeRef.current = createLazyFontController((id) => getFontStore().readFont(id));
  }
  // 标题字体与正文各持有一个 Blob URL 生命周期：切换正文不会顺手回收标题字体。
  const headingFontRuntimeRef = useRef<ReturnType<typeof createLazyFontController> | null>(null);
  if (!headingFontRuntimeRef.current) {
    headingFontRuntimeRef.current = createLazyFontController((id) => getFontStore().readFont(id));
  }
  const [headingFontUrl, setHeadingFontUrl] = useState<string | null>(null);

  // A footnote-only selection never enters the chapter's customFonts or layout key.
  const footnoteRuntime = useMemo(() => createLazyFontController((id) => getFontStore().readFont(id)), []);
  const [importedFootnote, setImportedFootnote] = useState<{ id: string; url: string } | null>(null);
  const footnoteId = settings.footnoteFontSource === "imported" ? settings.footnoteFontId : undefined;
  useEffect(() => {
    let current = true;
    void footnoteRuntime.select(footnoteId).then((url) => {
      if (current) setImportedFootnote(footnoteId && url ? { id: footnoteId, url } : null);
    }).catch(() => { if (current) setImportedFootnote(null); });
    return () => { current = false; };
  }, [footnoteId, footnoteRuntime]);

  // ---- 字体元数据启动加载（只列元数据，绝不预读所有字体文件） ----
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const fonts = await getFontStore().list();
        if (cancelled) return;
        setUserFonts(fonts);
      } catch {
        /* 字体库不可用不阻塞阅读 */
      } finally {
        if (!cancelled) setUserFontsLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 旧设置只有 customFontName：元数据到达后尽量绑定到 imported id。
  useEffect(() => {
    if (settings.fontSource === "imported" && userFontsLoaded && settings.customFontId
      && !userFonts.some((font) => font.id === settings.customFontId)) {
      setSettings((previous) => ({ ...previous, fontSource: undefined, customFontName: undefined, customFontId: undefined }));
      return;
    }
    if (settings.fontSource || !settings.customFontName || !userFontsLoaded) return;
    const match = userFonts.find((font) => font.family === settings.customFontName);
    if (match) {
      setSettings((previous) => previous.fontSource || previous.customFontId
        ? previous
        : { ...previous, fontSource: "imported", customFontId: match.id });
    } else {
      setSettings((previous) => previous.fontSource || !previous.customFontName
        ? previous
        : { ...previous, customFontName: undefined, customFontId: undefined });
    }
  }, [settings.fontSource, settings.customFontName, settings.customFontId, userFonts, userFontsLoaded]);

  // 仅为当前选中的 imported 字体读文件并创建一个 Blob URL。
  useEffect(() => {
    const selectedId = settings.fontSource === "imported" ? settings.customFontId : undefined;
    const selected = selectedId ? userFonts.find((font) => font.id === selectedId) : undefined;
    const runtime = fontRuntimeRef.current!;
    let cancelled = false;
    void runtime.select(selected?.id).then((url) => {
      if (cancelled) return;
      setFontUrls(url && selected ? { [selected.id]: url } : {});
    }).catch(() => {
      // Controller keeps the previous URL alive when the replacement cannot be read.
      // The reader therefore remains usable while the panel can report the error.
    });
    return () => { cancelled = true; };
  }, [settings.fontSource, settings.customFontId, userFonts]);

  // 标题专用导入字体：仅在“标题与正文分开”且标题来源为 imported 时读文件。
  useEffect(() => {
    const selectedId = settings.splitHeadingFont === true && settings.headingFontSource === "imported"
      ? settings.headingFontId
      : undefined;
    const runtime = headingFontRuntimeRef.current!;
    let cancelled = false;
    void runtime.select(selectedId).then((url) => {
      if (!cancelled) setHeadingFontUrl(url);
    }).catch(() => {
      // 读取失败时保留上一张 URL，阅读器继续可用，字体页仍可重选。
    });
    return () => { cancelled = true; };
  }, [settings.splitHeadingFont, settings.headingFontSource, settings.headingFontId]);

  useEffect(() => () => {
    fontRuntimeRef.current?.dispose();
    headingFontRuntimeRef.current?.dispose();
    footnoteRuntime.dispose();
  }, [footnoteRuntime]);

  const selectImportedForRole = useCallback((role: FontRole, font: UserFont) => {
    const select = {
      body: settingsActions.selectImportedFont,
      heading: settingsActions.selectImportedHeadingFont,
      footnote: settingsActions.selectImportedFootnoteFont,
    };
    select[role](font);
  }, [settingsActions]);
  const importFontFile = useCallback(async (file: File, role: FontRole) => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const hash = await sha256Hex(bytes);
    const id = fontIdFromHash(hash);
    const family = fontFamilyFromFileName(file.name);
    const entry = await getFontStore().importFont({ id, fileName: file.name, family, bytes });
    setUserFonts((prev) => [entry, ...prev.filter((f) => f.id !== id)]);
    selectImportedForRole(role, entry);
  }, [selectImportedForRole]);

  // 本地文件与原生路径共用同一控制器：同一时刻只有一个在途批次，路径入口不再重入 busy。
  const fontImportRef = useRef<ReturnType<typeof createFontImportController> | null>(null);
  if (!fontImportRef.current) {
    fontImportRef.current = createFontImportController({
      store: getFontStore,
      importFile: importFontFile,
      onBusyChange: setFontBusy,
    });
  }

  const handleImportFonts = useCallback(async (files: File[], role: FontRole = "body") => {
    const result = await fontImportRef.current!.importFiles(files, role);
    if (result.kind === "busy") {
      setShelfNotice({ kind: "error", text: uiText("notice.font.busy") });
      return;
    }
    if (result.kind === "error") {
      setShelfNotice({ kind: "error", text: result.message });
      return;
    }
    if (result.unsupported > 0) {
      setShelfNotice({
        kind: "error",
        text: result.imported > 0
          ? uiText("notice.font.importedIgnored", { imported: result.imported, ignored: result.unsupported })
          : uiText("notice.font.ignoredOnly", { ignored: result.unsupported }),
      });
      return;
    }
    if (result.message) setShelfNotice({ kind: "ok", text: result.message });
  }, []);

  const handleImportFontPaths = useCallback(async (paths: string[], role: FontRole = "body") => {
    const result = await fontImportRef.current!.importPaths(paths);
    if (result.kind === "busy") {
      setShelfNotice({ kind: "error", text: uiText("notice.font.busy") });
      return;
    }
    if (result.kind === "error") {
      setShelfNotice({ kind: "error", text: result.message });
      return;
    }
    const entry = result.entry;
    if (entry) {
      setUserFonts((prev) => [entry, ...prev.filter((f) => f.id !== entry.id)]);
      selectImportedForRole(role, entry);
    }
    if (result.unsupported > 0) {
      setShelfNotice({
        kind: "error",
        text: result.imported > 0
          ? uiText("notice.font.importedIgnored", { imported: result.imported, ignored: result.unsupported })
          : uiText("notice.font.ignoredOnly", { ignored: result.unsupported }),
      });
      return;
    }
    if (result.message) setShelfNotice({ kind: "ok", text: result.message });
  }, [selectImportedForRole]);

  const handleDeleteFont = useCallback(
    async (id: string) => {
      const font = userFonts.find((f) => f.id === id);
      setFontBusy(true);
      try {
        await getFontStore().deleteFont(id);
        setUserFonts((prev) => prev.filter((f) => f.id !== id));
        setFontUrls((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
        if (font && settings.customFontId === id) {
          setSettings((s) => ({ ...s, fontSource: undefined, customFontId: undefined, customFontName: undefined }));
        }
        setSettings((current) => current.footnoteFontId === id
          ? { ...current, footnoteFontSource: undefined, footnoteFontName: undefined, footnoteFontId: undefined }
          : current);
        if (font && settings.headingFontId === id) {
          setSettings((s) => ({ ...s, headingFontSource: undefined, headingFontId: undefined, headingFontName: undefined }));
        }
      } catch (e) {
        setShelfNotice({ kind: "error", text: uiText("notice.font.deleteFailed", { error: String(e) }) });
      } finally {
        setFontBusy(false);
      }
    },
    [fontUrls, userFonts, settings.customFontId, settings.headingFontId]
  );

  // 只把当前正文/标题真正选中的导入字体交给渲染层，避免 @font-face 泄漏过期 URL。
  const bodyId = settings.fontSource === "imported" ? settings.customFontId : undefined;
  const bodyUrl = bodyId ? fontUrls[bodyId] : undefined;
  const bodyFamily = bodyId && userFonts.find((font) => font.id === bodyId)?.family;
  const headingId = settings.splitHeadingFont && settings.headingFontSource === "imported"
    ? settings.headingFontId : undefined;
  const headingFamily = headingId && userFonts.find((font) => font.id === headingId)?.family;
  const renderUserFonts = useMemo(() => {
    const list: Array<{ family: string; url: string }> = [];
    if (bodyFamily && bodyUrl) list.push({ family: bodyFamily, url: bodyUrl });
    if (headingFamily && headingFontUrl && headingId !== bodyId) {
      list.push({ family: headingFamily, url: headingFontUrl });
    }
    return list;
  }, [bodyId, bodyUrl, bodyFamily, headingId, headingFontUrl, headingFamily]);

  const loadSystemFonts = useCallback(async (): Promise<void> => {
    if (systemFontsStatus === "loading" || systemFontsStatus === "ready") return;
    setSystemFontsStatus("loading");
    setSystemFontsError(null);
    try {
      const fonts = await listSystemFonts();
      setSystemFonts(fonts);
      setSystemFontsStatus("ready");
    } catch (error) {
      setSystemFontsStatus("error");
      setSystemFontsError(String(error));
    }
  }, [systemFontsStatus]);

  return {
    userFonts,
    fontBusy,
    systemFonts,
    systemFontsStatus,
    systemFontsError,
    handleImportFonts,
    handleImportFontPaths,
    handleDeleteFont,
    renderUserFonts,
    footnoteFontUrl: importedFootnote?.id === footnoteId ? importedFootnote?.url : undefined,
    loadSystemFonts,
  };
}
