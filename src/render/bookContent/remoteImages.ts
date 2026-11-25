import { invoke } from "@tauri-apps/api/core";
import { resolveArchiveHref } from "../../core/archiveReferences";
import { cssResourceReferences } from "../cssRewrite";
import type { SanitizeOptions } from "../sanitize";
import { externalResource, remoteImageAddress } from "./permissions";

const MAX_IMAGES = 4;
const MAX_STYLESHEETS = 32;
const sessions = new WeakMap<AbortSignal, Map<string, Promise<ArrayBuffer | undefined>>>();

type ImageCandidate = { href: string; descriptor: string };
/** The URL token can include a comma (for example in data URLs). */
export function imageCandidates(srcset: string): ImageCandidate[] {
  const candidates: ImageCandidate[] = [];
  let remaining = srcset;
  while (remaining && candidates.length < 32) {
    remaining = remaining.replace(/^[\s,]+/, "");
    const url = /^\S+/.exec(remaining)?.[0];
    if (!url) break;
    remaining = remaining.slice(url.length);
    const part = url.endsWith(",") ? "" : /^[^,]*/.exec(remaining)![0];
    remaining = remaining.slice(part.length);
    const descriptor = part.trim();
    if (!descriptor || /^(?:\d+w|\d+(?:\.\d+)?x|\.\d+x)$/.test(descriptor)) {
      candidates.push({ href: url.replace(/,+$/, ""), descriptor });
    }
  }
  return candidates;
}

function imageAddresses(doc: Document, options: SanitizeOptions): string[] {
  const addresses = new Set<string>();
  const styles = new Set<string>();
  const collect = (raw: string | null) => {
    const href = remoteImageAddress(raw?.trim() ?? "");
    if (href && addresses.size < MAX_IMAGES) addresses.add(href);
  };
  function stylesheet(path: string, href: string): void {
    if (externalResource(href) || styles.size >= MAX_STYLESHEETS || addresses.size >= MAX_IMAGES) return;
    const key = resolveArchiveHref(options.archiveReferences, path, href).path;
    if (styles.has(key)) return;
    styles.add(key);
    css(key, options.getText?.(key) ?? "");
  }
  function css(path: string, text: string): void {
    for (const ref of cssResourceReferences(text)) {
      if (ref.stylesheet) stylesheet(path, ref.href);
      else collect(ref.href);
    }
  }
  for (const node of Array.from(doc.getElementsByTagName("*"))) {
    if (addresses.size >= MAX_IMAGES) break;
    const tag = node.localName.toLowerCase();
    // <noscript> 回退内容在 JavaScript 关闭时是可见的，里面的远程图也应参与取图；
    // 开启 JavaScript 时 sanitizeChapter 会先移除 <noscript>，这里不会再看到它。
    if (node.closest("iframe,frame,object,embed,template,form")) continue;
    if (tag === "img") collect(node.getAttribute("src"));
    if (tag === "video") collect(node.getAttribute("poster"));
    if (tag === "image") collect(node.getAttribute("href") ?? node.getAttribute("xlink:href"));
    if (tag === "img" || tag === "source") {
      for (const candidate of imageCandidates(node.getAttribute("srcset") ?? "")) collect(candidate.href);
    }
    if (tag === "link" && /(?:^|\s)stylesheet(?:\s|$)/i.test(node.getAttribute("rel") ?? "")) {
      stylesheet(options.basePath, node.getAttribute("href") ?? "");
    }
    if (tag === "style") css(options.basePath, node.textContent ?? "");
    const style = node.getAttribute("style");
    if (style) css(options.basePath, style);
  }
  return [...addresses];
}

function loadImage(url: string, signal: AbortSignal): Promise<ArrayBuffer | undefined> {
  if (signal.aborted) return Promise.resolve(undefined);
  const requestId = crypto.randomUUID();
  const request = invoke<ArrayBuffer>("book_remote_image", { url, requestId }).catch(() => undefined);
  return new Promise(resolve => {
    const abort = () => {
      void invoke("cancel_book_remote_image", { requestId }).catch(() => {});
      resolve(undefined);
    };
    signal.addEventListener("abort", abort, { once: true });
    void request.then(buffer => {
      signal.removeEventListener("abort", abort);
      resolve(signal.aborted ? undefined : buffer);
    });
  });
}

/** Leases for the resulting Blob URLs remain with the ChapterPaginator load. */
export async function prepareBookImages(doc: Document, options: SanitizeOptions, signal: AbortSignal) {
  const urls = new Map<string, string>();
  if (!options.makeImageUrl || signal.aborted) return urls;
  let session = sessions.get(signal);
  if (!session) {
    session = new Map();
    sessions.set(signal, session);
    signal.addEventListener("abort", () => sessions.delete(signal), { once: true });
  }
  await Promise.all(imageAddresses(doc, options).map(async url => {
    let pending = session.get(url);
    if (!pending) {
      if (session.size >= MAX_IMAGES) return;
      pending = loadImage(url, signal);
      session.set(url, pending);
    }
    const buffer = await pending;
    if (buffer?.byteLength && !signal.aborted) urls.set(url, options.makeImageUrl!(buffer));
  }));
  return urls;
}
