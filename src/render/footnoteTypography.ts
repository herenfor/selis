import type { FootnoteInfo } from "./footnotes";
import { DEFAULT_SETTINGS } from "./settings";
import { mapCssUrls } from "./cssRewrite";
import { DEFAULT_FONT_FAMILY, escapeCssString } from "./sanitize";

const contentTags = new Set("a b bdi bdo blockquote br cite code dd div dl dt em figcaption figure i img kbd li mark ol p pre q rp rt ruby s samp small span strong sub sup table tbody td th tr u ul wbr".split(" "));
const ignoredTags = new Set(["style", "link", "script", "template"]);
const faceDescriptors = ["font-style", "font-weight", "font-stretch", "unicode-range", "font-feature-settings", "font-variation-settings", "size-adjust", "ascent-override", "descent-override", "line-gap-override"];
let nextScope = 0;

function familyKey(value: string): string {
  return value.trim().replace(/^(["'])(.*)\1$/, "$2").toLowerCase();
}

/** Only carry font data the chapter could load under its own font-src policy. */
function embeddedSources(style: CSSStyleDeclaration): string {
  const urls: string[] = [];
  mapCssUrls(style.getPropertyValue("src"), (token, href) => {
    if (/^(?:blob:|data:)/i.test(href)) urls.push(`url("${escapeCssString(href)}")`);
    return token;
  });
  return urls.join(", ");
}

function chapterFaces(doc: Document): Map<string, CSSStyleDeclaration[]> {
  const faces = new Map<string, CSSStyleDeclaration[]>();
  function visit(rules: CSSRuleList) {
    for (const rule of Array.from(rules)) {
      if (rule.type === CSSRule.FONT_FACE_RULE) {
        const { style } = rule as CSSFontFaceRule;
        const key = familyKey(style.getPropertyValue("font-family"));
        const entries = faces.get(key) ?? [];
        entries.push(style);
        faces.set(key, entries);
      } else if (rule.type === CSSRule.MEDIA_RULE && !doc.defaultView?.matchMedia((rule as CSSMediaRule).conditionText).matches) {
        continue;
      } else if (rule.type === CSSRule.SUPPORTS_RULE && !CSS.supports((rule as CSSSupportsRule).conditionText)) {
        continue;
      } else if ("cssRules" in rule) {
        visit((rule as CSSGroupingRule).cssRules);
      }
    }
  }
  // Chapter resource preparation has already flattened local @imports and rewritten URLs.
  for (const sheet of Array.from(doc.styleSheets)) {
    if (sheet.disabled || (sheet.ownerNode as Element | null)?.hasAttribute("data-reader")) continue;
    if (sheet.media.mediaText && !doc.defaultView?.matchMedia(sheet.media.mediaText).matches) continue;
    try { visit(sheet.cssRules); } catch { /* Inaccessible stylesheet: use reader fallback. */ }
  }
  return faces;
}

/** Make a display copy while the source note still has its authored cascade and live blob URLs. */
export function footnoteTypography(info: FootnoteInfo, marker: HTMLAnchorElement): { html: string; fontFaceCss: string } | undefined {
  const doc = info.target.ownerDocument;
  const view = doc.defaultView;
  if (!view?.getComputedStyle || !doc.styleSheets) return;
  const readStyle = view.getComputedStyle.bind(view);
  const faces = chapterFaces(doc);
  const aliases = new Map<string, string>();
  const scope = ++nextScope;
  const rules: string[] = [];
  function familyStack(stack: string): string {
    const tokens = stack.match(/(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^,"'])+/g) ?? [];
    const names = tokens.map((token) => {
      const key = familyKey(token);
      const entries = faces.get(key);
      if (!entries) return token.trim();
      let alias = aliases.get(key);
      if (!alias) {
        alias = `selis-footnote-${scope}-${aliases.size}`;
        aliases.set(key, alias);
        for (const entry of entries) {
          const src = embeddedSources(entry);
          if (!src) continue;
          const descriptors = faceDescriptors.filter((name) => entry.getPropertyValue(name))
            .map((name) => `${name}: ${entry.getPropertyValue(name)};`).join(" ");
          rules.push(`@font-face { font-family: ${alias}; src: ${src}; font-display: swap; ${descriptors} }`);
        }
      }
      return alias;
    }).filter(Boolean);
    const authored = names.join(", ");
    return authored && authored !== DEFAULT_FONT_FAMILY ? `${authored}, ${DEFAULT_FONT_FAMILY}` : DEFAULT_FONT_FAMILY;
  }

  const output = doc.implementation.createHTMLDocument("");
  function copy(source: Element, parentSize: number, root = false): HTMLElement {
    const tag = source.localName.toLowerCase();
    const el = output.createElement(root ? "div" : contentTags.has(tag) ? tag : "span");
    const style = readStyle(source);
    const size = Number.parseFloat(style.fontSize);
    const px = Number.isFinite(size) ? size : parentSize;
    el.style.fontSize = `${parentSize > 0 ? px / parentSize : 1}em`;
    el.style.fontFamily = `var(--footnote-font, ${familyStack(style.fontFamily)})`;
    el.style.fontStyle = style.fontStyle;
    el.style.fontWeight = style.fontWeight;
    for (const attr of ["lang", "dir", "title"]) {
      if (source.hasAttribute(attr)) el.setAttribute(attr, source.getAttribute(attr)!);
    }
    if (tag === "a") {
      const href = source.getAttribute("href") ?? "";
      // Some books wrap the entire note in a return link. A previously plain
      // note must still allow tapping its content to pin the card on touch.
      const wrapsPlainNote = !info.html && href === `#${marker.id}`
        && source.textContent?.replace(/\s+/g, " ").trim() === info.text;
      if (!wrapsPlainNote && /^(?:#|https?:|mailto:|tel:|\/\/)/i.test(href)) el.setAttribute("href", href);
    }
    if (tag === "img") {
      const src = source.getAttribute("src") ?? "";
      if (/^(?:blob:|data:image\/|https?:)/i.test(src)) el.setAttribute("src", src);
      el.setAttribute("alt", source.getAttribute("alt") ?? "");
    }
    if (source.classList.contains("duokan-footnote-content")) el.className = "duokan-footnote-content";
    if (tag === "ol" && source.hasAttribute("start")) el.setAttribute("start", source.getAttribute("start")!);
    if (tag === "li" && source.hasAttribute("value")) el.setAttribute("value", source.getAttribute("value")!);
    for (const child of Array.from(source.childNodes)) {
      if (child.nodeType === 3) el.append(child.textContent ?? "");
      else if (child.nodeType === 1 && !ignoredTags.has((child as Element).localName)) el.append(copy(child as Element, px));
    }
    return el;
  }
  // Sample at the reader's design size so authored px and em both scale with the
  // reading size. Only reader font rules are gated; the chapter isn't repaginated.
  const root = doc.documentElement;
  root.setAttribute("data-reader-sample-fonts", "");
  try {
    const content = copy(info.target, DEFAULT_SETTINGS.fontSizePx, true);
    if (!info.target.textContent?.trim() && !info.html) content.textContent = info.text;
    return { html: content.outerHTML, fontFaceCss: rules.join("\n") };
  } finally {
    root.removeAttribute("data-reader-sample-fonts");
  }
}
