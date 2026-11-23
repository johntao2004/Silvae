// 统一整站与阅读器主题状态，把持久选择传播至 Ant Design 和共享 UI。
// Shares theme state across site and reader, propagating persisted choices to Ant Design and shared UI.
import zhCN from "antd/locale/zh_CN";
import "dayjs/locale/zh-cn";
import { FeedbackProvider } from "../ui/notifications";
import { ConfirmationProvider } from "../ui/confirmations";
import { ConfigProvider } from "../ui/antd";
import { CssBaseline, UiThemeProvider } from "../ui/primitives";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore, type PropsWithChildren } from "react";
import type { ReaderTheme } from "../components/readers/reader-fonts";
import { humiteThemeOptions, createAntdTheme, createHumiteTheme } from "./theme";
import { readLocalPreference, removeLocalPreference, saveLocalPreference } from "../utils/local-preferences";

export const themePreferenceKey = "humite-theme-preference";
const darkScheme = "(prefers-color-scheme: dark)";
const hiddenLoadingIndicator = <span aria-hidden="true" />;

interface HumiteThemeContextValue {
  mode: ReaderTheme;
  isAuto: boolean;
  setMode: (mode: ReaderTheme) => void;
  followSystem: () => void;
}

const HumiteThemeContext = createContext<HumiteThemeContextValue>({
  mode: "PAPER",
  isAuto: true,
  setMode: () => undefined,
  followSystem: () => undefined,
});

function isReaderTheme(value: string | undefined): value is ReaderTheme {
  return value === "PAPER" || value === "WHITE" || value === "NIGHT";
}

function readSystemPrefersDark() {
  return window.matchMedia?.(darkScheme).matches ?? false;
}

function subscribeToSystemTheme(onChange: () => void) {
  const media = window.matchMedia?.(darkScheme);
  if (media?.addEventListener) {
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }
  media?.addListener?.(onChange);
  return () => media?.removeListener?.(onChange);
}

function readManualTheme(): ReaderTheme | null {
  // The old key also saved automatic startup colors, so it cannot indicate an explicit choice.
  const stored = readLocalPreference(themePreferenceKey);
  return isReaderTheme(stored) ? stored : null;
}

function applyColorVariables(mode: ReaderTheme) {
  const colors = humiteThemeOptions[mode].colors;
  const root = document.documentElement;
  Object.entries(colors).forEach(([key, value]) => {
    const cssKey = key.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
    root.style.setProperty(`--color-${cssKey}`, value);
  });
  root.dataset.humiteTheme = mode.toLowerCase();
  root.style.colorScheme = mode === "NIGHT" ? "dark" : "light";
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach(meta => {
    meta.content = colors.canvas;
  });
}

export function HumiteThemeProvider({ children }: PropsWithChildren) {
  const [manualTheme, setManualTheme] = useState(readManualTheme);
  const systemPrefersDark = useSyncExternalStore(subscribeToSystemTheme, readSystemPrefersDark);
  const isAuto = manualTheme === null;
  const mode = manualTheme ?? (systemPrefersDark ? "NIGHT" : "PAPER");

  const setMode = useCallback((nextMode: ReaderTheme) => {
    setManualTheme(nextMode);
    saveLocalPreference(themePreferenceKey, nextMode);
  }, []);

  const followSystem = useCallback(() => {
    setManualTheme(null);
    removeLocalPreference(themePreferenceKey);
  }, []);

  useLayoutEffect(() => {
    applyColorVariables(mode);
  }, [mode]);

  useEffect(() => {
    const syncPreference = (event: StorageEvent) => {
      if (event.key === themePreferenceKey || event.key === null) setManualTheme(readManualTheme());
    };
    window.addEventListener("storage", syncPreference);
    return () => window.removeEventListener("storage", syncPreference);
  }, []);

  const uiTheme = useMemo(() => createHumiteTheme(mode), [mode]);
  const antdTheme = useMemo(() => createAntdTheme(mode), [mode]);
  const value = useMemo<HumiteThemeContextValue>(() => ({ mode, isAuto, setMode, followSystem }), [mode, isAuto, setMode, followSystem]);

  return (
    <HumiteThemeContext.Provider value={value}>
      <ConfigProvider locale={zhCN} theme={antdTheme} wave={{ disabled: true }} spin={{ indicator: hiddenLoadingIndicator }}>
        <UiThemeProvider theme={uiTheme}>
          <CssBaseline />
          <FeedbackProvider><ConfirmationProvider>{children}</ConfirmationProvider></FeedbackProvider>
        </UiThemeProvider>
      </ConfigProvider>
    </HumiteThemeContext.Provider>
  );
}

export function useHumiteTheme() {
  return useContext(HumiteThemeContext);
}
