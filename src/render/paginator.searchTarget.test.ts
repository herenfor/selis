import { parseHTML } from "linkedom";
import { describe, expect, it } from "vitest";
import { dedupeHighlightRanges, resolveSearchTarget } from "./searchTarget";
import { searchBook } from "../core/search";
import { buildVisibleTextIndex, collectVisibleTextNodes } from "./textAnchor";
import { compileTextProjection } from "./textProjection/compile";
import { createDisplaySearchSession } from "./textProjection/displaySearch";
import { TextProjectionSession } from "./textProjection/session";
import type { Book } from "../core/types";

function fakeBook(chapters: string[]): Book {
  const spine = chapters.map((_, index) => ({ idref: `c${index}`, linear: true }));
  const manifest = new Map(chapters.map((_, index) => [
    `c${index}`,
    { id: `c${index}`, href: `Text/c${index}.xhtml`, mediaType: "application/xhtml+xml", properties: [] },
  ]));
  return {
    version: 3,
    opfPath: "OEBPS/content.opf",
    metadata: { title: "测试", identifier: "test", language: "zh" },
    manifest,
    spine,
    guide: [],
    toc: chapters.map((_, index) => ({ label: `第${index + 1}章`, href: `OEBPS/Text/c${index}.xhtml`, children: [] })),
    resources: new Map(chapters.map((content, index) => [
      `OEBPS/Text/c${index}.xhtml`,
      { path: `OEBPS/Text/c${index}.xhtml`, data: new TextEncoder().encode(content), mediaType: "application/xhtml+xml" },
    ])),
    fixedLayout: false,
    issues: [],
    drmProtected: false,
  };
}

interface FakeRange {
  startContainer: Node | null;
  startOffset: number;
  endContainer: Node | null;
  endOffset: number;
}

function installFakeRanges(doc: Document): void {
  (doc as unknown as { createRange: () => Range }).createRange = (() => {
    const range = {
      startContainer: null as Node | null,
      startOffset: 0,
      endContainer: null as Node | null,
      endOffset: 0,
      setStart(node: Node, offset: number) {
        this.startContainer = node;
        this.startOffset = offset;
      },
      setEnd(node: Node, offset: number) {
        this.endContainer = node;
        this.endOffset = offset;
      },
      toString: () => "",
    };
    return range as unknown as Range;
  }) as unknown as () => Range;
}

describe("projected search targets", () => {
  it("produces two different live DOM ranges for two display hits of one canonical replacement", async () => {
    const compiled = await compileTextProjection({
      mode: "original",
      rules: [{ id: "r1", from: "AB", to: "ZZ", enabled: true }],
    });
    const book = fakeBook(["<html><body><p>AB</p></body></html>"]);
    const session = createDisplaySearchSession(book, compiled, { yieldToHost: async () => {} });
    const results = await session.search("Z");
    expect(results).toHaveLength(2);

    const { document } = parseHTML("<html><body><epub-viewer id=\"epub-viewer\"><p>AB</p></epub-viewer></body></html>");
    const viewer = document.getElementById("epub-viewer") as HTMLElement;
    installFakeRanges(document as unknown as Document);

    const textProjection = new TextProjectionSession();
    const visibleNodes = collectVisibleTextNodes(document as unknown as Document, viewer);
    await textProjection.apply(visibleNodes, compiled);
    const canonicalIndex = buildVisibleTextIndex(document as unknown as Document, viewer, textProjection);

    const resolvedFor = (index: number) => resolveSearchTarget(document, viewer, canonicalIndex, {
      textHits: results[index].textHits,
      occurrence: results[index].occurrence,
      displayTarget: {
        projectionVersion: results[index].display!.projectionVersion,
        textHits: results[index].display!.textHits,
        occurrence: results[index].display!.occurrence,
      },
    }, compiled.version);

    const first = resolvedFor(0);
    const second = resolvedFor(1);
    expect(first?.anchorOffset).toBe(0);
    expect(second?.anchorOffset).toBe(0);
    const firstRange = first?.ranges?.[0] as unknown as FakeRange;
    const secondRange = second?.ranges?.[0] as unknown as FakeRange;
    expect(firstRange).toMatchObject({ startOffset: 0, endOffset: 1 });
    expect(secondRange).toMatchObject({ startOffset: 1, endOffset: 2 });
    expect(firstRange?.startContainer).toBe(secondRange?.startContainer);
    expect(firstRange?.startOffset).not.toBe(secondRange?.startOffset);
    session.dispose();
  });
});

describe("search highlight range drawing", () => {
  it("deduplicates identical ranges but keeps distinct/overlapping real hit ranges", () => {
    expect(dedupeHighlightRanges([
      { start: 0, end: 2 },
      { start: 0, end: 2 },
      { start: 0, end: 3 },
      { start: 3, end: 4 },
    ])).toEqual([
      { start: 0, end: 2 },
      { start: 0, end: 3 },
      { start: 3, end: 4 },
    ]);
  });
});


describe("ruby base-text search", () => {
  it("paints only the matching projected glyphs across a base and the following text", async () => {
    const compiled = await compileTextProjection({ mode: "original", rules: [{ id: "long", from: "A", to: "XYZ", enabled: true }] });
    const body = '<p>前<ruby>A<rtc><rt>reading</rt></rtc></ruby>后</p>';
    const session = createDisplaySearchSession(fakeBook([`<html><body>${body}</body></html>`]), compiled);
    const [hit] = await session.search("Z后");
    const { document } = parseHTML(`<html><body><main>${body}</main></body></html>`);
    const viewer = document.querySelector("main")!;
    installFakeRanges(document);
    const projection = new TextProjectionSession();
    await projection.apply(collectVisibleTextNodes(document, viewer), compiled);
    const index = buildVisibleTextIndex(document, viewer, projection);
    const request = { ...hit, displayTarget: hit.display };
    const resolved = resolveSearchTarget(document, viewer, index, request, compiled.version)!;
    expect(resolved.anchorOffset).toBe(1);
    expect(resolved.ranges?.map(r => r.startContainer.textContent!.slice(r.startOffset, r.endOffset))).toEqual(["Z", "后"]);
    expect(resolveSearchTarget(document, viewer, index, request, "outdated")).toBeNull();
    session.dispose();
  });

  it("maps cross-ruby hits and adjacent paragraphs to original DOM positions", async () => {
    const body = '<p>之前</p><p>也许是<ruby><rb>律😀</rb><rp>（</rp><rt>りつ</rt><rp>）</rp></ruby>你啊。</p><p>绝无可能。</p>';
    const book = fakeBook([`<html><body>${body}</body></html>`]);
    const { document } = parseHTML(`<html><body><main>${body}</main></body></html>`);
    installFakeRanges(document);
    const viewer = document.querySelector("main")!;
    const index = buildVisibleTextIndex(document, viewer);
    for (const query of ["之前", "律😀", "😀你啊", "绝无可能"]) {
      const [hit] = await searchBook(book, query);
      expect(hit?.occurrence).toBeDefined();
      const resolved = resolveSearchTarget(document, viewer, index, hit)!;
      const ranges = resolved.ranges as unknown as FakeRange[];
      expect(ranges.map(r => r.startContainer!.textContent!.slice(r.startOffset, r.endOffset)).join("")).toBe(query);
      expect(ranges.every(r => r.startContainer === r.endContainer)).toBe(true);
      expect(resolved.anchorOffset).toBe(index.codePoints.indexOf(Array.from(query)[0]));
    }
    expect(index.text).toContain("律😀（りつ）你啊");
  });
});
