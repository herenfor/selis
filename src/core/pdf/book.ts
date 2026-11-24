import type { PDFDocumentProxy, PDFDocumentLoadingTask } from "pdfjs-dist";
import type { Book, TocNode } from "../types";
import type { PdfSource } from "./range";

const CHAPTER = "__reader__/pdf.xhtml";
const CHUNK = 64 * 1024;

// Resolve the original outline hierarchy. Internal fragments use zero-based physical pages.
async function outline(doc: PDFDocumentProxy): Promise<TocNode[]> {
  type Items = NonNullable<Awaited<ReturnType<PDFDocumentProxy["getOutline"]>>>;
  async function convert(items: Items): Promise<TocNode[]> {
    const nodes: TocNode[] = [];
    for (const item of items) {
      let page = -1;
      try {
        const dest = typeof item.dest === "string" ? await doc.getDestination(item.dest) : item.dest;
        if (dest?.[0] != null) page = typeof dest[0] === "number" ? dest[0] : await doc.getPageIndex(dest[0]);
      } catch { /* A stale optional destination must not prevent reading. */ }
      const valid = Number.isInteger(page) && page >= 0 && page < doc.numPages;
      nodes.push({ label: item.title, href: valid ? `${CHAPTER}#page-${page}` : "", disabled: !valid, children: await convert(item.items) });
    }
    return nodes;
  }
  return convert(await doc.getOutline() ?? []);
}

async function raster(doc: PDFDocumentProxy, index: number, signal: AbortSignal): Promise<Blob> {
  signal.throwIfAborted();
  const page = await doc.getPage(index + 1);
  signal.throwIfAborted();
  const base = page.getViewport({ scale: 1 });
  const desiredWidth = Math.max(1024, Math.min(2400, window.innerWidth * window.devicePixelRatio));
  const scale = Math.min(desiredWidth / base.width, Math.sqrt(4_000_000 / (base.width * base.height)), 8192 / Math.max(base.width, base.height));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(viewport.width));
  canvas.height = Math.max(1, Math.ceil(viewport.height));
  try {
    const render = page.render({ canvas, viewport, background: "white" });
    const abort = () => render.cancel();
    signal.addEventListener("abort", abort, { once: true });
    try { await render.promise; } finally { signal.removeEventListener("abort", abort); }
    signal.throwIfAborted();
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error("PDF 页面绘制失败")), "image/png"));
    signal.throwIfAborted();
    return blob;
  } finally { canvas.width = canvas.height = 0; page.cleanup(); }
}

export async function loadPdfBook(source: PdfSource, fileName: string): Promise<Book> {
  let task: PDFDocumentLoadingTask | undefined;
  const lifetime = new AbortController();
  let fault: Error | undefined;
  function close() {
    if (lifetime.signal.aborted) return;
    lifetime.abort();
    source.close();
    void task?.destroy().catch(console.error);
  }
  try {
    const base = new URL("./pdfjs/", document.baseURI).href;
    const url = base + "pdf.min.mjs";
    const pdf: typeof import("pdfjs-dist") = await import(/* @vite-ignore */ url);
    pdf.GlobalWorkerOptions.workerSrc = base + "pdf.worker.min.mjs";
    let rejectRead!: (error: Error) => void;
    const failed = new Promise<never>((_, reject) => { rejectRead = reject; });
    let pending = Promise.resolve();
    class Range extends pdf.PDFDataRangeTransport {
      requestDataRange(begin: number, end: number) {
        pending = pending.then(async () => {
          if (lifetime.signal.aborted) return;
          const chunk = await source.read(begin, end);
          if (!lifetime.signal.aborted) this.onDataRange(begin, chunk);
        }).catch(reason => {
          if (lifetime.signal.aborted) return;
          fault = new Error(reason?.message ?? String(reason));
          rejectRead(fault); close();
        });
      }
    }
    const range = new Range(source.length, await source.read(0, Math.min(CHUNK, source.length)), true);
    task = pdf.getDocument({ range, rangeChunkSize: CHUNK, disableAutoFetch: true, disableStream: true,
      disableWorkerRendering: true, cMapUrl: base + "cmaps/", standardFontDataUrl: base + "standard_fonts/",
      wasmUrl: base + "wasm/", iccUrl: base + "iccs/" });
    const doc = await Promise.race([task.promise, failed]);
    const pages = Array.from({ length: doc.numPages }, (_, i) => ({ path: `pdf/page-${i + 1}`, doublePage: false }));
    const toc = await Promise.race([outline(doc).catch(() => []), failed]);
    let renderTail = Promise.resolve();
    return { sourceFormat: "pdf", version: 3, opfPath: "", metadata: { title: fileName.replace(/\.pdf$/i, ""), identifier: "", language: "" },
      manifest: new Map([["pages", { id: "pages", href: CHAPTER, properties: [], mediaType: "application/xhtml+xml" }]]),
      spine: [{ idref: "pages", linear: true }], guide: [], toc, resources: new Map(), fixedLayout: true, issues: [], drmProtected: false,
      comicPages: pages, archive: { close },
      pdfPage(index, signal) {
        // Bound simultaneous canvas allocation even when the user scrubs through many pages.
        const result = renderTail.then(async () => {
          if (fault) throw fault;
          lifetime.signal.throwIfAborted();
          return Promise.race([raster(doc, index, signal), failed]);
        });
        renderTail = result.then(() => {}, () => {});
        return result;
      },
    };
  } catch (error) {
    close();
    if ((error as Error)?.name === "PasswordException") throw new Error("暂不支持需要密码的 PDF");
    throw error;
  }
}
