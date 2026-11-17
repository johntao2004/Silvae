import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TestProviders } from "../test/TestProviders";
import { useHumiteTheme } from "./HumiteThemeProvider";

function ThemeControls() {
  const { mode, setMode } = useHumiteTheme();
  return <><output aria-label="当前主题">{mode}</output><button onClick={() => setMode("NIGHT")}>夜间</button></>;
}

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("restores the persisted site theme", () => {
  localStorage.setItem("humite-site-theme", "WHITE");
  render(<TestProviders><ThemeControls /></TestProviders>);
  expect(screen.getByLabelText("当前主题")).toHaveTextContent("WHITE");
});

it("keeps the site usable when browser storage access is denied", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new DOMException("Storage blocked", "SecurityError"); });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("Storage blocked", "SecurityError"); });

  render(<TestProviders><ThemeControls /></TestProviders>);
  expect(screen.getByLabelText("当前主题")).toHaveTextContent("PAPER");
  fireEvent.click(screen.getByRole("button", { name: "夜间" }));
  expect(screen.getByLabelText("当前主题")).toHaveTextContent("NIGHT");
  expect(document.documentElement).toHaveAttribute("data-humite-theme", "night");
});

it("applies a new theme even when saving preferences exceeds the storage quota", () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("Quota exceeded", "QuotaExceededError"); });
  render(<TestProviders><ThemeControls /></TestProviders>);
  fireEvent.click(screen.getByRole("button", { name: "夜间" }));
  expect(screen.getByLabelText("当前主题")).toHaveTextContent("NIGHT");
  expect(document.documentElement).toHaveAttribute("data-humite-theme", "night");
});
