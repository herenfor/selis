import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChapterPaginator } from "./paginator";
import { MotionWindowIdleLease } from "./motionWindowIdleLease";
import { TransformPageMotion } from "./transformPageMotion";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function leaseFixture(idleMs: number | null = 900) {
  let idle = true;
  const exit = vi.fn();
  const callbacks: Array<() => void> = [];
  const lease = new MotionWindowIdleLease({
    after: (ms, callback) => { callbacks.push(callback); return setTimeout(callback, ms); },
    cancel: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
  }, { canExitIdleWindow: () => idle, exitIdleWindow: exit }, idleMs);
  return { lease, exit, callbacks, moving: () => { idle = false; }, idle: () => { idle = true; } };
}

describe("motion window idle lease", () => {
  it("前台有限窗口没有阅读超时或轮询，接触与连续落定均由 owner 回收", () => {
    const f = leaseFixture(null);
    f.lease.settled(); f.lease.beginContact(); f.lease.endContact();
    f.lease.moving(); f.lease.settled();
    vi.advanceTimersByTime(60000);
    expect(f.exit).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    expect(f.callbacks).toHaveLength(0);
    f.lease.dispose();
  });
  it("连续落定延后退出；旧定时回调不能拆掉新窗口", () => {
    const f = leaseFixture();
    f.lease.settled();
    vi.advanceTimersByTime(600);
    f.lease.moving(); f.moving();
    f.callbacks[0]();
    expect(f.exit).not.toHaveBeenCalled();
    f.idle(); f.lease.settled();
    vi.advanceTimersByTime(899);
    expect(f.exit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(f.exit).toHaveBeenCalledTimes(1);
  });
  it("手指停留超过租期也不退出；取消/抬手后正常回收", () => {
    const f = leaseFixture();
    f.lease.settled(); f.lease.beginContact();
    vi.advanceTimersByTime(2000);
    expect(f.exit).not.toHaveBeenCalled();
    f.lease.endContact();
    vi.advanceTimersByTime(900);
    expect(f.exit).toHaveBeenCalledTimes(1);
  });
  it("运动中或销毁后不退出；没有周期轮询", () => {
    const f = leaseFixture();
    f.moving(); f.lease.settled();
    expect(vi.getTimerCount()).toBe(0);
    f.idle(); f.lease.settled(); f.lease.dispose();
    f.callbacks[0](); vi.advanceTimersByTime(3000);
    expect(f.exit).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

// Invoke the real paginator wiring without building an unrelated resource server.
type Pager = Record<string, any>;
function pagerFixture() {
  const p = Object.create(ChapterPaginator.prototype) as Pager;
  const el = { textContent: "current page text", getBoundingClientRect: () => ({ left: 0, width: 100 }) };
  const text = { nodeType: 3, parentElement: el };
  const caret = vi.fn(() => ({ offsetNode: text, offset: 0 }));
  const viewer = {
    clientWidth: 500, clientHeight: 100, clientLeft: 0, scrollLeft: 200,
    getBoundingClientRect: () => ({ left: -200, top: 0 }),
    ownerDocument: { defaultView: { getComputedStyle: () => ({ paddingLeft: "0" }) } },
  };
  const driver = { active: true, read: () => ({ position: 400 }), holdSettledAt: vi.fn(), settleTo: vi.fn() };
  const lease = leaseFixture().lease;
  Object.assign(p, {
    viewer, contentDoc: { documentElement: { clientWidth: 100 }, caretPositionFromPoint: caret },
    textIndex: { offsetForNode: () => 400, elementIndex: () => 4, snippetAt: () => "current page text", totalChars: 900, mediaUnits: 0 },
    pageMotion: { driver, session: { state: { kind: "idle" }, offsetOf: (page: number) => page * 100 }, lease },
    settings: { readingMode: "paginated" }, disposed: false, metrics: { currentPage: 4 },
    lastState: { status: "ready", currentPage: 4, pageCount: 10, empty: false },
    effectiveColumns: 1, leadingColumns: 0, pageWidth: 100, step: 100, geometry: { columns: 1, columnWidth: 100 },
    _currentPath: "Text/ch.xhtml", pageMotionPendingChapter: null,
    readVisualPosition: () => ({ page: 4, left: 400, snapLeft: 400, aligned: true }),
    readyState: (empty: boolean, page = p.metrics.currentPage) => ({ status: "ready", currentPage: page, pageCount: 10, empty }),
    emit: vi.fn(), scheduleAnchorSample: vi.fn(), cancelPendingAnchorSample: vi.fn(),
  });
  return { p, driver, caret };
}

describe("paginator retained motion window", () => {
  it("书签回翻：页边坐标不包含 iframe 滑入滑出时的屏幕位移", () => {
    const p = Object.create(ChapterPaginator.prototype) as Pager;
    let shift = -62;
    const frameRect = vi.fn(() => ({ left: 80 + shift, top: 40 }));
    Object.assign(p, {
      contentDoc: { documentElement: { clientWidth: 390 }, defaultView: { frameElement: { getBoundingClientRect: frameRect } } },
      viewer: { clientWidth: 390 }, fixedLayout: false,
      lastState: { status: "ready" }, settings: { fontSizePx: 18 },
      visualSpreadOrigin: () => ({
        contentLeft: 20, rtl: false, present: [true, false],
        geometry: { columns: 1, columnWidth: 350, columnStep: 390 },
      }),
    });
    for (shift of [-62, 62, 0]) {
      expect(p.bookmarkPageFrames()).toEqual({ top: 0, columns: 1, frames: [{ lane: 0, side: "right", outerX: 390 }] });
    }
    expect(frameRect).not.toHaveBeenCalled();
  });

  it("a synchronous driver fault hands the same turn back to the fallback without a stale live page", () => {
    const p = Object.create(ChapterPaginator.prototype) as Pager;
    p.pageMotionStarted = vi.fn();
    const motion = { session: { turn: () => {
      p.pageMotion = null;
      return { kind: "moving", targetPage: 6 };
    } } };
    p.pageMotion = motion;
    p.ensurePageMotion = () => motion;
    expect(p.motionTurn(1, 1, false)).toBe("unavailable");
    expect(p.pageMotionStarted).not.toHaveBeenCalled();
  });
  it("desktop uses the shared driver; unsupported animation, scroll and disabled slide keep the fallback", () => {
    const p = Object.create(ChapterPaginator.prototype) as Pager;
    Object.assign(p, {
      viewer: { animate: vi.fn() }, slideMotionWanted: true, disposed: false,
      motionWindowForeground: true,
      settings: { readingMode: "paginated" }, pageMotionUnsupportedKey: null, snapOffsetsCache: { key: "layout" },
      prefersTouchPaging: () => false,
    });
    expect(p.pageMotionAvailable).toBe(true);
    p.motionWindowForeground = false;
    expect(p.pageMotionAvailable).toBe(false);
    p.motionWindowForeground = true;
    p.slideMotionWanted = false;
    expect(p.pageMotionAvailable).toBe(false);
    p.slideMotionWanted = true;
    p.settings.readingMode = "scroll";
    expect(p.pageMotionAvailable).toBe(false);
    p.settings.readingMode = "paginated";
    p.pageMotionUnsupportedKey = "layout";
    expect(p.pageMotionAvailable).toBe(false);
    p.pageMotionUnsupportedKey = null;
    p.viewer.animate = undefined;
    expect(p.pageMotionAvailable).toBe(false);
  });
  it("背景/缓存章立即释放；恢复前台只对已完成定位的当前章准备", () => {
    const p = Object.create(ChapterPaginator.prototype) as Pager;
    Object.assign(p, {
      loadSeq: 1, displayReadySeq: 0, displayReadyResult: false,
      disposePageMotion: vi.fn(), prepareMotion: vi.fn(),
    });
    p.setMotionWindowForeground(true);
    expect(p.prepareMotion).not.toHaveBeenCalled();
    p.displayReadySeq = 1; p.displayReadyResult = true;
    p.setMotionWindowForeground(false);
    expect(p.disposePageMotion).toHaveBeenCalledOnce();
    p.setMotionWindowForeground(true);
    expect(p.prepareMotion).toHaveBeenCalledOnce();
  });
  it("首次窗口准备在精确定位和章末定位之后，取消代次不准备", async () => {
    const p = Object.create(ChapterPaginator.prototype) as Pager;
    const order: string[] = [];
    Object.assign(p, {
      loadSeq: 1, disposed: false, settings: { readingMode: "paginated" }, metrics: { pageCount: 10 },
      prepareTextProjection: async () => true, measure: async () => true,
      rebuildTextIndexForCurrentDoc: () => {}, recompute: async () => true,
      applyPendingPreciseNavigation: () => { order.push("precise"); return "located"; },
      setPage: (page: number) => order.push(`page:${page}`),
      prepareMotion: () => order.push("window"),
    });
    expect(await p.prepareChapterForDisplay(1, true)).toBe(true);
    expect(order).toEqual(["precise", "page:9", "window"]);
    order.length = 0;
    expect(await p.prepareChapterForDisplay(0, false)).toBe(false);
    expect(order).toEqual([]);
  });
  it("显式跳页后先提交实际目标再预热，不额外提交用户进度", () => {
    const { p } = pagerFixture();
    Object.assign(p, {
      loadSeq: 1, displayReadySeq: 1, displayReadyResult: true,
      metrics: { currentPage: 4, pageCount: 10 },
      haltPageMotion: vi.fn(() => { p.viewer.scrollLeft = 400; }),
      closeFootnoteForNavigation: vi.fn(), clearSearchHighlightForDocument: vi.fn(),
      notifyUserCommit: vi.fn(),
      prepareMotion: vi.fn(() => {
        expect(p.viewer.scrollLeft).toBe(600);
        expect(p.metrics.currentPage).toBe(6);
      }),
    });
    p.setPage(6);
    expect(p.prepareMotion).toHaveBeenCalledOnce();
    expect(p.scheduleAnchorSample).toHaveBeenCalledOnce();
    expect(p.notifyUserCommit).not.toHaveBeenCalled();
  });
  it("进度采样使用视觉正文坐标，不撤窗口；正式快照不被误标 transient", () => {
    const { p, driver, caret } = pagerFixture();
    p.captureAnchor();
    expect(caret).toHaveBeenCalledWith(50, 50);
    expect(p.anchor.textOffset).toBe(400);
    expect(p.anchorPath).toBe("Text/ch.xhtml");
    const snapshot = p.readPositionSnapshot();
    p.readPositionSnapshot();
    expect(caret).toHaveBeenCalledTimes(1);
    expect(snapshot?.state).toMatchObject({ currentPage: 4 });
    expect(snapshot?.state).not.toHaveProperty("transient");
    expect(snapshot?.readingAnchor?.textOffset).toBe(400);
    expect(driver.settleTo).not.toHaveBeenCalled();
  });
  it("显式运动快照仍采样当前视觉位置并标 transient，不能返回缓存的旧锚点", () => {
    const { p, caret } = pagerFixture();
    p.anchor = { textOffset: 100 };
    p.pageMotion.session.state = { kind: "settling" };
    const snapshot = p.readPositionSnapshot();
    expect(snapshot?.state.transient).toBe(true);
    expect(snapshot?.readingAnchor.textOffset).toBe(400);
    expect(caret).toHaveBeenCalledOnce();
  });

  it("真实落定立即认账，窗口延迟退出与进度提交分离", () => {
    const { p, driver } = pagerFixture();
    p.commitPageMotion(5);
    expect(driver.holdSettledAt).toHaveBeenCalledWith(500);
    expect(driver.settleTo).not.toHaveBeenCalled();
    expect(p.metrics.currentPage).toBe(5);
    expect(p.emit).toHaveBeenCalledWith({ status: "ready", currentPage: 5, pageCount: 10, empty: false });
    expect(p.scheduleAnchorSample).toHaveBeenCalledOnce();
  });
  it("同步落定后处理命令返回值，不取消刚安排的空闲回收", () => {
    const { p } = pagerFixture();
    p.closeFootnoteForNavigation = vi.fn();
    p.clearSearchHighlightForDocument = vi.fn();
    p.reportPageMotionLivePage = vi.fn();
    p.commitPageMotion(4);
    p.pageMotionStarted(4);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(900);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("显式导航仍立即恢复正常几何；旧租约不再触发退出", () => {
    const { p, driver } = pagerFixture();
    p.pageMotion.lease.settled();
    p.haltPageMotion();
    expect(driver.settleTo).toHaveBeenCalledWith(400);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("分页态 scroll / selectionchange 会将意外滚动的 body 与 viewer 归位，但不干扰原生吸附手势", () => {
    const { p } = pagerFixture();
    p.loadSeq = 1;
    p.displayReadySeq = 1;
    p.displayReadyResult = true;
    p.flowProgression = "ltr";
    p.settings = { readingMode: "paginated" };
    p.contentDoc.body = { scrollLeft: 324.5, scrollTop: 0 };
    p.contentDoc.documentElement.scrollLeft = 18;
    p.contentDoc.documentElement.scrollTop = 0;

    // 1) 运动窗口打开时以 driver.windowScroll 为准复位漂移
    p.pageMotion.driver.windowScroll = 200;
    p.viewer.scrollLeft = 560;
    p.handleSelectionChange();
    expect(p.contentDoc.body.scrollLeft).toBe(0);
    expect(p.contentDoc.documentElement.scrollLeft).toBe(0);
    expect(p.viewer.scrollLeft).toBe(200);

    // 2) 退出窗口到普通几何后，scroll 事件仍按写入基线守卫
    p.pageMotion.driver.active = false;
    p.pageMotion.driver.windowScroll = null;
    p.writePagedScroll(400);
    p.viewer.scrollLeft = 720;
    p.contentDoc.body.scrollLeft = 90;
    p.handleScroll();
    expect(p.contentDoc.body.scrollLeft).toBe(0);
    expect(p.viewer.scrollLeft).toBe(400);

    // 3) 原生吸附手势进行中不强行覆盖 viewer.scrollLeft
    p.nativeSnapArmed = true;
    p.viewer.scrollLeft = 450;
    p.handleScroll();
    expect(p.viewer.scrollLeft).toBe(450);
  });

  it("快翻超 4 屏退窗后异步 scroll 事件不回滚到章首，且新页仍受选区漂移守卫", () => {
    let widthPx = 100;
    let marginLeftPx = 0;
    let scrollLeft = 0;
    const styleMap = new Map<string, { value: string; priority: string }>([["width", { value: "100px", priority: "" }]]);
    const viewer = {
      clientWidth: 100,
      clientLeft: 0,
      get scrollWidth() { return Math.max(1000, widthPx); },
      get scrollLeft() { return scrollLeft; },
      set scrollLeft(v: number) { scrollLeft = v; },
      style: {
        getPropertyValue: (n: string) => styleMap.get(n)?.value ?? "",
        getPropertyPriority: (n: string) => styleMap.get(n)?.priority ?? "",
        setProperty: (n: string, v: string, p = "") => {
          styleMap.set(n, { value: v, priority: p });
          if (n === "width") widthPx = Number.parseFloat(v) || 100;
          if (n === "margin-left") marginLeftPx = Number.parseFloat(v) || 0;
        },
        removeProperty: (n: string) => {
          styleMap.delete(n);
          if (n === "margin-left") marginLeftPx = 0;
        },
      },
      animate: () => {
        const finished = new Promise<void>(() => {});
        return { finished, cancel() {}, finish() {} } as unknown as Animation;
      },
      getBoundingClientRect: () => ({ left: marginLeftPx, top: 0 }),
      ownerDocument: {
        defaultView: {
          getComputedStyle: () => {
            const raw = styleMap.get("transform")?.value ?? "";
            const matrix = raw.replace(/translateX\(([-\d.e]+)px\)/, "matrix(1, 0, 0, 1, $1, 0)") || "none";
            return { columnCount: "1", paddingLeft: "0", transform: matrix };
          },
        },
      },
    };
    const contentDoc = {
      documentElement: { scrollLeft: 0, scrollTop: 0, clientWidth: 100 },
      body: { scrollLeft: 0, scrollTop: 0 },
      defaultView: viewer.ownerDocument.defaultView,
    };

    const p = Object.create(ChapterPaginator.prototype) as Pager;
    Object.assign(p, {
      viewer, contentDoc,
      loadSeq: 1, displayReadySeq: 1, displayReadyResult: true,
      disposed: false, verticalMode: null,
      flowProgression: "ltr", nativeSnapArmed: false,
      settings: { readingMode: "paginated" },
      metrics: { currentPage: 0, pageCount: 10 },
      motionWindowForeground: true, slideMotionWanted: true,
      pageMotionUnsupportedKey: "", motionCompanions: [],
      snapOffsetsCache: { key: "10p", offsets: Array.from({ length: 10 }, (_, i) => i * 100) },
      nativeSnapOffsets: () => p.snapOffsetsCache.offsets,
      pageMotionCapable: () => true,
      prefersTouchPaging: () => false,
      closeFootnoteForNavigation: vi.fn(), clearSearchHighlightForDocument: vi.fn(),
      cancelPendingAnchorSample: vi.fn(), scheduleAnchorSample: vi.fn(),
      notifyUserCommit: vi.fn(), emit: vi.fn(),
      readyState: (_e: boolean, page = p.metrics.currentPage) => ({ status: "ready", pageCount: 10, currentPage: page, empty: false }),
    });

    const globalObj = globalThis as Record<string, unknown>;
    const savedMatrix = globalObj.DOMMatrixReadOnly;
    globalObj.DOMMatrixReadOnly = class {
      m41: number;
      constructor(value: string) {
        this.m41 = Number(/matrix\([^,]+,[^,]+,[^,]+,[^,]+,\s*([-\d.e]+)/.exec(value)?.[1] ?? 0);
      }
    };
    try {
      // 1) 在第 0 页进入显示并预热窗口：预期基准应保持首页 0
      p.writePagedScroll(0);
      p.prepareMotion();
      expect(p.pageMotion.driver).toBeInstanceOf(TransformPageMotion);
      expect(p.pageMotion.driver.active).toBe(true);

      // 2) 连按翻页把目标推过 4 屏窗口跨度：触发 animateTo -> !ensureWindow -> settleTo(500)
      expect(p.motionTurn(1, 1, false)).toBe("moving");
      expect(p.motionTurn(1, 2, false)).toBe("moving");
      expect(p.motionTurn(1, 3, false)).toBe("moving");
      expect(p.motionTurn(1, 4, false)).toBe("moving");
      expect(p.motionTurn(1, 5, false)).toBe("moving");
      expect(p.pageMotion.driver.active).toBe(false);
      expect(viewer.scrollLeft).toBe(500);
      expect(p.metrics.currentPage).toBe(5);

      // 3) 几毫秒后浏览器触发异步 scroll 事件：不能把 scrollLeft 拉回首页 0
      p.handleScroll();
      expect(viewer.scrollLeft).toBe(500);

      // 4) 在新停靠的第 5 页若发生选区漂移，仍然精确拉回第 5 页（500），兼顾 ER-0194
      viewer.scrollLeft = 640;
      p.handleSelectionChange();
      expect(viewer.scrollLeft).toBe(500);
    } finally {
      if (savedMatrix === undefined) delete globalObj.DOMMatrixReadOnly;
      else globalObj.DOMMatrixReadOnly = savedMatrix;
    }
  });

  it("触屏拖过整屏松手（durationMs=0）留在窗口内提交，不退窗也不触发回滚", () => {
    const styleMap = new Map<string, { value: string; priority: string }>([["width", { value: "390px", priority: "" }]]);
    let scrollLeft = 0;
    const viewer = {
      clientWidth: 390,
      clientLeft: 0,
      get scrollWidth() { return 3900; },
      get scrollLeft() { return scrollLeft; },
      set scrollLeft(v: number) { scrollLeft = v; },
      style: {
        getPropertyValue: (n: string) => styleMap.get(n)?.value ?? "",
        getPropertyPriority: (n: string) => styleMap.get(n)?.priority ?? "",
        setProperty: (n: string, v: string, p = "") => { styleMap.set(n, { value: v, priority: p }); },
        removeProperty: (n: string) => { styleMap.delete(n); },
      },
      animate: () => ({ finished: new Promise<void>(() => {}), cancel() {}, finish() {} }) as unknown as Animation,
      getBoundingClientRect: () => ({ left: 0, top: 0 }),
      ownerDocument: { defaultView: { getComputedStyle: () => ({ columnCount: "1", paddingLeft: "0", transform: "none" }) } },
    };
    const p = Object.create(ChapterPaginator.prototype) as Pager;
    Object.assign(p, {
      viewer,
      contentDoc: { documentElement: { scrollLeft: 0, scrollTop: 0, clientWidth: 390 }, body: { scrollLeft: 0, scrollTop: 0 }, defaultView: viewer.ownerDocument.defaultView },
      loadSeq: 1, displayReadySeq: 1, displayReadyResult: true,
      disposed: false, verticalMode: null,
      flowProgression: "ltr", nativeSnapArmed: false,
      settings: { readingMode: "paginated" },
      metrics: { currentPage: 0, pageCount: 10 },
      motionWindowForeground: true, slideMotionWanted: true,
      pageMotionUnsupportedKey: "", motionCompanions: [],
      snapOffsetsCache: { key: "touch", offsets: Array.from({ length: 10 }, (_, i) => i * 390) },
      nativeSnapOffsets: () => p.snapOffsetsCache.offsets,
      pageMotionCapable: () => true,
      prefersTouchPaging: () => true,
      closeFootnoteForNavigation: vi.fn(), clearSearchHighlightForDocument: vi.fn(),
      cancelPendingAnchorSample: vi.fn(), scheduleAnchorSample: vi.fn(),
      notifyUserCommit: vi.fn(), emit: vi.fn(),
      readyState: (_e: boolean, page = p.metrics.currentPage) => ({ status: "ready", pageCount: 10, currentPage: page, empty: false }),
    });

    p.writePagedScroll(0);
    p.prepareMotion(true);
    const windowScroll = p.pageMotion.driver.windowScroll;

    const ticket = p.motionBeginDrag(1);
    expect(typeof ticket).toBe("number");
    // 手指拖过整屏宽度（-410px）夹紧在 390px 落点，松手剩余距离 0 -> durationMs = 0
    p.motionDrag(ticket, -410);
    expect(p.motionRelease(ticket, 1, null)).toBe(true);
    expect(p.pageMotion.driver.active).toBe(true);
    expect(p.pageMotion.driver.windowScroll).toBe(windowScroll);
    expect(p.metrics.currentPage).toBe(1);

    p.handleScroll();
    expect(viewer.scrollLeft).toBe(windowScroll);
    expect(p.pageMotion.driver.read().position).toBe(390);
  });
});
