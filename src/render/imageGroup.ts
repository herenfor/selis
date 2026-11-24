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
 * is deliberately conservative: a caption, a link, a cover/kuchie/fullscreen
 * class, or an author rule **that actually matches this group or its pictures**
 * and asks for a row, grid or authored picture size keeps the original
 * structure. An explicit gallery body (`gal`/`gallery`/`postcard`) is the one
 * exception: `.cover` postcard groups and thumbnail widths are converted;
 * kuchie/fullscreen, links, captions, inline sizes and author row/grid/float
 * rules still veto. A rule elsewhere in the book for a different container
 * must not veto the fix, and a class-based picture size (`img.half { width:
 * 49% }`) must be honoured — so author CSS is matched against the real
 * ancestor chain instead of being scanned for class names.
 *
 * The CSS that lays out a marked group lives here too, so the marker and its
 * layout cannot drift apart.
 */

const GROUP_CLASS = "duokan-image-single";
const ILLUS_CLASS = "illus";
/** Authored cover/colour-page layouts stay untouched. */
const EXCLUDED_FULLPAGE_CLASSES = new Set(["cover", "kuchie", "duokan-image-fullscreen"]);
/** In an explicit gallery, `.cover` is a postcard group; real fullscreen pages still stay. */
const GALLERY_EXCLUDED_FULLPAGE_CLASSES = new Set(["kuchie", "duokan-image-fullscreen"]);
const GALLERY_BODY_CLASS_RE = /(?:^|\s)(?:gal|gallery|postcard)(?:\s|$)/u;

/** One author rule flattened out of `<style>`/stylesheet text (at-rules included). */
export interface AuthorCssRule {
  readonly selectors: readonly string[];
  /** A declaration that makes the container itself arrange pictures. */
  readonly collageForGroup: boolean;
  /** A declaration that puts the pictures side by side or pins their size. */
  readonly collageForImage: boolean;
  /** Image-level flex/grid/table/float: still a deliberate row inside a gallery. */
  readonly layoutForImage: boolean;
}

export interface MultiImageGroupOptions {
  /** A chapter with any text only converts explicit `.illus` illustration blocks. */
  readonly chapterHasText: boolean;
  /** Author rules from this chapter's stylesheets, already flattened. */
  readonly authorRules: readonly AuthorCssRule[];
  /** Explicit Duokan gallery body (`gal`/`gallery`/`postcard`): allow `.cover` groups and thumbnail widths. */
  readonly galleryChapter?: boolean;
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

function classTokens(el: XmlElementLike): string[] {
  return (el.getAttribute("class") ?? "").split(/\s+/u).filter(Boolean);
}

function hasClass(el: XmlElementLike, name: string): boolean {
  return classTokens(el).includes(name);
}

/** Conservative gallery signal: only an explicit body class, never guessed from layout. */
export function isGalleryChapterBodyClass(value: string | null | undefined): boolean {
  return GALLERY_BODY_CLASS_RE.test(value ?? "");
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

type CollageSubject = "group" | "image";

/**
 * A declaration that asks pictures to sit side by side at an authored size.
 * The container only counts when it is itself a row/grid container; a fixed
 * width on the container just narrows the column, so it is not a collage.
 */
function isCollageDeclaration(property: string, value: string, subject: CollageSubject): boolean {
  if (property === "float") return value !== "none";
  if (property === "display") {
    if (subject === "group") {
      return /^(?:flex|inline-flex|grid|inline-grid|table|table-row|table-cell)$/u.test(value);
    }
    return /^(?:inline|inline-block|inline-flex|inline-grid|table-cell)$/u.test(value);
  }
  if (property === "width" || property === "max-width" || property === "min-width") {
    // Pictures pinned to an authored size are a comparison/collage layout.
    return subject === "image" && !FLUID_SIZE_RE.test(value);
  }
  if (subject === "image") return false;
  if (property === "grid-template-columns" || property === "grid-template-rows") return value !== "none";
  if (property === "grid-auto-flow") return value !== "row";
  if (property === "column-count") return value !== "auto" && value !== "1";
  if (property === "columns") return value !== "auto";
  if (property === "flex-direction") return /^row(?:-reverse)?$/u.test(value);
  // flex-wrap
  return /^wrap(?:-reverse)?$/u.test(value);
}

/** Image-level layout that still vetoes a gallery conversion (not a thumbnail width). */
function isImageLayoutDeclaration(property: string, value: string): boolean {
  if (property === "float") return value !== "none";
  if (property === "display") return /^(?:flex|inline-flex|grid|inline-grid|table|table-cell)$/u.test(value);
  return false;
}

/**
 * Flattens authored stylesheet text into selectors + collage flags. Rules
 * inside `@media`/`@supports` are kept (treated as applicable) because a
 * conditional collage rule still means the author arranged the pictures.
 */
export function parseAuthorCss(texts: readonly string[]): AuthorCssRule[] {
  const rules: AuthorCssRule[] = [];
  for (const text of texts) {
    for (const match of stripCssComments(text).matchAll(/([^{}]*)\{([^{}]*)\}/gu)) {
      const selectorText = match[1].trim();
      if (!selectorText || selectorText.startsWith("@")) continue;
      const decls = declarations(match[2]);
      if (decls.length === 0) continue;
      const selectors = selectorText.split(",").map((part) => part.trim()).filter(Boolean);
      if (selectors.length === 0) continue;
      rules.push({
        selectors,
        collageForGroup: decls.some(([property, value]) => isCollageDeclaration(property, value, "group")),
        collageForImage: decls.some(([property, value]) => isCollageDeclaration(property, value, "image")),
        layoutForImage: decls.some(([property, value]) => isImageLayoutDeclaration(property, value)),
      });
    }
  }
  return rules;
}

/** Minimal element facts for selector matching; ancestors are nearest-first. */
interface SelectorFacts {
  readonly tag: string;
  readonly classes: ReadonlySet<string>;
  readonly id: string;
  readonly ancestors: readonly SelectorFacts[];
}

function parentElementOf(el: XmlElementLike): XmlElementLike | null {
  const parent = (el as unknown as { parentNode?: { nodeType: number } | null }).parentNode;
  return parent && parent.nodeType === 1 ? (parent as unknown as XmlElementLike) : null;
}

function factsOf(el: XmlElementLike, ancestors: readonly SelectorFacts[]): SelectorFacts {
  return {
    tag: localNameOf(el).toLowerCase(),
    classes: new Set(classTokens(el)),
    id: (el.getAttribute("id") ?? "").trim(),
    ancestors,
  };
}

function factsFrom(el: XmlElementLike): SelectorFacts {
  const nearestFirst: XmlElementLike[] = [];
  for (let parent = parentElementOf(el); parent; parent = parentElementOf(parent)) {
    nearestFirst.push(parent);
  }
  let ancestors: SelectorFacts[] = [];
  for (let i = nearestFirst.length - 1; i >= 0; i--) {
    ancestors = [factsOf(nearestFirst[i], ancestors), ...ancestors];
  }
  return factsOf(el, ancestors);
}

/** One compound selector: tag/`*`, `.class`, `#id`, `[attr]`, `[class~=v]`. */
function compoundMatches(compound: string, facts: SelectorFacts): boolean {
  let rest = compound.trim();
  if (!rest) return false;
  const tagMatch = /^([a-zA-Z][\w-]*|\*)/u.exec(rest);
  if (tagMatch) {
    const tag = tagMatch[1].toLowerCase();
    if (tag !== "*" && tag !== facts.tag) return false;
    rest = rest.slice(tagMatch[0].length).trimStart();
  }
  while (rest) {
    if (rest.startsWith(".")) {
      const match = /^\.([\w-]+)/u.exec(rest);
      if (!match || !facts.classes.has(match[1])) return false;
      rest = rest.slice(match[0].length);
      continue;
    }
    if (rest.startsWith("#")) {
      const match = /^#([\w-]+)/u.exec(rest);
      if (!match || facts.id !== match[1]) return false;
      rest = rest.slice(match[0].length);
      continue;
    }
    if (rest.startsWith("[")) {
      const match = /^\[([\w-]+)(?:~=["']?([^"'\]]*)["']?)?\]/u.exec(rest);
      // Unknown attribute forms are not guessed: treat as no match.
      if (!match) return false;
      const [, name, value] = match;
      if (value !== undefined) {
        if (name.toLowerCase() !== "class") return false;
        if (!facts.classes.has(value.trim())) return false;
      }
      rest = rest.slice(match[0].length);
      continue;
    }
    // Pseudo-classes/elements and combinators inside :not() need a real engine.
    return false;
  }
  return true;
}

interface ComplexSelector {
  readonly compounds: readonly string[];
  readonly combinators: readonly (" " | ">")[];
}

function splitSelector(selector: string): ComplexSelector | null {
  // Sibling combinators depend on document order we do not model. Attribute
  // selectors may contain `~=`, so strip them before the check.
  const bare = selector.replace(/\([^)]*\)|\[[^\]]*\]/gu, "");
  if (bare.includes("+") || bare.includes("~")) return null;
  const tokens = selector.replace(/>/gu, " > ").trim().split(/\s+/u).filter(Boolean);
  const compounds: string[] = [];
  const combinators: (" " | ">")[] = [];
  let pending: " " | ">" = " ";
  for (const token of tokens) {
    if (token === ">") {
      if (compounds.length === 0) return null;
      pending = ">";
      continue;
    }
    if (compounds.length > 0) combinators.push(pending);
    compounds.push(token);
    pending = " ";
  }
  if (compounds.length === 0) return null;
  return { compounds, combinators };
}

function selectorMatches(selector: string, facts: SelectorFacts): boolean {
  const parsed = splitSelector(selector);
  if (!parsed) return false;
  const { compounds, combinators } = parsed;
  let subject: SelectorFacts | null = facts;
  let index = compounds.length - 1;
  if (!compoundMatches(compounds[index], facts)) return false;
  index -= 1;
  while (index >= 0) {
    if (!subject) return false;
    const combinator = combinators[index];
    const target = compounds[index];
    if (combinator === ">") {
      const parent: SelectorFacts | null = subject.ancestors[0] ?? null;
      if (!parent || !compoundMatches(target, parent)) return false;
      subject = parent;
    } else {
      const parent: SelectorFacts | null =
        subject.ancestors.find((ancestor) => compoundMatches(target, ancestor)) ?? null;
      if (!parent) return false;
      subject = parent;
    }
    index -= 1;
  }
  return true;
}

/** True when an author rule matching this group or its pictures asks for collage. */
function hasCollageLayout(
  el: XmlElementLike,
  images: readonly XmlElementLike[],
  rules: readonly AuthorCssRule[],
  gallery: boolean,
): boolean {
  const relevant = rules.filter(
    (rule) => rule.collageForGroup || (gallery ? rule.layoutForImage : rule.collageForImage),
  );
  if (relevant.length === 0) return false;
  const groupFacts = factsFrom(el);
  const imageFacts = images.map((image) => factsOf(image, [groupFacts, ...groupFacts.ancestors]));
  for (const rule of relevant) {
    const imageLayout = gallery ? rule.layoutForImage : rule.collageForImage;
    for (const selector of rule.selectors) {
      if (imageLayout && imageFacts.some((facts) => selectorMatches(selector, facts))) return true;
      if (rule.collageForGroup && selectorMatches(selector, groupFacts)) return true;
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
    isCollageDeclaration(property, value, "group"),
  );
}

function isEligibleGroup(el: XmlElementLike, options: MultiImageGroupOptions): boolean {
  if (localNameOf(el) !== "div") return false;
  if (!hasClass(el, GROUP_CLASS)) return false;
  const gallery = options.galleryChapter === true;
  const excluded = gallery ? GALLERY_EXCLUDED_FULLPAGE_CLASSES : EXCLUDED_FULLPAGE_CLASSES;
  if (classTokens(el).some((token) => excluded.has(token))) return false;
  const children = childElements(el);
  if (children.length < 2) return false;
  if (!children.every((child) => localNameOf(child) === "img")) return false;
  if ((el.textContent ?? "").trim() !== "") return false;
  if (hasAuthoredGroupLayout(el)) return false;
  if (hasCollageLayout(el, children, options.authorRules, gallery)) return false;
  for (const image of children) {
    if (hasAuthoredImageSize(image)) return false;
  }
  // A text-free chapter is exactly the reproduction structure; a mixed chapter
  // only converts an explicit `.illus` illustration block. An explicit gallery
  // body is the one exception: its `.cover` postcard groups are the content.
  return gallery || !options.chapterHasText || hasClass(el, ILLUS_CLASS);
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
 * when a host measures without that variable. The container keeps an authored
 * width so a deliberately narrower illustration block stays narrower.
 */
export function multiImageGroupCss(viewerId: string): string {
  return `/* [L3] 多看单图容器内的多图组（Issue #15）：每图一页，逐栏排列。
   仅 imageGroup.ts 判定为纯图章或 .illus 插图块时打标记；图注、链接、
   作者拼图、封面/彩页与固定版式不进入这里。显式画廊章节（body.gal 等）
   的 .cover 明信片组除外，但仍保留 kuchie/fullscreen、链接、图注和作者
   行/网格/浮动规则。 */
#${viewerId}:not([data-reader-vertical]) div[data-reader-image-group] {
  display: block !important;
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
