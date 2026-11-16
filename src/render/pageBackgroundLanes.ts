/**
 * A12：双页时书的整页背景图按页铺，不横跨两页。
 *
 * 书常把整页背景图写在 html/body 上（cover + fixed）。章节文档的根视口就是
 * 整个双页区域，所以这张图会被拉伸铺满左右两页，内容只占一页时另一页也是
 * 一整块背景。这里把背景图从根元素移到左右两个固定定位的显示层上：
 * - 显示层是 html 的子元素、排在 body 之前，不在 viewer 内，不参与分页、
 *   文字索引和命中测试；
 * - 背景色留在画布上，只搬背景图；
 * - 没有正文的那一页不铺背景图。
 * 单页、滚动和固定版式不需要，由调用方 dispose 恢复原样。
 */

import { pageAxisSign, type PageProgression } from "./pagedDirection";
import { visibleColumnInterval, type SpreadLayout } from "./pagedSpread";

export const PAGE_BACKGROUND_LANE_TAG = "epub-page-background";
/** 背景图已被搬走的根元素；深色主题对比度修补仍应把它当作有背景图。 */
export const PAGE_BACKGROUND_SOURCE_ATTR = "data-reader-page-background-moved";

export interface StationarySpreadOrigin {
  readonly contentLeft: number;
  readonly rtl: boolean;
}

/**
 * 按指定逻辑偏移把 viewer 视口原点还原为正文首栏左缘。
 * 合成层窗口模式下 viewer 被加宽并设负 margin-left + transform，须用偏移差抵消。
 */
export function resolveStationarySpreadOrigin(input: {
  readonly contentOrigin: number;
  readonly progression: PageProgression;
  readonly visualOffset: number;
  readonly scrollOffset: number;
  readonly columns: 1 | 2;
  readonly columnWidth: number;
  readonly columnStep: number;
}): StationarySpreadOrigin {
  const scroll = Number.isFinite(input.scrollOffset) ? input.scrollOffset : 0;
  const visual = Number.isFinite(input.visualOffset) ? input.visualOffset : scroll;
  const rtl = input.progression === "rtl";
  const firstStart = input.contentOrigin + pageAxisSign(input.progression) * (visual - scroll);
  // LTR：firstStart 是第一栏左缘；RTL：是第一栏右缘，整屏向左展开。
  const contentLeft = rtl
    ? firstStart - (input.columns - 1) * input.columnStep - input.columnWidth
    : firstStart;
  return { contentLeft, rtl };
}

export interface PageBackgroundSlot {
  readonly doc: Document;
  readonly lanes: PageBackgroundLanes | null;
}

export function releasePageBackgroundSlot(slot: PageBackgroundSlot | null): null {
  slot?.lanes?.dispose();
  return null;
}

export function syncDualPageBackground(
  current: PageBackgroundSlot | null,
  input: {
    readonly doc: Document | null;
    readonly viewer: HTMLElement | null;
    readonly layout: SpreadLayout | null;
    readonly disabled: boolean;
    readonly page: number;
    readonly progression: PageProgression;
    readonly contentOrigin: () => number;
    readonly visualOffset: number;
    readonly scrollOffset: number;
  },
): PageBackgroundSlot | null {
  const { doc, viewer, layout } = input;
  let slot = current;
  if (slot && slot.doc !== doc) slot = releasePageBackgroundSlot(slot);
  if (!doc || !viewer || !layout || input.disabled || layout.geometry.columns !== 2) {
    return releasePageBackgroundSlot(slot);
  }
  if (!slot) slot = { doc, lanes: installPageBackgroundLanes(doc) };
  const lanes = slot.lanes;
  if (!lanes) return slot;
  const geometry = layout.geometry;
  const origin = resolveStationarySpreadOrigin({
    contentOrigin: input.contentOrigin(),
    progression: input.progression,
    visualOffset: input.visualOffset,
    scrollOffset: input.scrollOffset,
    columns: geometry.columns,
    columnWidth: geometry.columnWidth,
    columnStep: geometry.columnStep,
  });
  const splitX = origin.contentLeft + (geometry.columnWidth + geometry.columnStep) / 2;
  if (!Number.isFinite(splitX)) return slot;
  const first = !layout.empty && visibleColumnInterval(layout, input.page, 0) !== null;
  const second = !layout.empty && visibleColumnInterval(layout, input.page, 1) !== null;
  lanes.update({ splitX, leftFilled: origin.rtl ? second : first, rightFilled: origin.rtl ? first : second });
  return slot;
}

const COPIED_PROPERTIES = [
  "background-image",
  "background-position",
  "background-size",
  "background-repeat",
  "background-origin",
  "background-clip",
] as const;

export interface PageBackgroundLaneState {
  /** iframe 视口坐标：左右两页的分界线。 */
  readonly splitX: number;
  readonly leftFilled: boolean;
  readonly rightFilled: boolean;
}

export interface PageBackgroundLanes {
  readonly doc: Document;
  update(state: PageBackgroundLaneState): void;
  /** 移除显示层并恢复根元素原来的内联背景图。 */
  dispose(): void;
}

/** 画布背景图来自 html，html 没有时来自 body；都没有返回 null。 */
function backgroundSource(doc: Document): HTMLElement | null {
  const win = doc.defaultView;
  const root = doc.documentElement as HTMLElement | null;
  const body = doc.body;
  if (!win || !root || !body || typeof win.getComputedStyle !== "function") return null;
  for (const element of [root, body]) {
    try {
      if (win.getComputedStyle(element).backgroundImage.trim() !== "none") return element;
    } catch {
      return null;
    }
  }
  return null;
}

export function installPageBackgroundLanes(doc: Document): PageBackgroundLanes | null {
  const source = backgroundSource(doc);
  const body = doc.body;
  const root = doc.documentElement;
  const win = doc.defaultView;
  if (!source || !body || !root || !win) return null;

  const computed = win.getComputedStyle(source);
  const copied = COPIED_PROPERTIES.map((property) => [property, computed.getPropertyValue(property)] as const);
  const imageValue = computed.getPropertyValue("background-image");
  const inline = {
    value: source.style.getPropertyValue("background-image"),
    priority: typeof source.style.getPropertyPriority === "function" ? source.style.getPropertyPriority("background-image") : "",
  };

  const lanes = [0, 1].map(() => {
    const lane = doc.createElement(PAGE_BACKGROUND_LANE_TAG) as HTMLElement;
    lane.setAttribute("aria-hidden", "true");
    const style = lane.style;
    for (const [property, value] of copied) style.setProperty(property, value, "important");
    // fixed 附着会相对整个视口定位，正是要避免的“横跨两页”。
    style.setProperty("background-attachment", "scroll", "important");
    style.setProperty("background-color", "transparent", "important");
    style.setProperty("position", "fixed", "important");
    style.setProperty("top", "0", "important");
    style.setProperty("bottom", "0", "important");
    style.setProperty("margin", "0", "important");
    style.setProperty("padding", "0", "important");
    style.setProperty("border", "0", "important");
    // 负 z-index：画在画布背景之上、正文之下，与 body 是否定位无关。
    style.setProperty("z-index", "-1", "important");
    style.setProperty("pointer-events", "none", "important");
    style.setProperty("display", "none", "important");
    root.insertBefore(lane, body);
    return lane;
  }) as [HTMLElement, HTMLElement];

  source.style.setProperty("background-image", "none", "important");
  source.setAttribute(PAGE_BACKGROUND_SOURCE_ATTR, imageValue);

  let last = "";
  return {
    doc,
    update({ splitX, leftFilled, rightFilled }) {
      if (!Number.isFinite(splitX)) return;
      const key = `${splitX}|${leftFilled}|${rightFilled}`;
      if (key === last) return;
      last = key;
      const [left, right] = lanes;
      left.style.setProperty("left", "0", "important");
      left.style.setProperty("width", `${Math.max(0, splitX)}px`, "important");
      left.style.setProperty("display", leftFilled ? "block" : "none", "important");
      right.style.setProperty("left", `${Math.max(0, splitX)}px`, "important");
      right.style.setProperty("right", "0", "important");
      right.style.setProperty("display", rightFilled ? "block" : "none", "important");
    },
    dispose() {
      for (const lane of lanes) lane.remove();
      if (inline.value) source.style.setProperty("background-image", inline.value, inline.priority);
      else source.style.removeProperty("background-image");
      source.removeAttribute(PAGE_BACKGROUND_SOURCE_ATTR);
    },
  };
}
