/**
 * 章节导航触发序号（startAtEnd / anchorNonce）的消费与严格模式回滚控制器。
 *
 * 将“是否首次消费章末定位、是否显式锚点跳转、以及未提交卸载前保持旧序号”的状态
 * 管理抽离为独立纯逻辑，避免 React StrictMode 双重挂载或快速取消导致 startAtEnd 丢失。
 */

export interface ChapterNavigationNonceState {
  startAtEndNonce: number | null;
  anchorNonce: number;
}

export interface ChapterLoadNonceTransaction {
  readonly startAtEnd: boolean;
  readonly explicitNavigation: boolean;
  commit(): void;
  rollbackIfUncommitted(): void;
}

/** 初始化导航序号快照：首次即带 atEnd=true 时延后到真正提交再标记消费。 */
export function createInitialNavigationNonceState(
  startAtEnd: { readonly nonce: number; readonly atEnd: boolean },
  anchorNonce: number,
): ChapterNavigationNonceState {
  return {
    startAtEndNonce: startAtEnd.atEnd ? null : startAtEnd.nonce,
    anchorNonce,
  };
}

/** 预备层就地接管（已由显示满足本次请求）：直接同步消费两个序号。 */
export function adoptNavigationNonces(
  state: ChapterNavigationNonceState,
  startAtEndNonce: number,
  anchorNonce: number,
): void {
  state.startAtEndNonce = startAtEndNonce;
  state.anchorNonce = anchorNonce;
}

/** 启动一次章节加载事务：在提交前发生清理时可完整回滚，不误吞新请求。 */
export function beginChapterLoadNonces(
  state: ChapterNavigationNonceState,
  request: {
    readonly startAtEnd: { readonly nonce: number; readonly atEnd: boolean };
    readonly anchorNonce: number;
  },
): ChapterLoadNonceTransaction {
  const prevStartAtEndNonce = state.startAtEndNonce;
  const prevAnchorNonce = state.anchorNonce;
  const isNewRequest = request.startAtEnd.nonce !== prevStartAtEndNonce;
  const explicitNavigation = prevAnchorNonce !== request.anchorNonce;
  state.startAtEndNonce = request.startAtEnd.nonce;
  state.anchorNonce = request.anchorNonce;
  const startAtEnd = isNewRequest && !explicitNavigation ? request.startAtEnd.atEnd : false;
  let committed = false;

  return {
    startAtEnd,
    explicitNavigation,
    commit() {
      committed = true;
    },
    rollbackIfUncommitted() {
      if (committed) return;
      state.startAtEndNonce = prevStartAtEndNonce;
      state.anchorNonce = prevAnchorNonce;
    },
  };
}
