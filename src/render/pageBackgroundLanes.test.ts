import { parseHTML } from "linkedom";
import { describe, expect, it, vi } from "vitest";
import { createSpreadGeometry, createSpreadLayout } from "./pagedSpread";
import { ChapterPaginator } from "./paginator";
import {
  PAGE_BACKGROUND_LANE_TAG,
  PAGE_BACKGROUND_SOURCE_ATTR,
  installPageBackgroundLanes,
} from "./pageBackgroundLanes";

/** linkedom has no cascade: computed values come straight from inline styles. */
function chapter(bodyStyle: string, rootStyle = ""): Document {
  const { document } = parseHTML(
    `<html style="${rootStyle}"><head></head><body style="${bodyStyle}"><epub-viewer id="epub-viewer"><p>text</p></epub-viewer></body></html>`,
  );
  const win = document.defaultView as unknown as { getComputedStyle: (el: HTMLElement) => unknown };
  win.getComputedStyle = (el: HTMLElement) => ({
    get backgroundImage() {
      return el.style.getPropertyValue("background-image") || "none";
    },
    getPropertyValue: (property: string) => el.style.getPropertyValue(property),
  });
  return document as unknown as Document;
}

const lanesOf = (doc: Document) => Array.from(doc.querySelectorAll(PAGE_BACKGROUND_LANE_TAG)) as HTMLElement[];

describe("page background lanes (A12)", () => {
  it("does nothing for a chapter without a page background image", () => {
    const doc = chapter("background-color: #231816");
    expect(installPageBackgroundLanes(doc)).toBeNull();
    expect(lanesOf(doc)).toHaveLength(0);
  });

  it("moves the body image onto two lanes outside the paginated viewer and restores it", () => {
    const doc = chapter("background-image: url(curtain.png); background-size: cover; background-attachment: fixed");
    // linkedom re-lists <body> after an insertBefore on <html>; keep the original node.
    const body = doc.body;
    const lanes = installPageBackgroundLanes(doc)!;
    expect(lanes).not.toBeNull();

    const [left, right] = lanesOf(doc);
    expect(left.parentElement).toBe(doc.documentElement);
    expect(right.parentElement).toBe(doc.documentElement);
    expect(body.querySelector(PAGE_BACKGROUND_LANE_TAG)).toBeNull();
    expect(doc.getElementById("epub-viewer")!.querySelector(PAGE_BACKGROUND_LANE_TAG)).toBeNull();
    expect(left.style.getPropertyValue("background-image")).toBe("url(curtain.png)");
    expect(left.style.getPropertyValue("background-size")).toBe("cover");
    expect(left.style.getPropertyValue("background-attachment")).toBe("scroll");
    expect(body.style.getPropertyValue("background-image")).toBe("none");
    expect(body.getAttribute(PAGE_BACKGROUND_SOURCE_ATTR)).toBe("url(curtain.png)");

    lanes.dispose();
    expect(lanesOf(doc)).toHaveLength(0);
    expect(body.style.getPropertyValue("background-image")).toBe("url(curtain.png)");
    expect(body.hasAttribute(PAGE_BACKGROUND_SOURCE_ATTR)).toBe(false);
  });

  it("shows the image only on pages that have content, split at the spread centre", () => {
    const doc = chapter("background-image: url(curtain.png)");
    const lanes = installPageBackgroundLanes(doc)!;
    lanes.update({ splitX: 1000, leftFilled: true, rightFilled: false });
    const [left, right] = lanesOf(doc);
    expect(left.style.getPropertyValue("width")).toBe("1000px");
    expect(left.style.getPropertyValue("display")).toBe("block");
    expect(right.style.getPropertyValue("left")).toBe("1000px");
    expect(right.style.getPropertyValue("display")).toBe("none");

    lanes.update({ splitX: 1000, leftFilled: true, rightFilled: true });
    expect(right.style.getPropertyValue("display")).toBe("block");
  });

  it("prefers the root element when html carries the page image", () => {
    const doc = chapter("", "background-image: url(root.png)");
    installPageBackgroundLanes(doc)!;
    expect(doc.documentElement.style.getPropertyValue("background-image")).toBe("none");
    expect(lanesOf(doc)[0].style.getPropertyValue("background-image")).toBe("url(root.png)");
  });

  it("ignores non-finite split coordinates cleanly", () => {
    const doc = chapter("background-image: url(curtain.png)");
    const lanes = installPageBackgroundLanes(doc)!;
    lanes.update({ splitX: 500, leftFilled: true, rightFilled: true });
    lanes.update({ splitX: Number.NaN, leftFilled: true, rightFilled: false });
    const [left, right] = lanesOf(doc);
    expect(left.style.getPropertyValue("width")).toBe("500px");
    expect(right.style.getPropertyValue("display")).toBe("block");
  });
});

function paginatorWithMotion(opts: {
  progression?: "ltr" | "rtl";
  viewerLeft?: number;
  viewerRight?: number;
  paddingLeft?: number;
  paddingRight?: number;
  scrollLeft?: number;
  visualPosition: number;
  lastColumn: number;
  currentPage: number;
}) {
  const doc = chapter("background-image: url(cover-bg.png); background-size: cover");
  const paddingLeft = opts.paddingLeft ?? 53.25;
  const paddingRight = opts.paddingRight ?? 53.25;
  const progression = opts.progression ?? "ltr";
  let rectLeft = opts.viewerLeft ?? 0;
  let rectRight = opts.viewerRight ?? 975;
  let scrollLeft = opts.scrollLeft ?? 0;
  let visualPosition = opts.visualPosition;
  let active = true;
  const viewer = {
    clientLeft: 0,
    get scrollLeft() { return scrollLeft; },
    set scrollLeft(v: number) { scrollLeft = v; },
    getBoundingClientRect: () => ({ left: rectLeft, right: rectRight, width: rectRight - rectLeft }),
  };
  const win = doc.defaultView as unknown as {
    getComputedStyle: (el: unknown) => {
      backgroundImage: string;
      paddingLeft: string;
      paddingRight: string;
      borderRightWidth: string;
      getPropertyValue: (property: string) => string;
    };
  };
  win.getComputedStyle = (el: unknown) => {
    if (el === viewer) {
      return {
        backgroundImage: "none",
        paddingLeft: `${paddingLeft}px`,
        paddingRight: `${paddingRight}px`,
        borderRightWidth: "0px",
        getPropertyValue: (p: string) => (p === "padding-left" ? `${paddingLeft}px` : p === "padding-right" ? `${paddingRight}px` : ""),
      };
    }
    const htmlEl = el as HTMLElement;
    return {
      backgroundImage: htmlEl.style?.getPropertyValue("background-image") || "none",
      paddingLeft: "0px",
      paddingRight: "0px",
      borderRightWidth: "0px",
      getPropertyValue: (p: string) => htmlEl.style?.getPropertyValue(p) ?? "",
    };
  };
  const geometry = createSpreadGeometry(868.5, 106.5, 2, 280);
  const spreadLayout = createSpreadLayout(geometry, { first: 0, last: opts.lastColumn });
  const driver = {
    get active() { return active; },
    read: () => ({ position: visualPosition }),
    settleTo: (pos: number) => {
      active = false;
      scrollLeft = progression === "rtl" ? -pos : pos;
      rectLeft = 0;
      rectRight = 975;
      visualPosition = pos;
    },
  };
  const paginator = Object.create(ChapterPaginator.prototype) as Record<string, any>;
  Object.assign(paginator, {
    contentDoc: doc,
    viewer,
    spreadLayout,
    settings: { readingMode: "paginated" },
    fixedLayout: false,
    disposed: false,
    flowProgression: progression,
    metrics: { pageCount: spreadLayout.pageCount, currentPage: opts.currentPage },
    pageBackground: null,
    pageMotionPendingChapter: null,
    pageMotionLivePage: null,
    adoptedPageUncommitted: false,
    expectedPagedScroll: null,
    nativeSnapOffsets: () => [0, 975],
    mediaPlayback: null,
    onState: vi.fn(),
    pageMotion: {
      viewer,
      driver,
      lease: { endContact: vi.fn(), moving: vi.fn(), dispose: vi.fn() },
      session: { state: { kind: "idle" }, halt: () => ({ position: 0 }) },
    },
  });
  return {
    doc,
    paginator,
    setMotionRect: (left: number, right: number, pos: number) => {
      rectLeft = left;
      rectRight = right;
      visualPosition = pos;
    },
  };
}

describe("ER-0207 dual-page background sync with compositor motion window", () => {
  it("keeps splitX at the spread centre when TransformPageMotion shifts viewer negative on page 1 (both columns filled)", () => {
    const { doc, paginator } = paginatorWithMotion({
      viewerLeft: -975,
      viewerRight: 975,
      scrollLeft: 0,
      visualPosition: 975,
      lastColumn: 3,
      currentPage: 1,
    });
    paginator.emit({ status: "ready", pageCount: 2, currentPage: 1, empty: false });
    const [left, right] = lanesOf(doc);
    expect(left.style.getPropertyValue("width")).toBe("487.5px");
    expect(left.style.getPropertyValue("display")).toBe("block");
    expect(right.style.getPropertyValue("left")).toBe("487.5px");
    expect(right.style.getPropertyValue("display")).toBe("block");
  });

  it("does not collapse left page background to 0px when right column is empty on page 1", () => {
    const { doc, paginator } = paginatorWithMotion({
      viewerLeft: -975,
      viewerRight: 975,
      scrollLeft: 0,
      visualPosition: 975,
      lastColumn: 2,
      currentPage: 1,
    });
    paginator.emit({ status: "ready", pageCount: 2, currentPage: 1, empty: false });
    const [left, right] = lanesOf(doc);
    expect(left.style.getPropertyValue("width")).toBe("487.5px");
    expect(left.style.getPropertyValue("display")).toBe("block");
    expect(right.style.getPropertyValue("display")).toBe("none");
  });

  it("tracks transient live-page updates smoothly mid-slide and restores on haltPageMotion", () => {
    const { doc, paginator, setMotionRect } = paginatorWithMotion({
      viewerLeft: -312,
      viewerRight: 1638,
      scrollLeft: 0,
      visualPosition: 312,
      lastColumn: 2,
      currentPage: 0,
    });
    paginator.pageMotion.session.state = { kind: "settling" };
    paginator.emit({ status: "ready", pageCount: 2, currentPage: 1, empty: false, transient: true });
    const [left, right] = lanesOf(doc);
    // Target page 1 only has left column filled; splitX stays centered at 487.5px mid-animation.
    expect(left.style.getPropertyValue("width")).toBe("487.5px");
    expect(left.style.getPropertyValue("display")).toBe("block");
    expect(right.style.getPropertyValue("display")).toBe("none");

    // Interrupt back to page 0: both lanes on page 0 must resync immediately.
    setMotionRect(0, 1950, 0);
    paginator.haltPageMotion();
    expect(left.style.getPropertyValue("width")).toBe("487.5px");
    expect(left.style.getPropertyValue("display")).toBe("block");
    expect(right.style.getPropertyValue("display")).toBe("block");
  });

  it("computes the right RTL splitX and swaps lane visibility when TransformPageMotion is active", () => {
    const { doc, paginator } = paginatorWithMotion({
      progression: "rtl",
      viewerLeft: 0,
      viewerRight: 1950,
      scrollLeft: 0,
      visualPosition: 975,
      lastColumn: 2,
      currentPage: 1,
    });
    paginator.emit({ status: "ready", pageCount: 2, currentPage: 1, empty: false });
    const [left, right] = lanesOf(doc);
    expect(left.style.getPropertyValue("display")).toBe("none");
    expect(right.style.getPropertyValue("left")).toBe("487.5px");
    expect(right.style.getPropertyValue("display")).toBe("block");
  });
});
