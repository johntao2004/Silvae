import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BooklistSummary, BrowseBook } from "../domain/types";
import { TestProviders } from "../test/TestProviders";
import { tokens } from "../theme/tokens";
import { BooklistCard, CoverMosaic } from "./CatalogDiscoveryCards";

const originalMatchMedia = window.matchMedia;

function mockMobileViewport(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn((query: string) => ({
      matches: query === "(max-width: 767.95px)" ? matches : false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

const makeBooks = (count: number): BrowseBook[] => Array.from({ length: count }, (_, index) => ({
  id: `book-${index + 1}`,
  title: `Book ${index + 1}`,
  author: "Author",
  coverUrl: `/covers/${index + 1}.jpg`,
  available: true,
  addedAt: "2026-10-22T00:00:00Z",
}));

describe("CoverMosaic", () => {
  afterEach(() => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      configurable: true,
      value: originalMatchMedia,
    });
  });

  it("uses 1 / 1 square framing in CoverMosaic and BooklistCard across desktop and mobile", () => {
    const sampleBooklist: BooklistSummary = {
      id: "bl-1",
      title: "移动紧凑书单",
      description: "紧凑展示",
      kind: "PERSONAL",
      visibility: "PUBLIC",
      ownerDisplayName: "林",
      bookCount: 2,
      previewBooks: makeBooks(2),
      ownedByViewer: false,
      editable: false,
      revision: 1,
      hiddenPublicBookCount: 0,
      updatedAt: "2026-08-21T03:00:00Z",
    };

    const { unmount } = render(<CoverMosaic books={makeBooks(2)} label="默认书单封面" />);
    const defaultMosaic = screen.getByRole("img", { name: "默认书单封面" });
    const defaultContent = defaultMosaic.querySelector("[data-mosaic-content]");
    expect(defaultContent).not.toBeNull();
    expect(getComputedStyle(defaultMosaic).aspectRatio).toBe("1 / 1");
    expect(getComputedStyle(defaultMosaic).placeItems).toBe("center");
    const mosaicStyles = Array.from(document.head.querySelectorAll("style[data-humite-sx]"))
      .map((el) => el.textContent ?? "")
      .join("\n");
    const frameClass = Array.from(defaultMosaic.classList).find((name) => name.startsWith("bk-sx-"));
    const contentClass = Array.from(defaultContent!.classList).find((name) => name.startsWith("bk-sx-"));
    expect(frameClass).toBeDefined();
    expect(contentClass).toBeDefined();
    expect(mosaicStyles).toContain(`.${frameClass}{`);
    expect(mosaicStyles).toContain("border: 1px solid var(--color-border)");
    expect(mosaicStyles).toContain(`.${contentClass}{`);
    expect(mosaicStyles).toContain("width: min(100cqw,");
    unmount();

    mockMobileViewport(false);
    const desktopView = render(
      <TestProviders>
        <BooklistCard booklist={sampleBooklist} />
      </TestProviders>,
    );
    const desktopMosaic = screen.getByRole("img", { name: "移动紧凑书单书单封面" });
    expect(getComputedStyle(desktopMosaic).aspectRatio).toBe("1 / 1");
    expect(getComputedStyle(desktopMosaic.closest(".bk-discovery-card")!).maxWidth).toBe("none");
    desktopView.unmount();

    mockMobileViewport(true);
    render(
      <TestProviders>
        <BooklistCard booklist={sampleBooklist} />
      </TestProviders>,
    );
    expect(getComputedStyle(screen.getByRole("img", { name: "移动紧凑书单书单封面" })).aspectRatio).toBe("1 / 1");
  });

  it.each([
    [0, "empty", "0"],
    [1, "single", "1"],
    [2, "pair", "2"],
    [3, "row", "3"],
    [4, "quad", "2"],
  ] as const)("uses the %s-cover layout", (count, layout, columns) => {
    const { unmount } = render(<CoverMosaic books={makeBooks(count)} label="测试书单封面" compact />);
    const mosaic = screen.getByRole("img", { name: "测试书单封面" });

    expect(mosaic).toHaveAttribute("data-mosaic-layout", layout);
    expect(mosaic).toHaveAttribute("data-mosaic-columns", columns);
    expect(mosaic.querySelectorAll("[data-book-cover]")).toHaveLength(count);

    if (count > 0) {
      const content = mosaic.querySelector("[data-mosaic-content]");
      expect(content).not.toBeNull();
      expect(getComputedStyle(content!).gap).toBe(`${tokens.spacing[1]}px`);
      for (const frame of mosaic.querySelectorAll("[data-book-cover]")) {
        expect(getComputedStyle(frame).aspectRatio).toBe("3 / 4");
      }
    } else {
      expect(mosaic.querySelector("[data-mosaic-content]")).toBeNull();
      expect(mosaic.querySelector("[data-book-cover]")).toBeNull();
    }
    unmount();
  });

  it("keeps the empty state in the same frame geometry as a populated compact mosaic", () => {
    const { rerender } = render(<CoverMosaic books={[]} label="书单封面" compact />);
    const empty = screen.getByRole("img", { name: "书单封面" });
    const emptyFrameStyle = getComputedStyle(empty);

    rerender(<CoverMosaic books={makeBooks(4)} label="书单封面" compact />);
    const populated = screen.getByRole("img", { name: "书单封面" });
    const populatedFrameStyle = getComputedStyle(populated);

    expect(emptyFrameStyle.aspectRatio).toBe(populatedFrameStyle.aspectRatio);
    expect(emptyFrameStyle.borderRadius).toBe(populatedFrameStyle.borderRadius);
    expect(emptyFrameStyle.backgroundColor).toBe(populatedFrameStyle.backgroundColor);
  });
});
