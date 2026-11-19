import { nextLinearIndex } from "../core/book";
import type { Book } from "../core/types";
import type { ChapterState } from "../render/paginator";

const EDGE_LOOKAHEAD_PAGES = 2;
const NEIGHBOR_YIELD_MS = 16;

/** Near-edge read-ahead uses the existing five live frames. Remote warm-up has its own idle clock. */
export class ChapterPreloadSchedule {
  direction: 1 | -1 = 1;
  private timer: number | null = null;
  private due = Infinity;
  private pending: (() => void) | null = null;

  nearBoundary(state: ChapterState | undefined): boolean {
    if (state?.status !== "ready" || state.mode === "scroll") return false;
    const remaining = this.direction === 1 ? state.pageCount - 1 - state.currentPage : state.currentPage;
    return remaining <= EDGE_LOOKAHEAD_PAGES;
  }

  indices(book: Book, current: number, approaching: boolean): number[] {
    const direction = approaching ? this.direction : 1;
    const opposite = direction === 1 ? -1 : 1;
    const next = nextLinearIndex(book, current, direction);
    const back = nextLinearIndex(book, current, opposite);
    const next2 = next < 0 ? -1 : nextLinearIndex(book, next, direction);
    const back2 = back < 0 ? -1 : nextLinearIndex(book, back, opposite);
    const next3 = approaching && next2 >= 0 ? nextLinearIndex(book, next2, direction) : -1;
    const neighbors = [next, back, next2, next3 >= 0 ? next3 : back2];
    return [current, ...neighbors.filter(index => index >= 0)];
  }

  request(run: () => void, idleDelay: number, seamless: boolean, approaching: boolean): void {
    // Yield the foreground task. New taps may advance this deadline but cannot keep pushing it away.
    const delay = approaching ? Math.min(idleDelay, NEIGHBOR_YIELD_MS) : idleDelay;
    const due = Date.now() + delay;
    if (seamless && this.timer !== null && this.due <= due) {
      this.pending = run;
      return;
    }
    this.cancel();
    this.pending = run;
    this.due = due;
    this.timer = window.setTimeout(() => {
      this.timer = null;
      this.due = Infinity;
      const pending = this.pending;
      this.pending = null;
      pending?.();
    }, delay);
  }

  cancel(): void {
    this.pending = null;
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
    this.due = Infinity;
  }
}
