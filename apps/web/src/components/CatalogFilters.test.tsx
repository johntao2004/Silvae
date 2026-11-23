import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CatalogFilters } from "./CatalogFilters";
import { MOBILE_VIEWPORT_MEDIA_QUERY } from "../hooks/useIsMobileViewport";

function renderMobileFilters({
  format = "ALL",
  sort = "recent",
  extraFilterCount = 0,
}: {
  format?: string;
  sort?: string;
  extraFilterCount?: number;
}) {
  return render(
    <CatalogFilters
      extraFilterCount={extraFilterCount}
      filter={{
        label: "格式",
        value: format,
        onChange: vi.fn(),
        options: [
          { value: "ALL", label: "全部格式" },
          { value: "EPUB", label: "EPUB" },
          { value: "PDF", label: "PDF" },
        ],
      }}
      sort={{
        label: "排序",
        value: sort,
        onChange: vi.fn(),
        options: [
          { value: "recent", label: "最近入库" },
          { value: "title", label: "按书名" },
          { value: "author", label: "按作者" },
        ],
      }}
    />,
  );
}

describe("CatalogFilters mobile filter badge", () => {
  beforeEach(() => {
    vi.spyOn(window, "matchMedia").mockImplementation((query: string) => ({
      matches: query === MOBILE_VIEWPORT_MEDIA_QUERY,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }));
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders plain filter button without count for defaults", () => {
    renderMobileFilters({ format: "ALL", sort: "recent", extraFilterCount: 0 });
    expect(screen.getByRole("button", { name: "筛选" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /筛选 \(/ })).not.toBeInTheDocument();
  });

  it("counts format filter once without double-counting", () => {
    renderMobileFilters({ format: "EPUB", sort: "recent", extraFilterCount: 0 });
    expect(screen.getByRole("button", { name: "筛选 (1)" })).toBeInTheDocument();
  });

  it("adds extraFilterCount to active control filters", () => {
    renderMobileFilters({ format: "EPUB", sort: "recent", extraFilterCount: 1 });
    expect(screen.getByRole("button", { name: "筛选 (2)" })).toBeInTheDocument();
  });

  it("counts sort selection once when non-default", () => {
    renderMobileFilters({ format: "ALL", sort: "title", extraFilterCount: 0 });
    expect(screen.getByRole("button", { name: "筛选 (1)" })).toBeInTheDocument();
  });
});
