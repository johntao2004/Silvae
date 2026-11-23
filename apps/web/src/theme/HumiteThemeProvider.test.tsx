import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TestProviders } from "../test/TestProviders";
import { themePreferenceKey, useHumiteTheme } from "./HumiteThemeProvider";
import { createAntdTheme, humiteThemeOptions } from "./theme";
import { tokens } from "./tokens";

function ThemeControls() {
  const { mode, isAuto, setMode, followSystem } = useHumiteTheme();
  return (
    <>
      <output aria-label="当前主题">{mode}</output>
      <output aria-label="自动跟随">{String(isAuto)}</output>
      <button onClick={() => setMode("NIGHT")}>夜间</button>
      <button onClick={() => followSystem()}>跟随系统</button>
    </>
  );
}

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("restores the persisted site theme", () => {
  localStorage.setItem(themePreferenceKey, "WHITE");
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

function simulateSystemAppearance(initiallyDark: boolean) {
  let dark = initiallyDark;
  const subscribers = new Set<() => void>();
  const systemQuery = "(prefers-color-scheme: dark)";
  const original = window.matchMedia;
  const media = {
    get matches() { return dark; },
    media: systemQuery,
    addEventListener: (_event: string, handler: () => void) => subscribers.add(handler),
    removeEventListener: (_event: string, handler: () => void) => subscribers.delete(handler),
  };
  vi.stubGlobal("matchMedia", (query: string) => query === systemQuery ? media : original(query));
  return (nextDark: boolean) => {
    dark = nextDark;
    act(() => { subscribers.forEach(subscriber => subscriber()); });
  };
}

it("follows system changes even when an older installation saved a startup theme", () => {
  localStorage.setItem("humite-site-theme", "PAPER");
  const setDark = simulateSystemAppearance(true);
  render(<TestProviders><ThemeControls /></TestProviders>);

  expect(screen.getByLabelText("自动跟随")).toHaveTextContent("true");
  expect(document.documentElement).toHaveAttribute("data-humite-theme", "night");
  expect(document.documentElement.style.colorScheme).toBe("dark");
  expect(localStorage.getItem(themePreferenceKey)).toBeNull();

  setDark(false);
  expect(screen.getByLabelText("当前主题")).toHaveTextContent("PAPER");

  fireEvent.click(screen.getByRole("button", { name: "夜间" }));
  setDark(true);
  setDark(false);
  expect(screen.getByLabelText("自动跟随")).toHaveTextContent("false");
  expect(screen.getByLabelText("当前主题")).toHaveTextContent("NIGHT");
  expect(localStorage.getItem(themePreferenceKey)).toBe("NIGHT");

  fireEvent.click(screen.getByRole("button", { name: "跟随系统" }));
  expect(screen.getByLabelText("自动跟随")).toHaveTextContent("true");
  expect(document.documentElement).toHaveAttribute("data-humite-theme", "paper");
  expect(localStorage.getItem(themePreferenceKey)).toBeNull();

  setDark(true);
  expect(document.documentElement).toHaveAttribute("data-humite-theme", "night");
});

it("synchronizes changes to the appearance preference from another tab", () => {
  simulateSystemAppearance(true);
  render(<TestProviders><ThemeControls /></TestProviders>);
  localStorage.setItem(themePreferenceKey, "WHITE");
  act(() => window.dispatchEvent(new StorageEvent("storage", { key: themePreferenceKey, newValue: "WHITE" })));
  expect(screen.getByLabelText("自动跟随")).toHaveTextContent("false");
  expect(document.documentElement).toHaveAttribute("data-humite-theme", "white");

  localStorage.removeItem(themePreferenceKey);
  act(() => window.dispatchEvent(new StorageEvent("storage", { key: themePreferenceKey })));
  expect(screen.getByLabelText("自动跟随")).toHaveTextContent("true");
  expect(document.documentElement).toHaveAttribute("data-humite-theme", "night");
});

it("applies a new theme even when saving preferences exceeds the storage quota", () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("Quota exceeded", "QuotaExceededError"); });
  render(<TestProviders><ThemeControls /></TestProviders>);
  fireEvent.click(screen.getByRole("button", { name: "夜间" }));
  expect(screen.getByLabelText("当前主题")).toHaveTextContent("NIGHT");
  expect(document.documentElement).toHaveAttribute("data-humite-theme", "night");
});

it("configures Tabs component tokens for legible underline tabs across light and dark themes", () => {
  for (const mode of ["PAPER", "NIGHT"] as const) {
    const colors = humiteThemeOptions[mode].colors;
    const tabs = createAntdTheme(mode).components.Tabs;
    expect(tabs.inkBarColor).toBe(colors.primary);
    expect(tabs.itemSelectedColor).toBe(colors.textPrimary);
    expect(tabs.itemActiveColor).toBe(colors.textPrimary);
    expect(tabs.horizontalItemGutter).toBe(tokens.spacing[6]);
  }
});
