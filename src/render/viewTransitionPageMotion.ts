/**
 * 覆盖翻页驱动：用正文 iframe 内的 View Transition 快照做“当前页滑出、目标页露出”。
 *
 * 与 TransformPageMotion 共用 PageMotionSession：位置仍是阅读偏移，拖动/中断/反向/
 * 落定曲线全部由会话决定；这里只把位置映射成快照动画的进度。快照由浏览器从同一
 * 渲染结果生成，不手工截帧，也不改正文 DOM。
 *
 * 关键实现约束：root 快照不支持 clip-path，命名元素快照支持；因此给正文视口加
 * `view-transition-name: reader-page`，root 快照保持静止。旧页快照在上层滑出，
 * 新页快照在下层露出，前缘阴影由旧页的 box-shadow 提供。
 */
import type { InterruptResult, MotionSample, SettlePlan } from "./pageMotion";
import { settleProgress } from "./pageMotion";
import { pageAxisSign, type PageProgression } from "./pagedDirection";
import type { MotionCompanion, PageMotionSurfaceDriver } from "./transformPageMotion";

const PAGE_NAME = "reader-page";
const STYLE_ID = "reader-page-turn-transition";
const TRANSITION_DURATION_MS = 1000;

type ViewTransitionLike = {
  readonly ready: Promise<void>;
  readonly finished: Promise<void>;
  skipTransition(): void;
};

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => ViewTransitionLike;
};

/** 正文 iframe 内的样式；只在这个驱动存在时注入，随驱动销毁。 */
const COVER_STYLE = `
::view-transition-old(root), ::view-transition-new(root) { animation: none; }
::view-transition-group(${PAGE_NAME}) { animation: none; }
::view-transition-old(${PAGE_NAME}), ::view-transition-new(${PAGE_NAME}) {
  animation-duration: ${TRANSITION_DURATION_MS}ms;
  animation-timing-function: linear;
  animation-fill-mode: both;
  /* The viewer itself is transparent (the page color lives on the host), so
     the snapshot would let the other page's text show through. Paint the
     page color under each snapshot; both pages stay opaque. */
  background-color: var(--reader-turn-bg, #fff);
}
:root[data-turn-mode="cover"]::view-transition-old(${PAGE_NAME}) {
  animation-name: readerCoverOld;
  z-index: 2;
  box-shadow: 34px 0 46px rgba(0, 0, 0, .38);
}
:root[data-turn-mode="cover"]::view-transition-new(${PAGE_NAME}) {
  animation-name: readerCoverNew;
  z-index: 1;
}
:root[data-turn-mode="cover"][data-turn-direction="prev"]::view-transition-old(${PAGE_NAME}) {
  animation-name: readerCoverOldPrev;
  box-shadow: -34px 0 46px rgba(0, 0, 0, .38);
}
@keyframes readerCoverOld {
  from { transform: translateX(0); }
  to { transform: translateX(-100%); }
}
@keyframes readerCoverOldPrev {
  from { transform: translateX(0); }
  to { transform: translateX(100%); }
}
@keyframes readerCoverNew {
  from { filter: brightness(.94); }
  to { filter: brightness(1); }
}
`;

export interface ViewTransitionMotionOptions {
  readonly viewer: HTMLElement;
  readonly offsets: readonly number[];
  readonly step: number;
  readonly progression: PageProgression;
  /** 只写视觉滚动位置，不提交页码；用于 View Transition 的 update 回调。 */
  readonly preview: (position: number) => void;
  /** 正常几何的滚动写入；取消/落定时使用。 */
  readonly writeRest: (position: number) => void;
  readonly read: () => number;
  readonly onFault: (error: unknown) => void;
}

interface Turn {
  readonly origin: number;
  readonly target: number;
  readonly transition: ViewTransitionLike;
  animations: Animation[];
  progress: number;
  ready: boolean;
  cancelled: boolean;
  raf: number | null;
  pendingProgress: number | null;
  pendingSettle: { position: number; plan: SettlePlan; done: () => void } | null;
}

export class ViewTransitionPageMotion implements PageMotionSurfaceDriver {
  private turn: Turn | null = null;
  private disposed = false;
  private readonly doc: Document;
  private readonly win: Window | null;
  private readonly style: HTMLStyleElement | null;
  private hostOverlay: HTMLElement | null = null;
  private hostOverlayZIndex = "";

  static supported(doc: Document | null | undefined): boolean {
    return Boolean(doc && typeof (doc as ViewTransitionDocument).startViewTransition === "function");
  }

  constructor(private readonly options: ViewTransitionMotionOptions) {
    this.doc = options.viewer.ownerDocument;
    this.win = this.doc.defaultView;
    this.style = this.installStyle();
    options.viewer.style.setProperty("view-transition-name", PAGE_NAME);
  }

  get active(): boolean { return this.turn !== null; }
  get windowScroll(): number | null { return null; }

  read(): MotionSample {
    const turn = this.turn;
    if (!turn) return { position: this.options.read() };
    if (!turn.ready) return { position: turn.origin };
    return { position: turn.origin + (turn.target - turn.origin) * turn.progress };
  }

  interrupt(): InterruptResult {
    const turn = this.turn;
    if (!turn) return { kind: "held", sample: { position: this.options.read() } };
    if (!turn.ready) {
      this.cancelTurn(turn);
      return { kind: "held", sample: { position: turn.origin } };
    }
    for (const animation of turn.animations) animation.pause();
    return { kind: "held", sample: this.read() };
  }

  write(position: number): void {
    if (this.disposed) return;
    const turn = this.turn;
    if (!turn) {
      const current = this.options.read();
      if (Math.abs(position - current) < 0.5) return;
      this.startTurn(position > current ? 1 : -1, current);
      return;
    }
    const span = turn.target - turn.origin;
    if (Math.abs(span) < 0.5) return;
    const progress = Math.max(0, Math.min(1, (position - turn.origin) / span));
    if (!turn.ready) {
      turn.pendingProgress = progress;
      return;
    }
    this.setProgress(turn, progress);
  }

  animateTo(position: number, plan: SettlePlan, done: () => void): void {
    if (this.disposed) return;
    const turn = this.turn;
    if (!turn) {
      const current = this.options.read();
      if (Math.abs(position - current) < 0.5) { done(); return; }
      this.startTurn(position > current ? 1 : -1, current, () => this.playTo(position, plan, done));
      return;
    }
    // 连续快速翻页跨过当前快照目标：先落定这一屏，再从它起下一段。
    if (turn.ready) {
      const requested = this.nearestPage(position);
      const target = this.nearestPage(turn.target);
      if (requested !== target && Math.sign(position - turn.target) === Math.sign(turn.target - turn.origin)) {
        const from = turn.target;
        const direction = requested > target ? 1 : -1;
        this.finishTurn(turn, true, () => undefined);
        this.startTurn(direction, from, () => this.playTo(position, plan, done));
        return;
      }
    }
    this.playTo(position, plan, done);
  }

  holdSettledAt(position: number): void {
    this.settleTo(position);
  }

  settleTo(position: number): void {
    if (this.disposed) return;
    const turn = this.turn;
    if (turn) {
      this.turn = null;
      turn.cancelled = true;
      this.cancelFrame(turn);
      this.options.writeRest(turn.origin);
      try { turn.transition.skipTransition(); } catch { /* already finished */ }
      this.restoreHostOverlay();
      this.cleanup();
    }
    this.options.writeRest(position);
  }

  expediteLanding(): void { /* no compositor window to expedite */ }
  setCompanions(_companions: readonly MotionCompanion[]): void { /* cover has no seam companions */ }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const turn = this.turn;
    this.turn = null;
    if (turn) {
      turn.cancelled = true;
      this.cancelFrame(turn);
      this.options.writeRest(turn.origin);
      try { turn.transition.skipTransition(); } catch { /* already finished */ }
    }
    this.restoreHostOverlay();
    this.cleanup();
    this.options.viewer.style.removeProperty("view-transition-name");
    this.style?.remove();
  }

  private startTurn(direction: 1 | -1, current: number, onReady?: () => void): void {
    const currentPage = this.nearestPage(current);
    const targetPage = currentPage + direction;
    if (targetPage < 0 || targetPage >= this.options.offsets.length) {
      onReady?.();
      return;
    }
    const startViewTransition = (this.doc as ViewTransitionDocument).startViewTransition;
    if (!startViewTransition) {
      this.options.onFault(new Error("view transition unavailable"));
      return;
    }
    const origin = this.options.offsets[currentPage];
    const target = this.options.offsets[targetPage];
    const physicalNext = direction * pageAxisSign(this.options.progression) === 1;
    // WebView2/Chromium skips a View Transition when the iframe document is
    // covered by another element. The transparent seam input overlay sits
    // above the active iframe (z-index 3); lower it while the cover runs.
    this.suspendHostOverlay();
    this.doc.documentElement.style.setProperty("--reader-turn-bg", this.pageBackground());
    this.doc.documentElement.dataset.turnMode = "cover";
    this.doc.documentElement.dataset.turnDirection = physicalNext ? "next" : "prev";
    let transition: ViewTransitionLike;
    try {
      transition = startViewTransition.call(this.doc, () => this.options.preview(target));
    } catch (error) {
      this.restoreHostOverlay();
      this.cleanup();
      this.options.onFault(error);
      return;
    }
    const turn: Turn = {
      origin,
      target,
      transition,
      animations: [],
      progress: 0,
      ready: false,
      cancelled: false,
      raf: null,
      pendingProgress: null,
      pendingSettle: null,
    };
    this.turn = turn;
    void transition.ready.then(() => {
      if (this.turn !== turn || turn.cancelled || this.disposed) return;
      turn.ready = true;
      turn.animations = this.findAnimations();
      for (const animation of turn.animations) {
        animation.pause();
        animation.currentTime = 0;
      }
      if (turn.pendingProgress !== null) this.setProgress(turn, turn.pendingProgress);
      const pending = turn.pendingSettle;
      turn.pendingSettle = null;
      if (pending) this.playTo(pending.position, pending.plan, pending.done);
      onReady?.();
    }).catch((error: unknown) => {
      if (this.turn === turn) this.fail(error);
    });
  }

  private playTo(position: number, plan: SettlePlan, done: () => void): void {
    const turn = this.turn;
    if (!turn) { done(); return; }
    if (!turn.ready) {
      turn.pendingSettle = { position, plan, done };
      return;
    }
    const span = turn.target - turn.origin;
    const targetProgress = Math.abs(span) < 0.5 ? 1 : Math.max(0, Math.min(1, (position - turn.origin) / span));
    const from = turn.progress;
    const distance = targetProgress - from;
    if (Math.abs(distance) < 0.001 || plan.durationMs <= 0) {
      this.setProgress(turn, targetProgress);
      this.finishTurn(turn, targetProgress >= 0.999, done);
      return;
    }
    const start = this.now();
    const step = (now: number): void => {
      if (this.turn !== turn || turn.cancelled) return;
      const t = Math.min(1, (now - start) / plan.durationMs);
      this.setProgress(turn, from + distance * settleProgress(plan, t));
      if (t < 1) {
        turn.raf = this.requestFrame(step);
      } else {
        turn.raf = null;
        this.finishTurn(turn, targetProgress >= 0.999, done);
      }
    };
    turn.raf = this.requestFrame(step);
    if (turn.raf === null) {
      this.setProgress(turn, targetProgress);
      this.finishTurn(turn, targetProgress >= 0.999, done);
    }
  }

  private setProgress(turn: Turn, progress: number): void {
    const p = Math.max(0, Math.min(1, progress));
    turn.progress = p;
    for (const animation of turn.animations) {
      animation.pause();
      animation.currentTime = p * TRANSITION_DURATION_MS;
    }
  }

  private finishTurn(turn: Turn, completed: boolean, done: () => void): void {
    if (this.turn !== turn) return;
    this.turn = null;
    turn.cancelled = true;
    this.cancelFrame(turn);
    if (!completed) this.options.writeRest(turn.origin);
    try { turn.transition.skipTransition(); } catch { /* already finished */ }
    this.restoreHostOverlay();
    this.cleanup();
    done();
  }

  private cancelTurn(turn: Turn): void {
    if (this.turn !== turn) return;
    this.turn = null;
    turn.cancelled = true;
    this.cancelFrame(turn);
    this.options.writeRest(turn.origin);
    try { turn.transition.skipTransition(); } catch { /* already finished */ }
    this.restoreHostOverlay();
    this.cleanup();
  }

  private fail(error: unknown): void {
    this.turn = null;
    this.restoreHostOverlay();
    this.cleanup();
    this.options.onFault(error);
  }

  private findAnimations(): Animation[] {
    const named = this.doc.getAnimations().filter((animation) => {
      const name = (animation as CSSAnimation).animationName;
      if (name === "readerCoverOld" || name === "readerCoverOldPrev" || name === "readerCoverNew") return true;
      const pseudo = (animation.effect as KeyframeEffect | null)?.pseudoElement;
      return pseudo === `::view-transition-old(${PAGE_NAME})` || pseudo === `::view-transition-new(${PAGE_NAME})`;
    });
    // Do not scrub unrelated book animations if our named snapshots are absent.
    return named;
  }

  private nearestPage(position: number): number {
    let best = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < this.options.offsets.length; index += 1) {
      const distance = Math.abs(this.options.offsets[index] - position);
      if (distance < bestDistance) { best = index; bestDistance = distance; }
    }
    return best;
  }

  private requestFrame(callback: (now: number) => void): number | null {
    if (this.win?.requestAnimationFrame) return this.win.requestAnimationFrame(callback);
    if (typeof requestAnimationFrame === "function") return requestAnimationFrame(callback);
    return null;
  }

  private cancelFrame(turn: Turn): void {
    if (turn.raf === null) return;
    this.win?.cancelAnimationFrame(turn.raf);
    turn.raf = null;
  }

  private now(): number {
    return this.win?.performance?.now() ?? Date.now();
  }

  /**
   * The seam input surface is a transparent host overlay above the active
   * iframe. WebView2 skips the iframe's View Transition while that overlay
   * covers it, so take it below the iframe for the duration of the turn.
   */
  private suspendHostOverlay(): void {
    const frame = this.doc.defaultView?.frameElement as HTMLElement | null;
    const host = frame?.closest(".reader-presentation-host") as HTMLElement | null;
    const overlay = (host?.querySelector(":scope > .reader-seam-input") ??
      frame?.ownerDocument.querySelector(".reader-seam-input")) as HTMLElement | null;
    if (!overlay) return;
    this.hostOverlay = overlay;
    this.hostOverlayZIndex = overlay.style.zIndex;
    overlay.style.zIndex = "0";
  }

  private restoreHostOverlay(): void {
    const overlay = this.hostOverlay;
    if (!overlay) return;
    this.hostOverlay = null;
    if (this.hostOverlayZIndex) overlay.style.zIndex = this.hostOverlayZIndex;
    else overlay.style.removeProperty("z-index");
  }

  private cleanup(): void {
    delete this.doc.documentElement.dataset.turnMode;
    delete this.doc.documentElement.dataset.turnDirection;
    this.doc.documentElement.style.removeProperty("--reader-turn-bg");
  }

  /** The page color behind the transparent viewer: body first, then the host reader. */
  private pageBackground(): string {
    const win = this.doc.defaultView;
    const body = this.doc.body;
    const bodyBg = body && win ? win.getComputedStyle(body).backgroundColor : "";
    if (bodyBg && bodyBg !== "transparent" && bodyBg !== "rgba(0, 0, 0, 0)") return bodyBg;
    const frame = win?.frameElement as HTMLElement | null;
    const host = frame?.parentElement;
    const hostWin = host?.ownerDocument.defaultView;
    const hostBg = host && hostWin ? hostWin.getComputedStyle(host).backgroundColor : "";
    if (hostBg && hostBg !== "transparent" && hostBg !== "rgba(0, 0, 0, 0)") return hostBg;
    return "#fff";
  }

  private installStyle(): HTMLStyleElement | null {
    const existing = this.doc.getElementById(STYLE_ID);
    if (existing) return existing as HTMLStyleElement;
    const style = this.doc.createElement("style");
    style.id = STYLE_ID;
    style.textContent = COVER_STYLE;
    (this.doc.head ?? this.doc.documentElement).appendChild(style);
    return style;
  }
}
