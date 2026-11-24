export interface ScriptElement {
  tag: string;
  id: string;
  className: string;
  text: string;
  hidden: boolean;
}

export interface ScriptChange {
  index: number;
  text?: string;
  hidden?: boolean;
  className?: string;
}

/** The guest sees values only. No host objects or callbacks enter the runtime. */
export function scriptDocumentSource(elements: readonly ScriptElement[]): string {
  return `(() => {
    const values = ${JSON.stringify(elements)};
    const changes = new Map();
    const ready = [];
    const set = (index, name, value) => {
      let change = changes.get(index);
      if (!change) changes.set(index, change = {index});
      change[name] = value;
      values[index][name] = value;
    };
    const nodes = values.map((element, index) => Object.freeze({
      get id() { return element.id; },
      get tagName() { return element.tag.toUpperCase(); },
      get textContent() { return element.text; },
      set textContent(value) { set(index, 'text', String(value).slice(0, 4096)); },
      get hidden() { return element.hidden; },
      set hidden(value) { set(index, 'hidden', Boolean(value)); },
      get className() { return element.className; },
      set className(value) { set(index, 'className', String(value).slice(0, 512)); }
    }));
    function select(selector) {
      const match = /^(?:([a-zA-Z][\\w-]*)|([#.])([\\w-]+))$/.exec(String(selector));
      if (!match) return [];
      return nodes.filter((_, i) => {
        const v = values[i];
        return match[1] ? v.tag === match[1].toLowerCase()
          : match[2] === '#' ? v.id === match[3] : v.className.split(/\\s+/).includes(match[3]);
      });
    }
    const doc = Object.freeze({
      getElementById: id => nodes[values.findIndex(v => v.id === String(id))] ?? null,
      querySelector: selector => select(selector)[0] ?? null,
      querySelectorAll: select,
      addEventListener: (type, callback) => {
        if (type === 'DOMContentLoaded' && typeof callback === 'function' && ready.length < 32) ready.push(callback);
      }
    });
    Object.defineProperty(globalThis, 'document', {value: doc});
    Object.defineProperty(globalThis, 'window', {value: globalThis});
    const stringify = JSON.stringify;
    return () => {
      for (const callback of ready) callback.call(doc);
      return stringify([...changes.values()]);
    };
  })()`;
}
