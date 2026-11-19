// A fresh turn has already asked for the next chapter or track. Let the compositor finish
// the current movement in about one frame; the existing finished callback still owns the landing.
const HANDOFF_TAIL_MS = 16;

export function expediteChapterHandoff(animations: readonly Animation[]): void {
  const lead = animations[0];
  const end = lead?.effect?.getComputedTiming().endTime;
  if (typeof end !== "number" || typeof lead.currentTime !== "number") return;
  const rate = (end - lead.currentTime) / HANDOFF_TAIL_MS;
  if (rate <= lead.playbackRate) return;
  for (const animation of animations) animation.updatePlaybackRate(rate);
}
