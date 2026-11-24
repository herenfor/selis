/**
 * A16 无缝换章：章边一屏与相邻章首/末屏并排，一起跟手、一起落定。
 *
 * 只在高性能预读开启时使用：相邻章已在缓存槽里排好、显示就绪，这里只负责两个
 * iframe 的合成层平移，不加载章节、不提交进度。落定在相邻章后由宿主走既有的
 * 换章提交与缓存升格；弹回则撤掉平移，当前章不变。
 *
 * 位置沿用运动会话的“阅读偏移”：两屏 offsets = [0, W]，按阅读顺序第 0 屏是前一章的
 * 边屏（lead），第 1 屏是后一章的边屏（trail）。前进时当前章是 lead，后退时当前章是
 * trail。lead 平移 −s·p，trail 平移 s·(W−p)，s 为阅读方向（RTL 为 −1）。
 */
import { holdInteractionBusy } from "../platform/cloudSyncActivity";
import {
  desktopSettlePlan,
  PageMotionSession,
  settlePlan,
  settleProgress,
  type InterruptResult,
  type MotionSample,
  type PageMotionDriver,
  type SettlePlan,
} from "../render/pageMotion";
import { pageAxisSign, type PageProgression } from "../render/pagedDirection";
import { expediteChapterHandoff } from "../render/chapterHandoffMotion";
import { surfaceBackground } from "./readerSurfaceBackground";

const KEYFRAMES = 32;
const COVER_SHADOW = "34px 0 46px rgba(0, 0, 0, .38)";
const COVER_SHADOW_PREV = "-34px 0 46px rgba(0, 0, 0, .38)";

type SeamElement = HTMLElement;

function isTransparent(value: string): boolean {
  return !value || value === "transparent" || value === "rgba(0, 0, 0, 0)";
}

/** 章边联动的呈现：滑动（两章并排移动）或覆盖（当前章滑出，下一章在下方露出）。 */
export type SeamMotion = "slide" | "cover";

/**
 * 若干屏的同步平移；与章内 TransformPageMotion 同一套中断/收尾约定。屏按阅读顺序排列，
 * 第 k 屏平移 s·(k·W − p)（s 为阅读方向，RTL 为 −1），p 为阅读偏移。两屏时即原来的
 * lead（−s·p）与 trail（s·(W−p)）。
 *
 * 覆盖模式只移动当前章那一屏：相邻章停在原位从下方露出，当前章带前缘阴影滑出，
 * 露出的目标页随进度由 0.94 提亮到 1；位置仍是同一阅读偏移，拖动/中断/落定不变。
 */
export class ChapterSeamDriver implements PageMotionDriver {
  private running: Animation[] = [];
  private releaseBusy: (() => void) | null = null;
  private held: number;
  private generation = 0;
  private disposed = false;
  private readonly sign: 1 | -1;
  private readonly cover: boolean;
  private readonly origin: number;
  private readonly target: number;
  private readonly coverRestore: Array<{ screen: SeamElement; background: string; filter: string }> = [];
  private targetBaseFilter = "";

  /** The running seam turn; while one runs, background sync waits. */
  private get animations(): Animation[] {
    return this.running;
  }

  private set animations(next: Animation[]) {
    this.running = next;
    if (next.length > 0 && !this.releaseBusy) this.releaseBusy = holdInteractionBusy();
    else if (next.length === 0 && this.releaseBusy) {
      this.releaseBusy();
      this.releaseBusy = null;
    }
  }

  constructor(
    private readonly screens: readonly SeamElement[],
    private readonly width: number,
    progression: PageProgression,
    initialPosition: number,
    private readonly onFault: (error: unknown) => void,
    motion: SeamMotion = "slide",
    origin = 0,
  ) {
    this.sign = pageAxisSign(progression);
    this.origin = origin;
    this.target = screens.length === 2 ? 1 - origin : -1;
    this.cover = motion === "cover" && this.target >= 0;
    this.held = initialPosition;
    if (this.cover) this.prepareCover();
    this.apply(initialPosition);
  }

  read(): MotionSample {
    if (this.animations.length === 0) return { position: this.held };
    const index = this.cover ? this.origin : 0;
    const first = this.screens[index];
    const value = first.ownerDocument.defaultView?.getComputedStyle(first).transform ?? "none";
    const x = value === "none" ? 0 : new DOMMatrixReadOnly(value).m41;
    return { position: (this.cover ? this.origin * this.width : 0) - x * this.sign };
  }

  interrupt(): InterruptResult {
    const sample = this.read();
    ++this.generation;
    const previous = this.animations;
    this.animations = [];
    // 先写同位置的底层样式再撤动画呈现，同一任务内完成，不跳到旧目标。
    this.held = sample.position;
    this.apply(sample.position);
    for (const animation of previous) animation.cancel();
    return { kind: "held", sample };
  }

  write(position: number): void {
    if (this.disposed) return;
    this.held = position;
    this.apply(position);
  }

  animateTo(position: number, plan: SettlePlan, done: () => void): void {
    if (this.disposed) return;
    const from = this.held;
    const ticket = ++this.generation;
    if (plan.durationMs <= 0) {
      this.held = position;
      this.apply(position);
      done();
      return;
    }
    const desktop = plan.curve === "ease-out-cubic";
    const frames: Keyframe[][] = this.screens.map(() => []);
    const steps = desktop ? 1 : KEYFRAMES;
    for (let k = 0; k <= steps; k++) {
      const progress = desktop ? k : settleProgress(plan, k / KEYFRAMES);
      const at = from + (position - from) * progress;
      const offset = desktop ? undefined : k / KEYFRAMES;
      const coverProgress = this.coverProgress(at);
      this.screens.forEach((_, index) => {
        const frame: Keyframe = this.cover && index === this.target
          ? { transform: this.transform(index, index * this.width), filter: this.coverFilter(coverProgress) }
          : { transform: this.transform(index, at) };
        if (offset !== undefined) frame.offset = offset;
        frames[index].push(frame);
      });
    }
    const timing: KeyframeAnimationOptions = {
      duration: plan.durationMs,
      easing: desktop ? "cubic-bezier(0.3333333333, 1, 0.6666666667, 1)" : "linear",
      fill: "both",
    };
    const animations: Animation[] = [];
    try {
      // 同一任务内创建：各段动画同帧开始，同一时长与曲线，始终严丝合缝。
      this.screens.forEach((screen, index) => animations.push(screen.animate(frames[index], timing)));
    } catch (error) {
      // 只建成一部分时先收回；宿主在 onFault 里撤销整个联动（此后 done 不再有效）。
      for (const animation of animations) animation.cancel();
      this.onFault(error);
      if (this.disposed || ticket !== this.generation) return;
      this.held = position;
      this.apply(position);
      done();
      return;
    }
    this.animations = animations;
    void Promise.all(animations.map((animation) => animation.finished)).then(() => {
      if (this.disposed || ticket !== this.generation) return;
      this.held = position;
      this.apply(position);
      this.animations = [];
      for (const animation of animations) animation.cancel();
      done();
    }, (error) => {
      // cancel 会使 finished 拒绝：只有当前这一轮的拒绝才是真故障。
      if (this.disposed || ticket !== this.generation) return;
      this.animations = [];
      for (const animation of animations) animation.cancel();
      this.onFault(error);
    });
  }

  /** A further turn already needs the next track. Finish this hand-off without jumping the visible strip. */
  expediteLanding(): void {
    expediteChapterHandoff(this.animations);
  }

  /** 撤掉各屏的平移（交还给正常的单层显示）。 */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    ++this.generation;
    for (const animation of this.animations) animation.cancel();
    this.animations = [];
    for (const screen of this.screens) {
      screen.style.removeProperty("transform");
      if (!this.cover) continue;
      screen.style.removeProperty("z-index");
      screen.style.removeProperty("box-shadow");
    }
    // 页面底色与滤镜可能来自阅读器的视觉滤镜；只撤掉本次叠加的部分。
    for (const entry of this.coverRestore) {
      if (entry.background) entry.screen.style.setProperty("background-color", entry.background);
      else entry.screen.style.removeProperty("background-color");
      if (entry.filter) entry.screen.style.setProperty("filter", entry.filter);
      else entry.screen.style.removeProperty("filter");
    }
    this.coverRestore.length = 0;
  }

  private transform(index: number, position: number): string {
    return `translate3d(${this.sign * (index * this.width - position)}px, 0, 0)`;
  }

  /** 覆盖模式：当前章滑出，相邻章停在原位；只写这两屏的呈现。 */
  private apply(position: number): void {
    if (this.cover) {
      const progress = this.coverProgress(position);
      this.screens[this.origin].style.setProperty("transform", this.transform(this.origin, position));
      this.screens[this.target].style.setProperty("transform", this.transform(this.target, this.target * this.width));
      this.screens[this.target].style.setProperty("filter", this.coverFilter(progress));
      return;
    }
    this.screens.forEach((screen, index) => screen.style.setProperty("transform", this.transform(index, position)));
  }

  /** 覆盖模式只在开始时摆一次：层级、页面底色、前缘阴影与目标页初始亮度。 */
  private prepareCover(): void {
    const moving = this.screens[this.origin];
    const revealed = this.screens[this.target];
    const page = surfaceBackground(moving, ".reader") ?? "#fff";
    const physicalNext = (this.target > this.origin ? 1 : -1) * this.sign === 1;
    for (const screen of [moving, revealed]) {
      this.coverRestore.push({
        screen,
        background: screen.style.getPropertyValue("background-color"),
        filter: screen.style.getPropertyValue("filter"),
      });
    }
    moving.style.setProperty("z-index", "2");
    revealed.style.setProperty("z-index", "1");
    if (isTransparent(moving.style.getPropertyValue("background-color"))) moving.style.setProperty("background-color", page);
    if (isTransparent(revealed.style.getPropertyValue("background-color"))) revealed.style.setProperty("background-color", page);
    moving.style.setProperty("box-shadow", physicalNext ? COVER_SHADOW : COVER_SHADOW_PREV);
    this.targetBaseFilter = revealed.style.getPropertyValue("filter");
    revealed.style.setProperty("filter", this.coverFilter(0));
  }

  private coverProgress(position: number): number {
    if (!this.cover) return 0;
    return Math.max(0, Math.min(1, Math.abs(position - this.origin * this.width) / this.width));
  }

  private coverFilter(progress: number): string {
    const brightness = `brightness(${(0.94 + 0.06 * progress).toFixed(3)})`;
    const base = this.targetBaseFilter.trim();
    return base && base !== "none" ? `${base} ${brightness}` : brightness;
  }
}

export interface ChapterSeamOptions {
  /** 1 = 去下一章（当前章是 lead），-1 = 去上一章（当前章是 trail）。 */
  direction: 1 | -1;
  current: SeamElement;
  neighbor: SeamElement;
  /** 多屏轨道（外层显示层）：按阅读顺序排列的各屏，含 current；neighbor 是 direction 一侧
   * 的第一屏。不给时只有 current 与 neighbor 两屏。覆盖模式只用当前章与相邻章两屏。 */
  track?: readonly SeamElement[];
  /** 一屏宽（单页或双页都是整个视口宽）。 */
  width: number;
  progression: PageProgression;
  /** 触屏用松手曲线，桌面用与章内相同的缓出。 */
  touch: boolean;
  /** 章边联动的呈现；默认沿用滑动。 */
  motion?: SeamMotion;
  /** 落定：landed=true 停在别的屏（见 settledScreen），false 回到当前章。 */
  onSettled(landed: boolean): void;
  onFault(error: unknown): void;
}

export type SeamTurnResult = "moving" | "beyond" | "duplicate";

/**
 * 一次章边联动。拖动、点按、反向与打断全部沿用 PageMotionSession 的票据语义。
 * 两屏时一次最多跨一个章节边界；多屏轨道上，运动中的新命令直接改去更远的已备好屏，
 * 与章内连续翻页相同，只在最后停下时落定一次。
 */
export class ChapterSeam {
  readonly direction: 1 | -1;
  private readonly session: PageMotionSession;
  private readonly driver: ChapterSeamDriver;
  private readonly currentPage: number;
  private readonly screenCount: number;
  private dragBase = 0;
  private finished = false;
  private landedOn: number | null = null;

  constructor(private readonly options: ChapterSeamOptions) {
    this.direction = options.direction;
    const width = options.width;
    const motion = options.motion ?? "slide";
    // 覆盖模式只有“当前章滑出、相邻章露出”两层；多屏轨道不参与，避免第三层从下方透出。
    const screens = motion === "cover"
      ? (options.direction === 1 ? [options.current, options.neighbor] : [options.neighbor, options.current])
      : options.track ?? (options.direction === 1
        ? [options.current, options.neighbor] : [options.neighbor, options.current]);
    this.currentPage = screens.indexOf(options.current);
    if (this.currentPage < 0 || !screens.includes(options.neighbor)) throw new Error("seam track lacks its own screens");
    this.screenCount = screens.length;
    const start = this.currentPage * width;
    this.driver = new ChapterSeamDriver(screens, width, options.progression, start, (error) => this.fault(error),
      motion, this.currentPage);
    this.session = new PageMotionSession(
      this.driver,
      screens.map((_, index) => index * width),
      this.currentPage,
      (page) => this.settled(page),
      (sample) => this.settled(Math.max(0, Math.min(this.screenCount - 1, Math.round(sample.position / width)))),
      (distance, velocity) => options.touch ? settlePlan(distance, velocity) : desktopSettlePlan(distance, width),
    );
  }

  /** 落定在哪一屏（轨道下标）；未落定或回到当前屏时为 null。 */
  get settledScreen(): number | null {
    return this.landedOn;
  }

  /** 拖动或动画进行中（idle 只在构造后、被接手前短暂出现）。 */
  get moving(): boolean {
    const kind = this.session.state.kind;
    return kind === "dragging" || kind === "settling";
  }

  get done(): boolean {
    return this.finished;
  }

  /** 横向意图成立（含打断进行中的联动）；返回拖动票据。 */
  beginDrag(direction: 1 | -1): number | null {
    if (this.finished) return null;
    const result = this.session.beginDrag(direction);
    if (result.kind !== "dragging") return null;
    this.dragBase = result.sample.position;
    return result.ticket;
  }

  /** dx 为逻辑横向位移（负 = 前进），与章内拖动同一约定。 */
  drag(ticket: number, dx: number): void {
    this.session.drag(ticket, this.dragBase - dx);
  }

  /** 松手：direction 0 回起点屏，±1 去相邻屏；返回是否接住了该拖动。 */
  release(ticket: number, direction: -1 | 0 | 1, velocity: number | null): boolean {
    const state = this.session.state;
    if (state.kind !== "dragging" || state.ticket !== ticket) return false;
    return this.session.releaseDrag(ticket, state.originPage + direction, velocity) !== null;
  }

  /** A fresh gesture may request the screen beyond the prepared track. */
  releaseWouldOverflow(ticket: number, direction: 1 | -1): boolean {
    const state = this.session.state;
    return state.kind === "dragging" && state.ticket === ticket &&
      (state.originPage + direction < 0 || state.originPage + direction > this.screenCount - 1);
  }

  /** 独立翻页命令；"beyond" 表示越过了已备好的屏（宿主可预约到新章里再翻一次）。 */
  turn(inputId: number, direction: 1 | -1): SeamTurnResult {
    if (this.finished) return "beyond";
    const result = this.session.turn(inputId, direction);
    if (result.kind === "moving") return "moving";
    if (result.kind === "duplicate") return "duplicate";
    if (result.kind === "boundary" && this.session.state.kind === "settling") this.driver.expediteLanding();
    return "beyond";
  }

  /** 撤掉平移并结束（落定后升格完成、或被导航/重排/故障打断）。 */
  dispose(): void {
    this.finished = true;
    this.session.dispose();
  }

  private settled(page: number): void {
    if (this.finished) return;
    this.landedOn = page === this.currentPage ? null : page;
    this.options.onSettled(this.landedOn !== null);
  }

  private fault(error: unknown): void {
    this.options.onFault(error);
  }
}

/**
 * 外层显示层之间的联动（A16 第二阶段：普通视图与 A13 并排组之间）。由外层创建、显示
 * 相邻层并在落定后提交换章；当前显示只用 seam 驱动拖动与命令。
 */
export interface ExternalSeam {
  seam: ChapterSeam;
  /** One input owner across both leaves and the moving presentation surface. */
  input: SeamInputPort;
  targetIndex: number;
  /** 本次调用新建的联动；false 表示接到了已在进行的同一次联动（不能替别人取消）。 */
  fresh: boolean;
  /** 被显式定位、暂停或退出打断：没落定就撤平移、收回相邻层；已落定的交给外层接管。 */
  cancel(): void;
}

export interface SeamInputPort {
  preview(dx: number | null): void;
  turn(direction: 1 | -1): SeamTurnResult;
}
