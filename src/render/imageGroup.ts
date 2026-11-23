import { stripCssComments } from "./cssRewrite";
import { childElements, localNameOf, type XmlElementLike } from "../core/xml";

/**
 * Issue #15: a Duokan single-picture container (`div.duokan-image-single`) that
 * holds two or more direct `<img>` children.
 *
 * The paginator has no page model for such a group: `.illus` makes it a flex
 * row whose pictures overflow the column (cropped edges plus a ghost page),
 * and a plain container leaves each picture in the text flow with large side
 * margins. The safe fix is to treat every picture in the group as one picture
 * page, reusing the single-picture sizing (column width, page height,
 * `object-fit: contain`) instead of building a second renderer.
 *
 * This module only *identifies* the groups that may become picture pages. It
 * is deliberately conservative: an authored size, a caption, a link, a
 * cover/kuchie/fullscreen class, or an author stylesheet that asks for a row
 * or grid layout keeps the original structure. The CSS that lays out a marked
 * group lives here too, so the marker and its layout cannot drift apart.
 */

const GROUP_CLASS = "duokan-image-single";
const ILLUS_CLASS = "illus";
/** Authored cover/colour-page layouts stay untouched. */
const EXCLUDED_FULLPAGE_CLASSES = new Set(["cover", "kuchie", "duokan-image-fullscreen"]);

export interface MultiImageGroupOptions {
  /** A chapter with any text only converts explicit `.illus` illustration blocks. */
  readonly chapterHasText: boolean;
  /** The chapter's author stylesheets ask for a row/grid layout somewhere. */
  readonly authorCollageCss: boolean;
}

export interface MultiImageGroup {
  readonly element: XmlElementLike;
  readonly images: readonly XmlElementLike[];
}

const SIZING_PROPERTIES = new Set([
  "width",
  "height",
  "max-width",
  "max-height",
  "min-width",
  "min-height",
]);

/** Values that follow the container instead of pinning an authored size. */
const FLUID_SIZE_RE = /^(?:auto|none|inherit|initial|unset|0(?:px|%)?|100(?:\.0+)?%)$/u;

const LAYOUT_PROPERTIES = new Set([
  "width",
  "max-width",
  "display",
  "float",
  "grid-template-columns",
  "grid-template-rows",
  "grid-auto-flow",
  "column-count",
  "columns",
  "flex-direction",
  "flex-wrap",
]);

const GROUP_SELECTOR_RE = /(?:^|[^\w-])(?:duokan-image-single|illus)(?:[^\w-]|$)/iu;
const BARE_IMAGE_SELECTOR_RE = /^\s*(?:img|svg)\s*$/iu;

function classTokens(el: XmlElementLike): string[] {
  return (el.getAttribute("class") ?? "").split(/\s+/u).filter(Boolean);
}

function hasClass(el: XmlElementLike, name: string): boolean {
  return classTokens(el).includes(name);
}

/** `a { width: 50% }` style declarations, without comments or `!important`. */
function declarations(style: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const part of stripCssComments(style).split(";")) {
    const colon = part.indexOf(":");
    if (colon < 0) continue;
    const property = part.slice(0, colon).trim().toLowerCase();
    const value = part
      .slice(colon + 1)
      .replace(/!\s*important/giu, "")
      .trim()
      .toLowerCase();
    if (property && value) out.push([property, value]);
  }
  return out;
}

/** A declaration that asks the pictures to sit in a row/grid at an authored size. */
function isCollageDeclaration(property: string, value: string): boolean {
  if (!LAYOUT_PROPERTIES.has(property)) return false;
  if (property === "display") {
    return /^(?:flex|inline-flex|grid|inline-grid|inline-block|table|table-row|table-cell)$/u.test(value);
  }
  if (property === "float") return value !== "none";
  if (property === "width" || property === "max-width") return !FLUID_SIZE_RE.test(value);
  if (property === "grid-template-columns" || property === "grid-template-rows") return value !== "none";
  if (property === "grid-auto-flow") return value !== "row";
  if (property === "column-count") return value !== "auto" && value !== "1";
  if (property === "columns") return value !== "auto";
  if (property === "flex-direction") return /^row(?:-reverse)?$/u.test(value);
  // flex-wrap
  return /^wrap(?:-reverse)?$/u.test(value);
}

/**
 * True when an author stylesheet could be arranging pictures side by side.
 * Selectors that mention the group classes (or a bare `img`/`svg` rule) are
 * checked; a reader-injected rule never reaches this scan.
 */
export function hasCollageAuthorCss(texts: readonly string[]): boolean {
  for (const text of texts) {
    for (const match of stripCssComments(text).matchAll(/([^{}]*)\{([^{}]*)\}/gu)) {
      const selector = match[1].trim();
      if (!selector || selector.startsWith("@")) continue;
      if (!GROUP_SELECTOR_RE.test(selector) && !BARE_IMAGE_SELECTOR_RE.test(selector)) continue;
      if (declarations(match[2]).some(([property, value]) => isCollageDeclaration(property, value))) {
        return true;
      }
    }
  }
  return false;
}

/** Authored width/height on a picture: a fixed or percentage size is a layout clue. */
function hasAuthoredImageSize(el: XmlElementLike): boolean {
  if ((el.getAttribute("width") ?? "").trim() || (el.getAttribute("height") ?? "").trim()) return true;
  return declarations(el.getAttribute("style") ?? "").some(
    ([property, value]) => SIZING_PROPERTIES.has(property) && !FLUID_SIZE_RE.test(value),
  );
}

function hasAuthoredGroupLayout(el: XmlElementLike): boolean {
  return declarations(el.getAttribute("style") ?? "").some(([property, value]) =>
    isCollageDeclaration(property, value),
  );
}

function isEligibleGroup(el: XmlElementLike, options: MultiImageGroupOptions): boolean {
  if (localNameOf(el) !== "div") return false;
  if (!hasClass(el, GROUP_CLASS)) return false;
  if (classTokens(el).some((token) => EXCLUDED_FULLPAGE_CLASSES.has(token))) return false;
  const children = childElements(el);
  if (children.length < 2) return false;
  if (!children.every((child) => localNameOf(child) === "img")) return false;
  if ((el.textContent ?? "").trim() !== "") return false;
  if (hasAuthoredGroupLayout(el)) return false;
  if (options.authorCollageCss) return false;
  for (const image of children) {
    if (hasAuthoredImageSize(image)) return false;
  }
  // A text-free chapter is exactly the reproduction structure; a mixed chapter
  // only converts an explicit `.illus` illustration block.
  return !options.chapterHasText || hasClass(el, ILLUS_CLASS);
}

function collectGroups(
  root: XmlElementLike,
  options: MultiImageGroupOptions,
  insideLink: boolean,
  out: MultiImageGroup[],
): void {
  for (const child of childElements(root)) {
    const linked = insideLink || localNameOf(child) === "a";
    if (!linked && isEligibleGroup(child, options)) {
      out.push({ element: child, images: childElements(child) });
      continue;
    }
    collectGroups(child, options, linked, out);
  }
}

export function findMultiImageGroups(
  viewer: XmlElementLike,
  options: MultiImageGroupOptions,
): MultiImageGroup[] {
  const out: MultiImageGroup[] = [];
  collectGroups(viewer, options, false, out);
  return out;
}

/**
 * Layout for a marked group: one picture per column, each filling the column
 * with the same contain sizing as a single picture page. `--reader-page-height`
 * is written by the paginator; the `100%` fallback keeps the rule harmless
 * when a host measures without that variable.
 */
export function multiImageGroupCss(viewerId: string): string {
  return `/* [L3] 多看单图容器内的多图组（Issue #15）：每图一页，逐栏排列。
   仅 imageGroup.ts 判定为纯图章或 .illus 插图块时打标记；图注、链接、
   作者拼图、封面/彩页与固定版式不进入这里。 */
#${viewerId}:not([data-reader-vertical]) div[data-reader-image-group] {
  display: block !important;
  width: 100% !important;
  height: auto !important;
  max-width: none !important;
  margin: 0 !important;
  padding: 0 !important;
  box-sizing: border-box !important;
  break-inside: auto;
}
#${viewerId}:not([data-reader-vertical]) div[data-reader-image-group] > img {
  display: block !important;
  width: 100% !important;
  height: var(--reader-page-height, 100%) !important;
  min-width: 0 !important;
  min-height: 0 !important;
  max-width: none !important;
  max-height: none !important;
  margin: 0 !important;
  padding: 0 !important;
  border: none !important;
  box-sizing: border-box !important;
  object-fit: contain;
  break-inside: avoid;
  break-after: column;
}
#${viewerId}:not([data-reader-vertical]) div[data-reader-image-group] > img:last-child {
  break-after: auto;
}`;
}
