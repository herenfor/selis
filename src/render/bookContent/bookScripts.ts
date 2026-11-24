import { resolveArchiveHref } from "../../core/archiveReferences";
import type { SanitizeOptions } from "../sanitize";
import type { BookContentPermissions } from "./permissions";
import { externalResource } from "./permissions";
import type { ScriptChange, ScriptElement } from "./scriptModel";

const MAX_SOURCE = 128 * 1024;
const MAX_ELEMENTS = 1500;
const TEXT_TARGETS = new Set(["b", "div", "em", "i", "li", "p", "small", "span", "strong"]);

export async function readBookScripts(doc: Document, options: SanitizeOptions, signal: AbortSignal): Promise<string[]> {
  const sources: string[] = [];
  let size = 0;
  for (const node of Array.from(doc.getElementsByTagName("script")).slice(0, 16)) {
    if (signal.aborted) break;
    if (node.namespaceURI && node.namespaceURI !== "http://www.w3.org/1999/xhtml") continue;
    if (node.closest("iframe,template,object,embed,form,noscript")) continue;
    if (!/^(?:|text\/(?:java|ecma)script|application\/(?:java|ecma)script)$/i.test(node.getAttribute("type")?.trim() ?? "")) continue;
    const src = node.getAttribute("src")?.trim();
    const source = src
      ? externalResource(src) || src.startsWith("#") ? undefined
        : await options.readScript?.(resolveArchiveHref(options.archiveReferences, options.basePath, src).path, signal).catch(() => undefined)
      : node.textContent;
    if (!source) continue;
    size += source.length;
    if (size > MAX_SOURCE) break;
    sources.push(source);
  }
  return sources;
}

function run(elements: ScriptElement[], scripts: string[], signal: AbortSignal): Promise<string | null> {
  if (signal.aborted || typeof Worker === "undefined") return Promise.resolve(null);
  return new Promise(resolve => {
    let worker: Worker;
    try { worker = new Worker(new URL("./bookScript.worker.ts", import.meta.url), { type: "module" }); }
    catch { resolve(null); return; }
    const timer = setTimeout(() => close(null), 3000);
    const stop = () => close(null);
    function close(value: string | null) {
      clearTimeout(timer);
      signal.removeEventListener("abort", stop);
      worker.terminate();
      resolve(value);
    }
    worker.onmessage = event => close(typeof event.data === "string" ? event.data : null);
    worker.onerror = stop;
    signal.addEventListener("abort", stop, { once: true });
    worker.postMessage({ elements, scripts });
  });
}

/** Only plain text in empty author placeholders is rendered. Existing text and its anchors stay intact. */
export async function applyBookScripts(doc: Document, scripts: string[], permissions: BookContentPermissions): Promise<void> {
  if (!scripts.length || permissions.signal.aborted) return;
  const nodes = Array.from((doc.body ?? doc.documentElement).getElementsByTagName("*")).slice(0, MAX_ELEMENTS)
    .filter(node => TEXT_TARGETS.has(node.localName.toLowerCase()) && !node.closest("svg,math,style"));
  const elements = nodes.map(node => ({ tag: node.localName.toLowerCase(), id: (node.getAttribute("id") ?? "").slice(0, 256),
    className: (node.getAttribute("class") ?? "").slice(0, 512),
    text: Array.from(node.childNodes).filter(child => child.nodeType === 3).map(child => child.nodeValue).join("").slice(0, 512),
    hidden: node.hasAttribute("hidden") }));
  const result = await run(elements, scripts, permissions.signal);
  if (!result || result.length > MAX_SOURCE || permissions.signal.aborted) return;
  let changes: ScriptChange[];
  try { changes = JSON.parse(result); } catch { return; }
  if (!Array.isArray(changes) || changes.length > MAX_ELEMENTS) return;
  for (const change of changes) {
    if (!change || !Number.isInteger(change.index)) continue;
    const node = nodes[change.index];
    if (!node) continue;
    if (!node.hasChildNodes() && typeof change.text === "string" && change.text.length <= 4096) node.textContent = change.text;
    if (typeof change.className === "string" && change.className.length <= 512) node.setAttribute("class", change.className);
    if (typeof change.hidden === "boolean") {
      if (change.hidden) node.setAttribute("hidden", "");
      else node.removeAttribute("hidden");
    }
  }
}
