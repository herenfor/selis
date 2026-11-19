import type { ShareTextRange } from "./shareDraftBuilder";

function segments(root: HTMLElement) {
  return [...root.querySelectorAll<HTMLElement>("[data-share-start]")].flatMap((el) => {
    const node = el.firstChild;
    return node?.nodeType === Node.TEXT_NODE ? [{ node, start: Number(el.dataset.shareStart), size: node.textContent?.length ?? 0 }] : [];
  });
}

export function shareFolioSelection(root: HTMLElement): ShareTextRange | null {
  const selection = root.ownerDocument.getSelection();
  if (!selection?.rangeCount || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  let first: number | undefined;
  let last: number | undefined;
  for (const { node, start, size } of segments(root)) {
    if (!range.intersectsNode(node)) continue;
    const from = range.startContainer === node ? range.startOffset : 0;
    const to = range.endContainer === node ? range.endOffset : size;
    if (to <= from) continue;
    first ??= start + from;
    last = start + to;
  }
  return first !== undefined && last !== undefined ? { start: first, end: last } : null;
}

export function shareFolioDomRange(root: HTMLElement, range: ShareTextRange): Range | null {
  const items = segments(root);
  const first = items.find(({ start, size }) => start <= range.start && range.start < start + size);
  const last = items.find(({ start, size }) => start < range.end && range.end <= start + size);
  if (!first || !last) return null;
  const dom = root.ownerDocument.createRange();
  dom.setStart(first.node, range.start - first.start);
  dom.setEnd(last.node, range.end - last.start);
  return dom;
}
