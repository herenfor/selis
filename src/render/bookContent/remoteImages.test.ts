import { describe, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { DEFAULT_SETTINGS } from "../settings";

const { invoke } = vi.hoisted(() => ({
  invoke: vi.fn(async (command: string) => {
    if (command === "book_remote_image") return new ArrayBuffer(8);
    return undefined;
  }),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { prepareBookImages } from "./remoteImages";

function options() {
  return {
    basePath: "OEBPS/Text/ch1.xhtml",
    strictXml: false,
    urlFor: (path: string) => `blob:test/${path}`,
    settings: DEFAULT_SETTINGS,
    makeImageUrl: () => "blob:remote/test",
  };
}

describe("prepareBookImages", () => {
  it("loads remote images inside a visible noscript fallback", async () => {
    const { document } = parseHTML(
      '<html><body><noscript><img src="https://example.com/fallback.png"></noscript><p>text</p></body></html>'
    );
    // linkedom 的 getElementsByTagName("*") 不展开通配符；生产 DOM（parse5）支持。
    const original = document.getElementsByTagName.bind(document);
    (document as unknown as { getElementsByTagName(name: string): unknown }).getElementsByTagName = (name: string) =>
      name === "*" ? document.querySelectorAll("*") : original(name);
    const urls = await prepareBookImages(
      document as unknown as Document,
      options(),
      new AbortController().signal
    );
    expect(urls.has("https://example.com/fallback.png")).toBe(true);
    expect(invoke).toHaveBeenCalledWith(
      "book_remote_image",
      expect.objectContaining({ url: "https://example.com/fallback.png" })
    );
  });
});
