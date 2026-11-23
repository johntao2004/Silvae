import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { CollectionsBookmarkOutlined, DescriptionOutlined, LibraryBooksOutlined } from "@/ui/icons";
import { MobileBottomNav, type MobileBottomNavItem } from "./MobileBottomNav";

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="current-location">{location.pathname}</output>;
}

const sampleItems: MobileBottomNavItem[] = [
  { label: "藏书", path: "/library", icon: <LibraryBooksOutlined />, active: true },
  { label: "书单", path: "/booklists", icon: <CollectionsBookmarkOutlined />, active: false },
  { label: "文章", path: "/articles", icon: <DescriptionOutlined />, active: false },
];

describe("MobileBottomNav", () => {
  it("renders navigation items with aria-current on the active item", () => {
    render(
      <MemoryRouter initialEntries={["/library"]}>
        <MobileBottomNav items={sampleItems} />
      </MemoryRouter>,
    );

    const nav = screen.getByRole("navigation", { name: "底部导航" });
    expect(nav).toHaveClass("bk-mobile-bottom-nav");

    const libraryLink = screen.getByRole("link", { name: "藏书" });
    const booklistsLink = screen.getByRole("link", { name: "书单" });
    const articlesLink = screen.getByRole("link", { name: "文章" });

    expect(libraryLink).toHaveAttribute("aria-current", "page");
    expect(libraryLink).toHaveClass("bk-mobile-bottom-nav__item", "bk-mobile-bottom-nav__item--active");
    expect(booklistsLink).not.toHaveAttribute("aria-current");
    expect(booklistsLink).toHaveClass("bk-mobile-bottom-nav__item");
    expect(booklistsLink).not.toHaveClass("bk-mobile-bottom-nav__item--active");
    expect(articlesLink).not.toHaveAttribute("aria-current");
  });

  it("navigates through React Router when clicking an item", () => {
    render(
      <MemoryRouter initialEntries={["/library"]}>
        <MobileBottomNav items={sampleItems} />
        <LocationProbe />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("current-location")).toHaveTextContent("/library");
    fireEvent.click(screen.getByRole("link", { name: "书单" }));
    expect(screen.getByTestId("current-location")).toHaveTextContent("/booklists");
  });
});
