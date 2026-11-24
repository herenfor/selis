import { describe, expect, it } from "vitest";
import { parseHTML } from "linkedom";
import { hasFullPageSpineProperty } from "./fullPageImage";
import { sanitizeChapter, VIEWER_ID } from "./sanitize";
import { DEFAULT_SETTINGS, type ReaderSettings } from "./settings";

function opts(settings: ReaderSettings = DEFAULT_SETTINGS, forceFullBleed = false) {
  return {
    basePath: "OEBPS/Text/ch1.xhtml",
    strictXml: true,
    urlFor: (p: string) => `blob:test/${p}`,
    settings,
    forceFullBleed,
  };
}

function styleText(out: string, marker: string): string {
  const { document } = parseHTML(out);
  return document.querySelector(`style[data-reader="${marker}"]`)?.textContent ?? "";
}

describe("hasFullPageSpineProperty", () => {
  it("accepts both Duokan full-page picture declarations", () => {
    expect(hasFullPageSpineProperty(["duokan-page-fullscreen"])).toBe(true);
    expect(hasFullPageSpineProperty(["duokan-page-fitwindow"])).toBe(true);
  });

  it("does not treat other spine properties as full-page art", () => {
    expect(hasFullPageSpineProperty(["cover-image", "page-spread-left"])).toBe(false);
    expect(hasFullPageSpineProperty([])).toBe(false);
    expect(hasFullPageSpineProperty(undefined)).toBe(false);
  });
});

describe("full-bleed picture pages", () => {
  const cover = `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>封面</title></head>
<body><div class="cover"><img alt="cover" src="cover.jpg"/></div></body></html>`;

  it("fills a paginated cover page edge to edge", async () => {
    const { html: out } = await sanitizeChapter(cover, opts());
    expect(out).toContain('data-reader-full-bleed=""');
    expect(out).toContain('class="fullpage-image"');
    expect(styleText(out, "full-bleed-image")).toContain(`#${VIEWER_ID}`);
    expect(styleText(out, "full-bleed-image")).toContain("width: 100% !important");
    expect(styleText(out, "full-bleed-image")).toContain("padding: 0 !important");
  });

  it("keeps page margins when the reader turns the switch off", async () => {
    const { html: out } = await sanitizeChapter(cover, opts({ ...DEFAULT_SETTINGS, fullBleedImages: false }));
    expect(out).toContain('class="fullpage-image"');
    expect(out).not.toContain("data-reader-full-bleed");
    expect(styleText(out, "full-bleed-image")).toBe("");
  });

  it("honours the Duokan spine declaration on a picture with authored dimensions", async () => {
    const html = `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>插图</title></head>
<body><div class="kuchie"><img alt="kuchie" src="kuchie.jpg" width="600" height="800"/></div></body></html>`;
    const without = await sanitizeChapter(html, opts());
    expect(without.html).not.toContain('data-reader-full-bleed');
    expect(without.html).not.toContain('class="fullpage-image"');

    const withSpine = await sanitizeChapter(html, opts(DEFAULT_SETTINGS, true));
    expect(withSpine.html).toContain('data-reader-full-bleed=""');
    expect(withSpine.html).toContain('class="fullpage-image"');
  });

  it("does not force a text chapter full screen", async () => {
    const html = `<html xmlns="http://www.w3.org/1999/xhtml"><body><p>正文</p><img alt="fig" src="fig.jpg"/></body></html>`;
    const { html: out } = await sanitizeChapter(html, opts(DEFAULT_SETTINGS, true));
    expect(out).not.toContain("data-reader-full-bleed");
    expect(out).not.toContain('class="fullpage-image"');
  });

  it("leaves two-page spreads to the existing pairing", async () => {
    const { html: out } = await sanitizeChapter(cover, opts({ ...DEFAULT_SETTINGS, columnsPerView: 2 }));
    expect(out).not.toContain("data-reader-full-bleed");
    expect(styleText(out, "full-bleed-image")).toBe("");
  });

  it("removes page margins and fills the width in scroll mode", async () => {
    const { html: out } = await sanitizeChapter(cover, opts({ ...DEFAULT_SETTINGS, readingMode: "scroll" }));
    expect(out).toContain('data-reader-full-bleed=""');
    expect(out).toContain('class="pure-image-page fullbleed-scroll"');
    const css = styleText(out, "full-bleed-image");
    expect(css).toContain(`#${VIEWER_ID}.fullbleed-scroll`);
    expect(css).toContain(`#${VIEWER_ID}.fullbleed-scroll img`);
    expect(css).toContain("width: 100% !important");
    expect(css).toContain("height: auto !important");
    expect(css).not.toContain("height: 100% !important");
  });
});
