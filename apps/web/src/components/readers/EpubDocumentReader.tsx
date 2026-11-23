import { NavigateBeforeRounded } from "@/ui/icons";
import { NavigateNextRounded } from "@/ui/icons";
import { Alert } from "@/ui/feedback";
import { Box } from "@/ui/primitives";
import { CircularProgress } from "@/ui/feedback";
import { IconButton } from "@/ui/buttons";
import { Stack } from "@/ui/primitives";
import { Typography } from "@/ui/primitives";
import { highlightReaderCode } from "../../features/content/code-highlighting";
import markdownProseCss from "../../features/content/markdown-prose.css?inline";
import { useHumiteTheme } from "../../theme/HumiteThemeProvider";
import { humiteThemeOptions } from "../../theme/theme";
import ePub, { type Book, type Contents, type NavItem, type Rendition } from "epubjs";
import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api/client";
import { persistenceUserId, registerSessionSaver } from "../../auth/session-save";
import type { Annotation } from "../../domain/types";
import { tokens } from "../../theme/tokens";
import { readerWidthSx } from "../PageHeader";
import { applyEpubInlineAnnotation, clearEpubInlineAnnotations, createEpubTextIndex, EPUB_INLINE_ANNOTATION_CLASS, type EpubTextIndex, findEpubArticleParagraphRange, findEpubTextRange, isEpubArticleParagraphLocator } from "./epub-annotations";
import { bindAnnotationNoteActivation } from "./annotation-activation";
import { classifyReaderTapZone, hasReaderTextSelection, isEditableReaderTarget, isReaderHorizontalSwipe, isReaderInteractiveTapTarget } from "./reader-navigation";
import { PageTurnShade } from "./PageTurnShade";
import { readerSelectionFromRect, type ReaderSelection, type TocItem } from "./types";
import { useReaderPageLayout } from "./use-reader-page-layout";
import { usePageTurnTransition } from "./use-page-turn-transition";

interface Props {
  bookId: string;
  annotations: Annotation[];
  onAnnotationDismiss?: () => void;
  onAnnotationActivate?: (id: string, rect?: DOMRect) => void;
  onToggleChrome?: () => void;
  theme: { background: string; foreground: string; muted: string };
  fontSize: number;
  fontFamily: string;
  pageTurnEnabled?: boolean;
  fontSourceUrl?: string;
  contentUrl?: string;
  contentLabel?: string;
  flow?: "paginated" | "scrolled-doc";
  readOnly?: boolean;
  target?: string;
  targetRevision?: number;
  onNavigation: (items: TocItem[]) => void;
  onSelect: (selection: ReaderSelection) => void;
  onPosition: (locator: string, progress: number, endLocator?: string) => void;
}

function renderedContents(rendition: Rendition) {
  // epub.js 0.3 的类型声明是单个 Contents，实际管理器返回数组。
  // epub.js 0.3 declares a single Contents value, while every manager returns an array at runtime.
  return rendition.getContents() as unknown as Contents[];
}

const UNSAFE_CSS_FONT_CHARS = new Set(['"', "'", "\\", "{", "}", ";", "(", ")", "<", ">"]);

function isControlChar(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0;
  return code <= 0x1f || code === 0x7f;
}

function stripUnsafeCssFontChars(value: string): string {
  return [...value].filter((ch) => !isControlChar(ch) && !UNSAFE_CSS_FONT_CHARS.has(ch)).join("").trim();
}

function sanitizeCssFontFamilyToken(rawToken: string): string | null {
  const trimmed = rawToken.trim();
  if (!trimmed) return null;
  const wasQuoted = (trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"));
  const unquoted = wasQuoted ? trimmed.slice(1, -1) : trimmed;
  const cleaned = stripUnsafeCssFontChars(unquoted);
  if (!cleaned) return null;
  return wasQuoted || /\s/u.test(cleaned) ? `"${cleaned}"` : cleaned;
}

function sanitizeCssFontFamilyList(rawFontFamily: string): string {
  const sanitized = rawFontFamily
    .split(",")
    .map(sanitizeCssFontFamilyToken)
    .filter((token): token is string => Boolean(token));
  return sanitized.join(", ") || "sans-serif";
}

function sanitizeCssPrimaryFontFamilyName(rawFontFamily: string): string | null {
  const firstToken = rawFontFamily.split(",")[0]?.trim() ?? "";
  const unquoted = firstToken.replace(/^["']|["']$/gu, "");
  const cleaned = stripUnsafeCssFontChars(unquoted);
  return cleaned || null;
}

function sanitizeCssFontUrl(rawUrl?: string): string | null {
  if (!rawUrl) return null;
  const trimmed = rawUrl.trim();
  if (!trimmed || [...trimmed].some((ch) => isControlChar(ch) || /\s/u.test(ch) || UNSAFE_CSS_FONT_CHARS.has(ch))) {
    return null;
  }
  if (trimmed.startsWith("//")) return null;
  try {
    const base = typeof window !== "undefined" ? window.location.origin : "http://localhost";
    const parsed = new URL(trimmed, base);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:" && parsed.protocol !== "blob:") {
      return null;
    }
  } catch {
    return null;
  }
  return trimmed;
}

export default function EpubDocumentReader({ bookId, annotations, onAnnotationActivate, onAnnotationDismiss, onToggleChrome, theme, fontSize, fontFamily, pageTurnEnabled = true, fontSourceUrl, contentUrl, contentLabel = "EPUB", flow = "paginated", readOnly = false, target, targetRevision, onNavigation, onSelect, onPosition }: Props) {
  const scrolled = flow === "scrolled-doc";
  const { mode: siteTheme } = useHumiteTheme();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const annotationBindingsRef = useRef({ annotations, onAnnotationActivate, onAnnotationDismiss });
  const annotationActivationCleanupsRef = useRef(new Map<Document, () => void>());
  useEffect(() => { annotationBindingsRef.current = { annotations, onAnnotationActivate, onAnnotationDismiss }; }, [annotations, onAnnotationActivate, onAnnotationDismiss]);
  const activeReadOnlyRef = useRef(readOnly);
  const pendingPositionRef = useRef<{ bookId: string; locator: string; progress: number; persistenceUser: string | null } | null>(null);
  const saveTimer = useRef<number | undefined>(undefined);
  useLayoutEffect(() => { activeReadOnlyRef.current = readOnly; }, [readOnly]);
  const flushPosition = useCallback(() => {
    if (saveTimer.current !== undefined) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = undefined;
    }
    const pending = pendingPositionRef.current;
    if (!pending) return Promise.resolve();
    pendingPositionRef.current = null;
    if (activeReadOnlyRef.current || pending.persistenceUser !== persistenceUserId()) return Promise.resolve();
    return api.saveReadingPosition(pending.bookId, pending.locator, pending.progress).catch(() => undefined);
  }, []);
  useEffect(() => registerSessionSaver(flushPosition), [flushPosition]);
  useEffect(() => {
    const handlePageHide = () => {
      void flushPosition();
    };
    window.addEventListener("pagehide", handlePageHide);
    return () => {
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, [flushPosition]);
  const [loading, setLoading] = useState(true);
  const [renditionReady, setRenditionReady] = useState(false);
  const [renderedViewRevision, setRenderedViewRevision] = useState(0);
  const [readingProgress, setReadingProgress] = useState(0);
  const [error, setError] = useState("");
  const initialTargetRef = useRef(target);
  const currentLocatorRef = useRef<string | undefined>(target);
  const gestureCleanupsRef = useRef(new Map<Document, () => void>());
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const touchHadSelectionRef = useRef(false);
  const lastTouchEndAtRef = useRef(0);
  const mouseStartRef = useRef<{ x: number; y: number } | null>(null);
  const mouseHadSelectionRef = useRef(false);
  const pageSurfaceRef = useRef<HTMLDivElement | null>(null);
  const pageLayout = useReaderPageLayout(pageSurfaceRef);
  const wideSpread = !scrolled && (pageLayout?.spread ?? false);
  const annotationRevision = useMemo(
    () => annotations.map((annotation) => `${annotation.id}:${annotation.updatedAt ?? annotation.createdAt}:${annotation.style}:${annotation.color ?? ""}`).join(","),
    [annotations],
  );
  const pageSnapshotKey = `${bookId}:${renderedViewRevision}:${loading}:${wideSpread}:${theme.background}:${theme.foreground}:${fontSize}:${fontFamily}:${annotationRevision}`;
  const { turnPage, turning } = usePageTurnTransition(
    pageSurfaceRef,
    pageTurnEnabled && !scrolled,
    { spread: wideSpread, snapshotKey: pageSnapshotKey },
  );
  const goPrevious = useCallback(() => {
    if (scrolled || !renditionRef.current) return;
    void turnPage("PREVIOUS", async () => { await renditionRef.current?.prev(); });
  }, [scrolled, turnPage]);
  const goNext = useCallback(() => {
    if (scrolled || !renditionRef.current) return;
    void turnPage("NEXT", async () => { await renditionRef.current?.next(); });
  }, [scrolled, turnPage]);
  const gestureBindingsRef = useRef({ onToggleChrome, goPrevious, goNext });
  useEffect(() => {
    gestureBindingsRef.current = { onToggleChrome, goPrevious, goNext };
  }, [onToggleChrome, goPrevious, goNext]);

  const installReaderFont = useEffectEvent((contents: Contents) => {
    const document = contents.document;
    if (!annotationActivationCleanupsRef.current.has(document)) {
      annotationActivationCleanupsRef.current.set(document, bindAnnotationNoteActivation(document,
        id => annotationBindingsRef.current.onAnnotationActivate ? annotationBindingsRef.current.annotations.find(item => item.id === id) : undefined,
        (id, rect) => annotationBindingsRef.current.onAnnotationActivate?.(id, rect),
        () => annotationBindingsRef.current.onAnnotationDismiss?.()));
    }
    const existing = document.querySelector("style[data-page-reader-font]");
    existing?.remove();
    const style = document.createElement("style");
    style.dataset.pageReaderFont = "true";
    const safeFamilyName = sanitizeCssPrimaryFontFamilyName(fontFamily);
    const safeFontSourceUrl = sanitizeCssFontUrl(fontSourceUrl);
    style.textContent = [
      '@import url("/fonts/humite-serif.css");',
      '@font-face { font-family: "Source Han Sans SC"; src: url("/fonts/source-han-sans-sc-regular.woff2") format("woff2"); font-display: swap; }',
      '@font-face { font-family: "Alibaba PuHuiTi"; src: url("/fonts/alibaba-puhuiti-regular.woff2") format("woff2"); font-display: swap; }',
      safeFontSourceUrl && safeFamilyName ? `@font-face { font-family: "${safeFamilyName}"; src: url("${safeFontSourceUrl}"); font-display: swap; }` : "",
    ].filter(Boolean).join("\n");
    document.head.append(style);
    const proseStyle = document.querySelector("style[data-article-prose]");
    proseStyle?.remove();
    if (scrolled) {
      document.body.classList.add("bk-content-prose", "bk-markdown-prose");
      const parentStyle = window.getComputedStyle(hostRef.current ?? window.document.documentElement);
      // Read the current palette directly: the provider's DOM-variable effect can run after this reader's effect.
      const colors = Object.fromEntries(Object.entries(humiteThemeOptions[siteTheme].colors).map(([name, value]) => [
        `--color-${name.replace(/[A-Z]/gu, letter => `-${letter.toLowerCase()}`)}`, value,
      ]));
      const variables = [...new Set([
        ...Object.keys(colors),
        ...Array.from(markdownProseCss.matchAll(/var\((--[a-z0-9-]+)/gu), match => match[1]),
      ])];
      const prose = document.createElement("style");
      prose.dataset.articleProse = "true";
      prose.textContent = `:root {${variables.map(name => `${name}: ${colors[name] ?? parentStyle.getPropertyValue(name)};`).join("\n")}}\n${markdownProseCss}`;
      document.head.append(prose);
      highlightReaderCode(document, `.${EPUB_INLINE_ANNOTATION_CLASS}`);
    }

    const existingGestureCleanup = gestureCleanupsRef.current.get(document);
    existingGestureCleanup?.();
    const resolveTapZone = (clientX: number) => {
      const frameRect = (() => {
        try {
          return document.defaultView?.frameElement?.getBoundingClientRect();
        } catch {
          return undefined;
        }
      })() ?? hostRef.current?.querySelector("iframe")?.getBoundingClientRect();
      const surfaceRect = (pageSurfaceRef.current ?? hostRef.current)?.getBoundingClientRect();
      if (surfaceRect && surfaceRect.width > 0) {
        const screenX = frameRect && frameRect.width > 0 ? frameRect.left + clientX : clientX;
        return classifyReaderTapZone(screenX, surfaceRect.left, surfaceRect.width);
      }
      return classifyReaderTapZone(clientX, 0, 0);
    };
    const triggerTapZone = (clientX: number) => {
      const { onToggleChrome: toggleChrome, goPrevious: prevPage, goNext: nextPage } = gestureBindingsRef.current;
      if (!toggleChrome) return;
      const zone = resolveTapZone(clientX);
      if (zone === "PREVIOUS") {
        if (!scrolled) prevPage();
      } else if (zone === "NEXT") {
        if (!scrolled) nextPage();
      } else {
        toggleChrome();
      }
    };
    const onTouchStart = (event: TouchEvent) => {
      if (event.touches && event.touches.length > 1) {
        touchStartRef.current = null;
        touchHadSelectionRef.current = false;
        return;
      }
      const touch = event.changedTouches[0];
      touchStartRef.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
      touchHadSelectionRef.current = hasReaderTextSelection(document);
    };
    const onTouchEnd = (event: TouchEvent) => {
      const start = touchStartRef.current;
      touchStartRef.current = null;
      const hadSelection = touchHadSelectionRef.current || hasReaderTextSelection(document);
      touchHadSelectionRef.current = false;
      const touch = event.changedTouches[0];
      if (!start || !touch) return;
      lastTouchEndAtRef.current = Date.now();
      const endX = touch.clientX;
      const endY = touch.clientY;
      if (!scrolled && isReaderHorizontalSwipe({ startX: start.x, startY: start.y, endX, endY, hasSelection: hadSelection })) {
        if (endX < start.x) gestureBindingsRef.current.goNext();
        else gestureBindingsRef.current.goPrevious();
        return;
      }
      if (gestureBindingsRef.current.onToggleChrome && Math.hypot(endX - start.x, endY - start.y) < 10 && !hadSelection && !isReaderInteractiveTapTarget(event.target)) {
        triggerTapZone(endX);
      }
    };
    const onMouseDown = (event: MouseEvent) => {
      if (event.button !== 0) return;
      mouseStartRef.current = { x: event.clientX, y: event.clientY };
      mouseHadSelectionRef.current = hasReaderTextSelection(document);
    };
    const onClick = (event: MouseEvent) => {
      const start = mouseStartRef.current;
      mouseStartRef.current = null;
      const hadSelection = mouseHadSelectionRef.current || hasReaderTextSelection(document);
      mouseHadSelectionRef.current = false;
      if (!gestureBindingsRef.current.onToggleChrome) return;
      if (Date.now() - lastTouchEndAtRef.current < 700) return;
      if (event.defaultPrevented || event.button !== 0) return;
      if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) >= 10) return;
      if (hadSelection || isReaderInteractiveTapTarget(event.target)) return;
      triggerTapZone(event.clientX);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableReaderTarget(event.target)) return;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        gestureBindingsRef.current.goPrevious();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        gestureBindingsRef.current.goNext();
      }
    };
    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchend", onTouchEnd, { passive: true });
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("click", onClick);
    if (!scrolled) document.addEventListener("keydown", onKeyDown);
    gestureCleanupsRef.current.set(document, () => {
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchend", onTouchEnd);
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("click", onClick);
      if (!scrolled) document.removeEventListener("keydown", onKeyDown);
    });
  });

  const applyRenditionStyles = (rendition: Rendition) => {
    const safeFontFamily = sanitizeCssFontFamilyList(fontFamily);
    rendition.themes.register("page", {
      body: {
        color: `${theme.foreground} !important`,
        background: `${theme.background} !important`,
        "font-family": `${safeFontFamily} !important`,
        "line-height": "1.9 !important",
        padding: scrolled ? `${tokens.spacing[5]}px 0 !important` : `0 ${tokens.spacing[5]}px !important`,
        "box-sizing": "border-box !important",
        ...(scrolled ? { width: "100% !important" } : {}),
      },
      ...(scrolled ? {
        main: {
          width: "100% !important",
          "max-width": `${tokens.layout.readingMax}px !important`,
          margin: "0 auto !important",
        },
        img: { "max-width": "100% !important", height: "auto !important", "max-height": "none !important" },
      } : {}),
      "p, h1, h2, h3, blockquote": {
        "max-width": `${tokens.layout.readingMax}px !important`,
        "margin-left": "auto !important",
        "margin-right": "auto !important",
      },
      a: {
        color: `${theme.background === tokens.color.semantic.surfaceDark ? tokens.color.primitive.coral600 : tokens.color.primitive.coral700} !important`,
        "text-decoration": "underline !important",
      },
      "::selection": {
        background: `${tokens.color.primitive.coral100} !important`,
        color: `${tokens.color.primitive.ink900} !important`,
        "text-shadow": "none !important",
      },
    });
    rendition.themes.select("page");
    rendition.themes.fontSize(`${Math.round((fontSize / 19) * 100)}%`);
    renderedContents(rendition).forEach((contents) => installReaderFont(contents));
  };

  useEffect(() => {
    if (!hostRef.current) return;
    setRenditionReady(false);
    let disposed = false;
    const controller = new AbortController();
    let book: Book | undefined;
    let rendition: Rendition | undefined;

    void (async () => {
      const response = await fetch(contentUrl ?? `/api/v1/books/${bookId}/content`, { credentials: "include", signal: controller.signal });
      if (!response.ok) throw new Error(`无法读取${contentLabel}文件`);
      const data = await response.arrayBuffer();
      if (disposed || !hostRef.current) return;

      // Articles scroll vertically in the same isolated, script-free rendition; books retain pagination.
      book = ePub(data);
      rendition = book.renderTo(hostRef.current, {
        width: "100%",
        height: "100%",
        flow,
        spread: "none",
        minSpreadWidth: 1,
        allowScriptedContent: false,
      });
      renditionRef.current = rendition;
      rendition.hooks.content.register((contents: Contents) => installReaderFont(contents));
      applyRenditionStyles(rendition);

      const cleanupDetachedDocuments = (targetDoc?: Document) => {
        if (targetDoc) {
          gestureCleanupsRef.current.get(targetDoc)?.();
          gestureCleanupsRef.current.delete(targetDoc);
          annotationActivationCleanupsRef.current.get(targetDoc)?.();
          annotationActivationCleanupsRef.current.delete(targetDoc);
        }
        if (!rendition) return;
        const activeDocs = new Set(renderedContents(rendition).map((contents) => contents.document));
        gestureCleanupsRef.current.forEach((cleanup, doc) => {
          if (!activeDocs.has(doc)) {
            cleanup();
            gestureCleanupsRef.current.delete(doc);
          }
        });
        annotationActivationCleanupsRef.current.forEach((cleanup, doc) => {
          if (!activeDocs.has(doc)) {
            cleanup();
            annotationActivationCleanupsRef.current.delete(doc);
          }
        });
      };

      rendition.on("removed", (_section?: unknown, view?: { contents?: Contents; document?: Document }) => {
        cleanupDetachedDocuments(view?.contents?.document ?? view?.document);
      });

      rendition.on("selected", (cfiRange: string, contents: Contents) => {
        const nativeSelection = contents.window.getSelection();
        const quote = nativeSelection?.toString().trim() ?? "";
        if (!quote || quote.length > 600 || !nativeSelection?.rangeCount) return;
        const nativeRange = nativeSelection.getRangeAt(0);
        let selectedLocator = cfiRange;
        try {
          selectedLocator = contents.cfiFromRange(nativeRange, EPUB_INLINE_ANNOTATION_CLASS) || cfiRange;
        } catch {
          // Retain epub.js's selection event locator if a rendition cannot recalculate its range.
        }
        const rect = nativeRange.getBoundingClientRect();
        const frameRect = contents.window.frameElement?.getBoundingClientRect()
          ?? hostRef.current?.querySelector("iframe")?.getBoundingClientRect();
        onSelect(readerSelectionFromRect({ quote, locator: selectedLocator, rect, frameRect }));
      });
      rendition.on("rendered", () => setRenderedViewRevision((revision) => revision + 1));
      rendition.on("relocated", (location: { start: { cfi: string; percentage?: number }; end?: { cfi: string } }) => {
        if (disposed) return;
        currentLocatorRef.current = location.start.cfi;
        let measuredProgress = location.start.percentage ?? 0;
        try {
          if (book && book.locations.length() > 0) measuredProgress = book.locations.percentageFromCfi(location.start.cfi);
        } catch {
          // 无法测量异常 CFI 时保留 rendition 提供的百分比。
          // Keep the rendition-provided percentage when a malformed CFI cannot be measured.
        }
        const progress = Math.max(0, Math.min(1, measuredProgress));
        setReadingProgress(progress);
        if (location.end?.cfi) onPosition(location.start.cfi, progress, location.end.cfi);
        else onPosition(location.start.cfi, progress);
        // 位置写入防抖 350 毫秒；readOnly 只报告界面位置，不保存服务端进度。
        // Debounce position writes by 350 ms; readOnly reports UI position without persisting server progress.
        if (!readOnly) {
          if (saveTimer.current !== undefined) window.clearTimeout(saveTimer.current);
          const pending = { bookId, locator: location.start.cfi, progress, persistenceUser: persistenceUserId() };
          pendingPositionRef.current = pending;
          const timer = window.setTimeout(() => {
            if (saveTimer.current === timer) saveTimer.current = undefined;
            if (pendingPositionRef.current === pending) void flushPosition();
          }, 350);
          saveTimer.current = timer;
        }
      });

      void book.loaded.navigation.then(async (navigation) => {
        const flatten = (items: NavItem[], depth = 0): TocItem[] => items.flatMap((item) => [
          { href: item.href, label: item.label.trim(), depth },
          ...flatten(item.subitems ?? [], depth + 1),
        ]);
        const items = flatten(navigation.toc);
        if (!disposed) onNavigation(items);
        // Resolve headings against the original DOM so marks remain compatible with saved CFIs.
        const documents = new Map<string, Promise<Document>>();
        const resolved = await Promise.all(items.map(async item => {
          try {
            const section = book!.spine.get(item.href);
            if (!section) return item;
            let loadingDocument = documents.get(section.href);
            if (!loadingDocument) {
              loadingDocument = Promise.resolve(section.load(book!.load.bind(book))).then(() => section.document);
              documents.set(section.href, loadingDocument);
            }
            const document = await loadingDocument;
            const fragment = item.href.split("#")[1];
            const element = fragment ? document.getElementById(decodeURIComponent(fragment)) : document.body ?? document.documentElement;
            return element ? { ...item, locator: section.cfiFromElement(element) } : item;
          } catch { return item; }
        }));
        if (!disposed) onNavigation(resolved);
      }).catch(() => { /* A broken source TOC must not prevent reading or using saved bookmarks. */ });

      await book.ready;
      if (disposed) return;
      await book.locations.generate(128);
      if (disposed) return;
      // 深链接优先于已存位置；无效 CFI 依次回退到已存定位或百分比。
      // Deep links take precedence over saved positions; invalid CFIs fall back to saved locators or percentages.
      const initialTarget = initialTargetRef.current;
      const position = readOnly ? null : await api.getReadingPosition(bookId);
      if (disposed) return;
      if (initialTarget) {
        try {
          await rendition.display(initialTarget);
        } catch {
          if (position) {
            try {
              await rendition.display(position.locator);
            } catch {
              await rendition.display(book.locations.cfiFromPercentage(position.progress));
            }
          } else {
            await rendition.display();
          }
        }
      } else if (position) {
        try {
          await rendition.display(position.locator);
        } catch {
          await rendition.display(book.locations.cfiFromPercentage(position.progress));
        }
      } else {
        await rendition.display();
      }
      if (!disposed) {
        setRenditionReady(true);
        setLoading(false);
      }
    })().catch((reason) => {
      if (!disposed) setError(reason instanceof Error ? reason.message : `无法打开${contentLabel}`);
    });

    return () => {
      disposed = true;
      controller.abort();
      void flushPosition();
      gestureCleanupsRef.current.forEach((cleanup) => cleanup());
      gestureCleanupsRef.current.clear();
      annotationActivationCleanupsRef.current.forEach(cleanup => cleanup());
      annotationActivationCleanupsRef.current.clear();
      renditionRef.current = null;
      rendition?.destroy();
      book?.destroy();
    };
  }, [bookId, contentUrl, onNavigation, onPosition, onSelect, readOnly, contentLabel, flow, flushPosition]);

  useEffect(() => {
    if (scrolled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableReaderTarget(event.target)) return;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        goPrevious();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        goNext();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [goNext, goPrevious, scrolled]);

  useEffect(() => {
    const rendition = renditionRef.current;
    if (!rendition) return;
    const locator = currentLocatorRef.current;
    applyRenditionStyles(rendition);
    rendition.resize(hostRef.current?.clientWidth ?? 0, hostRef.current?.clientHeight ?? 0);
    if (locator) void rendition.display(locator).catch(() => undefined);
  }, [fontFamily, fontSize, fontSourceUrl, siteTheme, theme.background, theme.foreground]);

  useEffect(() => {
    const rendition = renditionRef.current;
    const host = hostRef.current;
    if (!rendition || !host || !renditionReady) return;
    const locator = currentLocatorRef.current;
    rendition.spread(!scrolled && wideSpread ? "always" : "none", 1);
    rendition.resize(host.clientWidth, host.clientHeight);
    if (locator) void rendition.display(locator).catch(() => undefined);
  }, [renditionReady, scrolled, wideSpread]);

  useEffect(() => {
    const host = hostRef.current;
    const rendition = renditionRef.current;
    if (!host || !rendition || typeof ResizeObserver === "undefined") return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const locator = currentLocatorRef.current;
        rendition.resize(host.clientWidth, host.clientHeight);
        if (locator) void rendition.display(locator).catch(() => undefined);
      });
    });
    observer.observe(host);
    return () => { observer.disconnect(); window.cancelAnimationFrame(frame); };
  }, [renditionReady]);

  useEffect(() => {
    if (!renditionReady || !renditionRef.current) return;
    renderedContents(renditionRef.current).forEach((contents) => installReaderFont(contents));
  }, [fontSourceUrl, fontFamily, renditionReady]);

  useEffect(() => {
    const rendition = renditionRef.current;
    if (!rendition || !renditionReady) return;

    const contentsList = renderedContents(rendition);
    contentsList.forEach((contents) => clearEpubInlineAnnotations(contents.document));
    const documentIndexes = new Map<Document, EpubTextIndex>();
    const textIndexFor = (doc: Document) => {
      let cached = documentIndexes.get(doc);
      if (!cached) {
        cached = createEpubTextIndex(doc);
        documentIndexes.set(doc, cached);
      }
      return cached;
    };
    annotations.forEach((annotation) => {
      if (!annotation.locator || annotation.type === "BOOKMARK") return;
      if (isEpubArticleParagraphLocator(annotation.locator)) {
        for (const contents of contentsList) {
          const range = findEpubArticleParagraphRange(
            contents.document,
            annotation.locator,
            annotation.quote ?? "",
          );
          if (range) {
            applyEpubInlineAnnotation(range, annotation, theme);
            documentIndexes.delete(contents.document);
            break;
          }
        }
        return;
      }
      try {
        const cfiRange = rendition.getRange(annotation.locator, EPUB_INLINE_ANNOTATION_CLASS);
        if (!cfiRange) return;
        const rangeDocument = cfiRange.startContainer.ownerDocument;
        const range = cfiRange.collapsed && annotation.quote && rangeDocument
          ? findEpubTextRange(rangeDocument, annotation.quote, rangeDocument.body, textIndexFor(rangeDocument))
          : cfiRange;
        if (range) {
          applyEpubInlineAnnotation(range, annotation, theme);
          if (rangeDocument) documentIndexes.delete(rangeDocument);
        }
      } catch {
        // 忽略过期或外部变更的 CFI 范围，让书籍仍可阅读。
        // Ignore stale or externally changed CFI ranges while keeping the book readable.
      }
    });

    if (scrolled) contentsList.forEach(contents => highlightReaderCode(contents.document, `.${EPUB_INLINE_ANNOTATION_CLASS}`));

    return () => {
      renderedContents(rendition).forEach((contents) => clearEpubInlineAnnotations(contents.document));
    };
  }, [annotations, renderedViewRevision, renditionReady, scrolled, theme.background, theme.foreground]);

  useEffect(() => {
    if (target && renditionReady) void renditionRef.current?.display(target).catch(() => undefined);
  }, [target, targetRevision, renditionReady]);

  if (error) return <Stack sx={{ height: "100%", alignItems: "center", justifyContent: "center", p: 3 }}><Alert severity="error">{error}</Alert></Stack>;

  return (
    <Box className="reader-viewport" data-reader-flow={flow} sx={{ position: "relative", height: "100%", minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden", bgcolor: theme.background }}>
      {loading && <Stack spacing={1.5} sx={{ position: "absolute", inset: 0, zIndex: 2, alignItems: "center", justifyContent: "center", bgcolor: theme.background }}><CircularProgress size={30} /><Typography sx={{ color: theme.muted }}>正在排版{contentLabel}…</Typography></Stack>}
      <Box ref={pageSurfaceRef} className="reader-page-turn-surface" data-reader-spread={wideSpread} sx={{ position: "relative", ...readerWidthSx, flex: "1 1 auto", minHeight: 0, overflow: "hidden", bgcolor: theme.background, backfaceVisibility: "hidden", transformStyle: "preserve-3d", willChange: turning ? "transform, opacity, filter, clip-path" : "auto" }}>
        <Box ref={hostRef} onScrollCapture={() => annotationBindingsRef.current.onAnnotationDismiss?.()} sx={{ width: "100%", height: "100%", overflow: "hidden", "& iframe": { border: 0, ...(scrolled ? { maxWidth: "100%" } : {}) }, ...(scrolled ? { "& .epub-container": { overflowX: "hidden", scrollbarGutter: "stable" }, "& .epub-view": { maxWidth: "100%" } } : {}) }} />
        {!scrolled && <PageTurnShade />}
      </Box>
      {!scrolled && <Stack component="nav" aria-label={`${contentLabel} 翻页`} direction="row" spacing={1} sx={{ ...readerWidthSx, flex: `0 0 ${tokens.layout.readerControlHeight}px`, minHeight: tokens.layout.readerControlHeight, alignItems: "center", justifyContent: "center", overflowX: "auto", borderTop: 1, borderColor: "divider", bgcolor: theme.background, color: theme.foreground }}>
        <IconButton color="inherit" aria-label={`${contentLabel} 上一页`} disabled={loading || turning} onClick={goPrevious} sx={{ width: tokens.layout.touchTarget, height: tokens.layout.touchTarget }}><NavigateBeforeRounded /></IconButton>
        <Typography variant="caption" sx={{ minWidth: 0, flex: "1 1 auto", textAlign: "center", whiteSpace: "nowrap", color: theme.muted }}>已读 {Math.round(readingProgress * 100)}% · 左右滑动翻页</Typography>
        <IconButton color="inherit" aria-label={`${contentLabel} 下一页`} disabled={loading || turning} onClick={goNext} sx={{ width: tokens.layout.touchTarget, height: tokens.layout.touchTarget }}><NavigateNextRounded /></IconButton>
      </Stack>}
    </Box>
  );
}
