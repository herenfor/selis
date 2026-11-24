import { useCallback, useEffect } from "react";
import { nextLinearIndex } from "../core/book";
import type { Book } from "../core/types";
import type { SingleLeafSpread, SingleLeafSpreads } from "./singleLeafSpreads";

export interface SeamPreparationOptions {
  book: Book;
  spineIndex: number;
  /** 双页显示时相邻章可能被 A13 并排组接管；单页时永远按普通章处理。 */
  spreadsShown: boolean;
  /** 章边联动可用（高性能预读 + 滑动/覆盖动画 + 未开启减少动态效果）。 */
  seamTurnPossible: boolean;
  imageSpreads: SingleLeafSpreads;
  pair: SingleLeafSpread | null;
  parkedIndex: number;
  lookaheadIndex: number;
  /** 前向连续段正在等分类的章；-1 表示没有。 */
  frontRunWaiting: number;
  /** 分类或叶数变化时由外层递增，驱动重新分类与重新规划。 */
  revision: number;
  /** 一次分类完成后通知外层递增 revision。 */
  onClassified(): void;
}

/**
 * A16 章边联动的相邻章准备。
 *
 * 章边联动要求相邻章已经分类为普通章（不是 A13 并排组）才能预读与接任。
 * 分类只读 XHTML，异步且按需：这里在章边联动可用时提前分类前后章，并把
 * 结果通过 revision 反馈给外层，让预读与显示层重新规划。
 *
 * 覆盖模式也必须提前分类：未分类的邻章会被 seamTargetEligible 判为不可联动，
 * 既不预读也不接联动，第一次到章边就只能退回普通换章。
 */
export function useSeamPreparation(options: SeamPreparationOptions): (index: number) => boolean {
  const {
    book, spineIndex, spreadsShown, seamTurnPossible, imageSpreads, pair,
    parkedIndex, lookaheadIndex, frontRunWaiting, revision, onClassified,
  } = options;
  const seamTargetEligible = useCallback(
    (index: number) => !spreadsShown || imageSpreads.peek(index) === null,
    [spreadsShown, imageSpreads, revision],
  );
  useEffect(() => {
    if (!spreadsShown || !seamTurnPossible) return;
    // 提前分类相邻显示单元（只读 XHTML），让章边联动知道它们是否会并排；分好后重新规划。
    const controller = new AbortController();
    const first = pair?.left ?? spineIndex;
    const last = pair ? pair.right ?? pair.left : spineIndex;
    const wanted = [nextLinearIndex(book, last, 1), nextLinearIndex(book, first, -1), parkedIndex, lookaheadIndex];
    // The front-run plan waits for one chapter's classification at a time.
    if (frontRunWaiting >= 0) wanted.push(frontRunWaiting);
    for (const index of wanted) {
      if (index >= 0 && imageSpreads.peek(index) === undefined) {
        void imageSpreads.resolve(index, controller.signal).then(() => {
          if (!controller.signal.aborted) onClassified();
        }, () => {});
      }
    }
    return () => controller.abort();
  }, [book, spineIndex, pair, parkedIndex, lookaheadIndex, spreadsShown, seamTurnPossible,
    imageSpreads, frontRunWaiting, revision, onClassified]);
  return seamTargetEligible;
}
