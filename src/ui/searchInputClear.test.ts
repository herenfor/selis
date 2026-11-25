import { describe, expect, it } from "vitest";

// The native search cancel button lives in the browser's shadow UI, so a DOM test cannot see it.
// Assert the stylesheet hides it wherever a component draws its own clear button instead
// (Issue: the shelf search box showed two X buttons that both cleared the query).
const fs: { readFileSync(path: URL, encoding: "utf8"): string } = await import("node:" + "fs");
const read = (path: URL) => fs.readFileSync(path, "utf8");

describe("search inputs with a custom clear button", () => {
  it("hide the native cancel button so only one X shows", () => {
    const css = [
      read(new URL("../styles.css", import.meta.url)),
      read(new URL("./shelfZen.css", import.meta.url)),
      read(new URL("./sidebarDrawer.css", import.meta.url)),
    ].join("\n");
    // .search-input pairs with .search-clear, .shelf-quick-filter-input with .shelf-quick-filter-clear,
    // .sidebar-toc-filter-input with .sidebar-toc-filter-clear.
    for (const input of ["search-input", "shelf-quick-filter-input", "sidebar-toc-filter-input"]) {
      expect(css).toContain(`.${input}::-webkit-search-cancel-button`);
    }
  });
});
