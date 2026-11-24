import { createElement, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Book } from "../core/types";
import type { SingleLeafSpreads } from "./singleLeafSpreads";
import { createReactDomHarness } from "../test/reactDomHarness";
import { useSeamPreparation } from "./useSeamPreparation";

const book = {
  version: 3,
  spine: [0, 1, 2, 3].map(() => ({ linear: true })),
} as unknown as Book;

async function probe(
  dom: ReturnType<typeof createReactDomHarness>,
  options: {
    spreadsShown?: boolean;
    seamTurnPossible?: boolean;
    peek: (index: number) => unknown;
    resolve: (index: number) => Promise<unknown>;
  },
): Promise<{ eligible: () => boolean }> {
  const state = { eligible: () => false };
  function Probe() {
    const [revision, setRevision] = useState(0);
    const check = useSeamPreparation({
      book,
      spineIndex: 0,
      spreadsShown: options.spreadsShown ?? true,
      seamTurnPossible: options.seamTurnPossible ?? true,
      imageSpreads: { peek: options.peek, resolve: options.resolve } as unknown as SingleLeafSpreads,
      pair: null,
      parkedIndex: -1,
      lookaheadIndex: -1,
      frontRunWaiting: -1,
      revision,
      onClassified: () => setRevision((value) => value + 1),
    });
    state.eligible = () => check(1);
    return createElement("div", { "data-eligible": check(1) ? "yes" : "no" });
  }
  await dom.render(createElement(Probe));
  return state;
}

describe("useSeamPreparation", () => {
  it("classifies the next chapter and becomes eligible once the result lands", async () => {
    const dom = createReactDomHarness();
    let classified = false;
    const resolve = vi.fn(async () => {
      classified = true;
      return null;
    });
    const state = await probe(dom, { peek: () => (classified ? null : undefined), resolve });
    await dom.run(async () => { await Promise.resolve(); });
    expect(resolve).toHaveBeenCalledWith(1, expect.any(AbortSignal));
    expect(state.eligible()).toBe(true);
    await dom.dispose();
  });

  it("keeps an unclassified neighbour ineligible until its classification lands", async () => {
    const dom = createReactDomHarness();
    const resolve = vi.fn(() => new Promise<unknown>(() => {}));
    const state = await probe(dom, { peek: () => undefined, resolve });
    await dom.run(async () => { await Promise.resolve(); });
    expect(state.eligible()).toBe(false);
    await dom.dispose();
  });

  it("does not read neighbours when the seam cannot run", async () => {
    const dom = createReactDomHarness();
    const resolve = vi.fn(async () => null);
    await probe(dom, { seamTurnPossible: false, peek: () => undefined, resolve });
    await dom.run(async () => { await Promise.resolve(); });
    expect(resolve).not.toHaveBeenCalled();
    await dom.dispose();
  });
});
