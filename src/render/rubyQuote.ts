/** Original chapter text with its canonical offset, before share typography. */
export interface SourceTextSlice {
  text: string;
  node?: Text;
  offset?: number;
  complete?: boolean;
}

export interface RubyQuote {
  text: string;
  /** Canonical chapter offset for each non-whitespace base character. */
  offsets: number[];
  /** Bounds in the base-character array, excluding whitespace. */
  readings: { start: number; end: number; text: string }[];
}

const visibleChar = (char: string) => !/\p{White_Space}/u.test(char);

function baseNodes(root: Node): Text[] {
  if (root.nodeType === 3) return visibleCharIn(root.textContent ?? "") ? [root as Text] : [];
  if (root.nodeType === 1 && (root as Element).matches("rt, rp, rtc, ruby")) return [];
  return Array.from(root.childNodes).flatMap(baseNodes);
}

function visibleCharIn(text: string): boolean {
  return /\P{White_Space}/u.test(text);
}

/** Pair adjacent bases/annotations as well as the explicit rb/rb/rt/rt form. */
function rubyGroups(ruby: Element) {
  const groups: { nodes: Text[]; text: string }[] = [];
  let bases: Node[] = [];
  let readings: string[] = [];
  const flush = () => {
    if (readings.length === bases.length && bases.every((node) => (node as Element).localName === "rb")) {
      readings.forEach((text, i) => groups.push({ nodes: baseNodes(bases[i]), text }));
    } else if (readings.length) {
      groups.push({ nodes: bases.flatMap(baseNodes), text: readings[0] });
    }
    bases = [];
    readings = [];
  };
  for (const child of Array.from(ruby.childNodes)) {
    const tag = (child as Element).localName;
    if (tag === "rp" || tag === "rtc") continue;
    if (tag === "rt") {
      readings.push((child.textContent ?? "").replace(/\s+/gu, " ").trim());
    } else if (visibleCharIn(child.textContent ?? "")) {
      if (readings.length) flush();
      bases.push(child);
    }
  }
  flush();
  return groups;
}

export function projectRubyQuote(slices: readonly SourceTextSlice[]): RubyQuote | undefined {
  if (!slices.some(({ node }) => node?.parentElement?.closest("ruby"))) return undefined;
  const rubies = new Set<Element>();
  const offsets: number[] = [];
  const parts: string[] = [];
  const bases = new Map<Text, { start: number; end: number }>();
  for (const { node, text, offset = 0, complete } of slices) {
    const parent = node?.parentElement;
    const ruby = parent?.closest("ruby");
    if (ruby) {
      rubies.add(ruby);
      if (parent?.closest("rt, rp, rtc")) continue;
    }
    const start = offsets.length;
    let at = offset;
    for (const char of text) if (visibleChar(char)) offsets.push(at++);
    parts.push(text);
    if (node && ruby && complete && offsets.length > start) bases.set(node, { start, end: offsets.length });
  }
  const readings: RubyQuote["readings"] = [];
  for (const ruby of rubies) {
    for (const group of rubyGroups(ruby)) {
      const selected = group.nodes.map((node) => bases.get(node));
      if (group.text && selected.length && selected.every((part) => part !== undefined)) {
        readings.push({ start: selected[0]!.start, end: selected[selected.length - 1]!.end, text: group.text });
      }
    }
  }
  return { text: parts.join(""), offsets, readings };
}
