export function observeFrameResize(frame: HTMLIFrameElement, reflow: () => void): () => void {
  if (typeof ResizeObserver === "undefined") return () => {};
  const observer = new ResizeObserver(() => reflow());
  observer.observe(frame);
  return () => observer.disconnect();
}
