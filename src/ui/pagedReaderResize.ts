/** A settled pin releases the held page size synchronously. A window resize
 * has no corresponding end event, so keep its existing quiet period. */
const dockSettled = "reader-dock-settled";

export function notifyDockSizeSettled(page: HTMLElement): void {
  page.dispatchEvent(new Event(dockSettled));
}

export function observePagedReaderResize(
  host: HTMLElement,
  invalidatePreloads: () => void,
  reflow: () => void,
): () => void {
  const dockPage = host.closest(".sidebar-dock-page");
  let width = -1;
  let height = -1;
  let timer: number | undefined;

  const resize = (settled: boolean) => {
    const w = host.clientWidth;
    const h = host.clientHeight;
    if (w === width && h === height) return;
    width = w;
    height = h;
    window.clearTimeout(timer);
    invalidatePreloads();
    if (settled) reflow();
    else timer = window.setTimeout(reflow, 250);
  };
  const onDockSettled = () => resize(true);
  const observer = new ResizeObserver(() => resize(false));
  dockPage?.addEventListener(dockSettled, onDockSettled);
  observer.observe(host);
  return () => {
    observer.disconnect();
    dockPage?.removeEventListener(dockSettled, onDockSettled);
    window.clearTimeout(timer);
  };
}
