import { describe, expect, it } from "vitest";
import { parseHTML } from "linkedom";
import { findMultiImageGroups, hasCollageAuthorCss, multiImageGroupCss } from "./imageGroup";

function groups(
  bodyHtml: string,
  options: { chapterHasText?: boolean; authorCollageCss?: boolean } = {},
) {
  const { document } = parseHTML(
    `<html><body><epub-viewer id="epub-viewer">${bodyHtml}</epub-viewer></body></html>`,
  );
  const viewer = document.querySelector("#epub-viewer");
  if (!viewer) throw new Error("viewer missing");
  return findMultiImageGroups(viewer, {
    chapterHasText: options.chapterHasText ?? false,
    authorCollageCss: options.authorCollageCss ?? false,
  });
}

const two = `<img src="a.png"/><img src="b.png"/>`;

describe("findMultiImageGroups", () => {
  it("marks a text-free plain duokan-image-single group", () => {
    const found = groups(`<div class="duokan-image-single">${two}</div>`);
    expect(found).toHaveLength(1);
    expect(found[0].images).toHaveLength(2);
  });

  it("marks a text-free .illus group", () => {
    expect(groups(`<div class="illus duokan-image-single">${two}</div>`)).toHaveLength(1);
  });

  it("marks a nested group inside a wrapper", () => {
    expect(groups(`<div class="calibre"><div class="duokan-image-single">${two}</div></div>`)).toHaveLength(1);
  });

  it("only converts .illus blocks in a chapter with text", () => {
    expect(groups(`<p>正文</p><div class="duokan-image-single">${two}</div>`, { chapterHasText: true })).toHaveLength(0);
    expect(groups(`<p>正文</p><div class="illus duokan-image-single">${two}</div>`, { chapterHasText: true })).toHaveLength(1);
  });

  it("keeps captions, links, extra elements and text out of the conversion", () => {
    expect(groups(`<div class="duokan-image-single">${two}<p>图注</p></div>`)).toHaveLength(0);
    expect(groups(`<div class="duokan-image-single">${two}<br/></div>`)).toHaveLength(0);
    expect(groups(`<div class="duokan-image-single">${two}说明</div>`)).toHaveLength(0);
    expect(groups(`<a href="x.xhtml"><div class="duokan-image-single">${two}</div></a>`)).toHaveLength(0);
    expect(groups(`<div class="duokan-image-single"><a href="x.xhtml">${two}</a></div>`)).toHaveLength(0);
  });

  it("keeps a single picture and non-exact class names alone", () => {
    expect(groups(`<div class="duokan-image-single"><img src="a.png"/></div>`)).toHaveLength(0);
    expect(groups(`<div class="duokan-image-single-wide">${two}</div>`)).toHaveLength(0);
    expect(groups(`<div class="duokan-image-single-">${two}</div>`)).toHaveLength(0);
  });

  it("keeps authored cover/colour-page containers alone", () => {
    for (const cls of ["cover", "kuchie", "duokan-image-fullscreen"]) {
      expect(groups(`<div class="${cls} duokan-image-single">${two}</div>`), cls).toHaveLength(0);
    }
  });

  it("keeps authored fixed sizes and collage declarations", () => {
    expect(groups(`<div class="duokan-image-single"><img src="a.png" width="300"/><img src="b.png"/></div>`)).toHaveLength(0);
    expect(groups(`<div class="duokan-image-single"><img src="a.png" style="width:50%"/><img src="b.png"/></div>`)).toHaveLength(0);
    expect(groups(`<div class="duokan-image-single"><img src="a.png" style="height:20em"/><img src="b.png"/></div>`)).toHaveLength(0);
    expect(groups(`<div class="duokan-image-single" style="width:50%">${two}</div>`)).toHaveLength(0);
    expect(groups(`<div class="duokan-image-single" style="display:flex">${two}</div>`)).toHaveLength(0);
    // Fluid declarations follow the reader's page instead of pinning a size.
    expect(groups(`<div class="duokan-image-single" style="width:100%"><img src="a.png" style="width:100%"/><img src="b.png"/></div>`)).toHaveLength(1);
  });

  it("keeps groups alone when the author stylesheet asks for a row layout", () => {
    expect(groups(`<div class="duokan-image-single">${two}</div>`, { authorCollageCss: true })).toHaveLength(0);
  });
});

describe("hasCollageAuthorCss", () => {
  it("recognises authored row/grid/sized layouts", () => {
    expect(hasCollageAuthorCss([".duokan-image-single img { width: 50% }"])).toBe(true);
    expect(hasCollageAuthorCss([".illus { display: flex; }"])).toBe(true);
    expect(hasCollageAuthorCss([".illus img { float: left }"])).toBe(true);
    expect(hasCollageAuthorCss(["img { width: 50% }"])).toBe(true);
    expect(hasCollageAuthorCss(["@media (min-width: 600px) { .duokan-image-single { display: grid } }"])).toBe(true);
  });

  it("ignores ordinary template rules and the reader's own fluid defaults", () => {
    expect(hasCollageAuthorCss([".duokan-image-single { margin: 1em 0; text-align: center; }"])).toBe(false);
    expect(hasCollageAuthorCss([".illus { text-indent: 0em; text-align: center; }"])).toBe(false);
    expect(hasCollageAuthorCss(["img { max-width: 100%; }"])).toBe(false);
    expect(hasCollageAuthorCss([".duokan-image-single { width: 100%; display: block; }"])).toBe(false);
    expect(hasCollageAuthorCss([".my-illus { display: flex }"])).toBe(false);
    expect(hasCollageAuthorCss(["/* .illus { display: flex } */"])).toBe(false);
  });
});

describe("multiImageGroupCss", () => {
  it("lays one picture per column with the single-picture page height", () => {
    const css = multiImageGroupCss("epub-viewer");
    expect(css).toContain("#epub-viewer:not([data-reader-vertical]) div[data-reader-image-group]");
    expect(css).toContain("height: var(--reader-page-height, 100%) !important");
    expect(css).toContain("object-fit: contain");
    expect(css).toContain("break-after: column");
    expect(css).toContain("> img:last-child");
    expect(css).toContain("break-after: auto");
  });
});
