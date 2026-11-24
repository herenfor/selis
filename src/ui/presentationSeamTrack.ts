import type { Book } from "../core/types";
import type { SingleLeafSpread } from "./singleLeafSpreads";
import type { ReaderHandle } from "./ReaderView";
import type { SeamMotion } from "./chapterSeam";
import { planSeamTrack, type PresentationPlan, type SeamTrack, type SeamTrackScreen } from "./presentationStack";

interface TrackOptions {
  book: Book;
  plan: PresentationPlan;
  pair: SingleLeafSpread | null;
  spineIndex: number;
  peek(index: number): SingleLeafSpread | null | undefined;
  ready(key: string, edge: "start" | "end"): boolean;
  inner(key: string, direction: 1 | -1): ReturnType<NonNullable<ReaderHandle["trackChain"]>>;
  motion: SeamMotion;
  direction: 1 | -1;
  targetKey: string;
  targetIndex: number;
  layerElement(key: string): HTMLElement | undefined;
}

/** Keep the settled-screen indices in the same order as the elements handed to ChapterSeam. */
export function presentationSeamTrack(options: TrackOptions) {
  const { book, plan, pair, spineIndex, peek, ready, inner, direction, targetKey, targetIndex, layerElement } = options;
  const elementOf = (screen: SeamTrackScreen) => screen.inner ? screen.inner.element as HTMLElement : layerElement(screen.key);
  function adjacent(): SeamTrack {
    const origin = { key: plan.mainKey, spineIndex, atEnd: false };
    const target = { key: targetKey, spineIndex: targetIndex, atEnd: direction === -1 };
    return direction === 1 ? { screens: [origin, target], current: 0 } : { screens: [target, origin], current: 1 };
  }
  function sliding(): SeamTrack {
    const track = planSeamTrack(book, plan, pair, spineIndex, peek, ready, inner);
    const at = track.current;
    const neighbor = track.screens[at + direction];
    if (neighbor?.key !== targetKey || neighbor.spineIndex !== targetIndex || !elementOf(neighbor)) return adjacent();
    // A paged reader owns its own opposite edge. Only a spread can continue in both directions.
    let low = at;
    let high = at;
    if (direction === -1 || pair) {
      while (low > 0 && elementOf(track.screens[low - 1])) low--;
    }
    if (direction === 1 || pair) {
      while (high + 1 < track.screens.length && elementOf(track.screens[high + 1])) high++;
    }
    return { screens: track.screens.slice(low, high + 1), current: at - low };
  }
  // Cover animates two whole layers: moving an inner iframe would leave its parent's stacking context behind.
  const track = options.motion === "cover" ? adjacent() : sliding();
  return { screens: track.screens, at: track.current, elements: track.screens.map(screen => elementOf(screen)!) };
}
