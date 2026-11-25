import { describe, expect, it } from "vitest";
import { isLayoutResourceLoad } from "./resourceLoadReflow";

describe("layout resource load events", () => {
  it("reflows for images and linked stylesheets", () => {
    expect(isLayoutResourceLoad({ target: { localName: "img" } } as unknown as Event)).toBe(true);
    expect(isLayoutResourceLoad({ target: { localName: "image" } } as unknown as Event)).toBe(true);
    expect(isLayoutResourceLoad({ target: { localName: "LINK" } } as unknown as Event)).toBe(true);
  });

  it("ignores reader-owned style insertion and unrelated load events", () => {
    expect(isLayoutResourceLoad({ target: { localName: "style" } } as unknown as Event)).toBe(false);
    expect(isLayoutResourceLoad({ target: { localName: "iframe" } } as unknown as Event)).toBe(false);
    expect(isLayoutResourceLoad({ target: null } as unknown as Event)).toBe(false);
  });
});
