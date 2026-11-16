import { describe, expect, it } from "vitest";
import {
  adoptNavigationNonces,
  beginChapterLoadNonces,
  createInitialNavigationNonceState,
} from "./chapterNavigationNonce";

describe("chapterNavigationNonce (ER-0209)", () => {
  it("preserves startAtEnd across an uncommitted StrictMode unmount/remount cycle", () => {
    const state = createInitialNavigationNonceState({ nonce: 3, atEnd: true }, 0);
    const firstMount = beginChapterLoadNonces(state, {
      startAtEnd: { nonce: 3, atEnd: true },
      anchorNonce: 0,
    });
    expect(firstMount.startAtEnd).toBe(true);
    expect(state.startAtEndNonce).toBe(3);

    // StrictMode cleans up before the async chapter load commits.
    firstMount.rollbackIfUncommitted();
    expect(state.startAtEndNonce).toBeNull();

    const secondMount = beginChapterLoadNonces(state, {
      startAtEnd: { nonce: 3, atEnd: true },
      anchorNonce: 0,
    });
    expect(secondMount.startAtEnd).toBe(true);
    secondMount.commit();
    secondMount.rollbackIfUncommitted();
    expect(state.startAtEndNonce).toBe(3);

    // Later navigation without a new startAtEnd nonce does not re-jump to end.
    const nextRun = beginChapterLoadNonces(state, {
      startAtEnd: { nonce: 3, atEnd: true },
      anchorNonce: 0,
    });
    expect(nextRun.startAtEnd).toBe(false);
  });

  it("does not let a stale startAtEnd preempt an explicit anchor navigation", () => {
    const state = createInitialNavigationNonceState({ nonce: 2, atEnd: false }, 0);
    const pendingBack = beginChapterLoadNonces(state, {
      startAtEnd: { nonce: 3, atEnd: true },
      anchorNonce: 0,
    });
    pendingBack.rollbackIfUncommitted();

    const tocJump = beginChapterLoadNonces(state, {
      startAtEnd: { nonce: 3, atEnd: true },
      anchorNonce: 1,
    });
    expect(tocJump.explicitNavigation).toBe(true);
    expect(tocJump.startAtEnd).toBe(false);
  });

  it("records adopted navigation nonces cleanly", () => {
    const state = createInitialNavigationNonceState({ nonce: -2, atEnd: true }, 0);
    adoptNavigationNonces(state, 5, 2);
    expect(state).toEqual({ startAtEndNonce: 5, anchorNonce: 2 });
  });
});
