import { NavigateBeforeRounded } from "@/ui/icons";
import { NavigateNextRounded } from "@/ui/icons";
import { Alert } from "@/ui/feedback";
import { Box } from "@/ui/primitives";
import { CircularProgress } from "@/ui/feedback";
import { IconButton } from "@/ui/buttons";
import { Stack } from "@/ui/primitives";
import { Typography } from "@/ui/primitives";
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy, type PDFDataRangeTransport } from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "pdfjs-dist/web/pdf_viewer.css";
import { Fragment, useCallback, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode, type RefObject, type TouchEvent } from "react";
import { api } from "../../api/client";
import { persistenceUserId, registerSessionSaver } from "../../auth/session-save";
import type { Annotation } from "../../domain/types";
import { tokens } from "../../theme/tokens";
import { readerWidthSx } from "../PageHeader";
import { bindAnnotationNoteActivation } from "./annotation-activation";
import { applyPdfTextAnnotations } from "./pdf-annotations";
import { pdfNavigation, pdfPrintedTocNavigation } from "./pdf-navigation";
import { PdfImageSpread } from "./PdfImageSpread";
import { pdfPageBoundarySeparator, pdfTextToReadingBlocks, shouldJoinPdfPageBoundaryParagraphs, splitPdfInlineFootnoteReferences, type PdfReadingBlock } from "./pdf-reading-text";
import type { ReaderPageLayout } from "./reader-layout";
import { classifyReaderTapZone, hasReaderTextSelection, isEditableReaderTarget, isReaderHorizontalSwipe, isReaderInteractiveTapTarget } from "./reader-navigation";
import { PageTurnShade } from "./PageTurnShade";
import { readerSelectionFromRect, type ReaderSelection, type TocItem } from "./types";
import { useReaderPageLayout } from "./use-reader-page-layout";
import { usePageTurnTransition } from "./use-page-turn-transition";

GlobalWorkerOptions.workerSrc = pdfWorker;

export interface PdfSourceBlock {
  block?: PdfReadingBlock;
  pageNumber: number;
  imagePage?: boolean;
  chapterIndex?: number;
  footnoteTargetKey?: string;
  referenceTargetKey?: string;
}

interface IndexedPdfSourceBlock {
  source: PdfSourceBlock;
  index: number;
  sourceStart: boolean;
}

function pdfFootnoteTargetId(targetKey: string) {
  return `pdf-footnote-${targetKey}`;
}

interface PdfChapterSourceBlocks {
  chapterIndex: number;
  content: PdfSourceBlock[];
  footnotes: PdfSourceBlock[];
  references: PdfSourceBlock[];
  notesHeading?: PdfSourceBlock;
  bibliographyHeading?: PdfSourceBlock;
  appendixOrder: Array<"notes" | "bibliography">;
  inNotesSection: boolean;
  inBibliographySection: boolean;
  lastContentPage?: number;
}

export function pdfFootnoteTargetKey(chapterIndex: number, marker: string) {
  return `${chapterIndex}-${footnoteMarkerKey(marker)}`;
}

export function pdfReferenceTargetKey(chapterIndex: number, marker: string) {
  return `${chapterIndex}-reference-${footnoteMarkerKey(marker)}`;
}

function recordPdfAppendixSection(chapter: PdfChapterSourceBlocks, section: "notes" | "bibliography") {
  if (!chapter.appendixOrder.includes(section)) chapter.appendixOrder.push(section);
}

export function movePdfFootnotesToChapterEnd(blocks: PdfSourceBlock[]) {
  const chapters: PdfChapterSourceBlocks[] = [];
  let chapterIndex = 0;
  let current = createPdfChapterSourceBlocks(chapterIndex);
  const finishChapter = () => {
    chapters.push(current);
    chapterIndex += 1;
    current = createPdfChapterSourceBlocks(chapterIndex);
  };

  blocks.forEach((source) => {
    const block = source.block;
    if (block?.kind === "heading" && block.chapterStart && (current.content.length || current.footnotes.length || current.references.length || current.notesHeading || current.bibliographyHeading)) finishChapter();
    if (block?.kind === "heading" && block.notesSection) {
      current.inBibliographySection = false;
      current.notesHeading = source;
      current.inNotesSection = true;
      recordPdfAppendixSection(current, "notes");
      return;
    }
    if (block?.kind === "heading" && block.bibliographySection) {
      current.inBibliographySection = true;
      current.inNotesSection = false;
      current.bibliographyHeading = source;
      recordPdfAppendixSection(current, "bibliography");
      return;
    }
    if (block?.kind === "heading") {
      current.inBibliographySection = false;
      current.inNotesSection = false;
    }
    if (current.inBibliographySection && block && block.kind !== "heading") {
      const referenceBlock = block.kind === "footnote"
        ? { kind: "reference" as const, marker: block.marker, text: block.text }
        : block;
      current.references.push({ ...source, block: referenceBlock, chapterIndex });
      return;
    }
    const isFootnote = block?.kind === "footnote";
    const isNotesParagraph = current.inNotesSection && block?.kind === "paragraph";
    if (isFootnote || isNotesParagraph) {
      const noteBlock = isFootnote ? block : { kind: "footnote" as const, marker: "", text: block.text };
      current.footnotes.push({ ...source, block: noteBlock, chapterIndex });
      recordPdfAppendixSection(current, "notes");
      return;
    }
    current.content.push({ ...source, chapterIndex });
    if (source.pageNumber > 0) current.lastContentPage = source.pageNumber;
  });
  if (current.content.length || current.footnotes.length || current.references.length || current.notesHeading || current.bibliographyHeading || chapters.length === 0) finishChapter();

  return chapters.flatMap((chapter) => {
    const output = [...chapter.content];
    const appendixPageNumber = chapter.lastContentPage
      ?? chapter.content[0]?.pageNumber
      ?? chapter.footnotes[0]?.pageNumber
      ?? chapter.references[0]?.pageNumber
      ?? 1;
    const referenceMarkers = new Set(chapter.content.flatMap(({ block }) => block && "text" in block
      ? splitPdfInlineFootnoteReferences(block.text).flatMap((part) => part.kind === "footnote-reference" ? [part.marker] : [])
      : []));
    const claimedTargets = new Set<string>();
    const footnotes = chapter.footnotes.map((source) => {
      const marker = source.block?.kind === "footnote" ? source.block.marker : "";
      const targetKey = marker && referenceMarkers.has(marker) ? pdfFootnoteTargetKey(chapter.chapterIndex, marker) : undefined;
      const uniqueTargetKey = targetKey && !claimedTargets.has(targetKey) ? targetKey : undefined;
      if (uniqueTargetKey) claimedTargets.add(uniqueTargetKey);
      return {
        ...source,
        pageNumber: appendixPageNumber,
        chapterIndex: chapter.chapterIndex,
        footnoteTargetKey: uniqueTargetKey,
      };
    });
    const referenceMarkersInBibliography = new Set(chapter.references.flatMap(({ block }) => block?.kind === "reference" ? [block.marker] : []));
    const claimedReferenceTargets = new Set<string>();
    const references = chapter.references.map((source) => {
      const marker = source.block?.kind === "reference" ? source.block.marker : "";
      const footnoteTarget = marker ? pdfFootnoteTargetKey(chapter.chapterIndex, marker) : "";
      const targetKey = marker && referenceMarkers.has(marker) && !claimedTargets.has(footnoteTarget) && referenceMarkersInBibliography.has(marker)
        ? pdfReferenceTargetKey(chapter.chapterIndex, marker)
        : undefined;
      const uniqueTargetKey = targetKey && !claimedReferenceTargets.has(targetKey) ? targetKey : undefined;
      if (uniqueTargetKey) claimedReferenceTargets.add(uniqueTargetKey);
      return {
        ...source,
        pageNumber: appendixPageNumber,
        chapterIndex: chapter.chapterIndex,
        referenceTargetKey: uniqueTargetKey,
      };
    });
    chapter.appendixOrder.forEach((section) => {
      if (section === "notes") {
        if (!chapter.notesHeading && footnotes.length === 0) return;
        const headingSource = chapter.notesHeading;
        output.push({
          pageNumber: appendixPageNumber,
          chapterIndex: chapter.chapterIndex,
          block: { kind: "heading", text: headingSource?.block?.kind === "heading" ? headingSource.block.text : "注释", notesSection: true },
        }, ...footnotes);
        return;
      }
      if (!chapter.bibliographyHeading && references.length === 0) return;
      const headingSource = chapter.bibliographyHeading;
      output.push({
        pageNumber: appendixPageNumber,
        chapterIndex: chapter.chapterIndex,
        block: { kind: "heading", text: headingSource?.block?.kind === "heading" ? headingSource.block.text : "参考文献", bibliographySection: true },
      }, ...references);
    });
    return output;
  });
}

function createPdfChapterSourceBlocks(chapterIndex: number): PdfChapterSourceBlocks {
  return { chapterIndex, content: [], footnotes: [], references: [], appendixOrder: [], inNotesSection: false, inBibliographySection: false };
}

export function groupPdfSourceBlocks(blocks: PdfSourceBlock[]) {
  const indexed = blocks.map((source, index) => ({
    source,
    index,
    sourceStart: index === 0 || blocks[index - 1]?.pageNumber !== source.pageNumber,
  }));
  const groups: IndexedPdfSourceBlock[][] = [];
  for (let index = 0; index < indexed.length; index += 1) {
    const current = indexed[index];
    if (!current) continue;
    const group = [current];
    let cursor = index;
    while (indexed[cursor] && indexed[cursor + 1]) {
      const previous = indexed[cursor]!;
      const next = indexed[cursor + 1]!;
      if (previous.source.pageNumber + 1 !== next.source.pageNumber
        || !previous.source.block || !next.source.block
        || !shouldJoinPdfPageBoundaryParagraphs(previous.source.block, next.source.block)) break;
      group.push(next);
      cursor += 1;
    }
    groups.push(group);
    index = cursor;
  }
  return groups;
}

export function pdfSourcePositionAt(
  sourcePageStarts: ReadonlyMap<number, number>,
  virtualPageIndex: number,
  fallbackPageNumber: number,
  // 翻页时同屏多个源页起点并存，应锚定到最先开始的源页，而不是沿用当前页，否则翻回第一屏会显示第 2 页。
  // When turning, anchor to the first source page starting on a shared screen instead of keeping the current one; otherwise paging back to the first screen reports page 2.
  options: { preferFirstOnSharedScreen?: boolean } = {},
) {
  const fallbackStart = sourcePageStarts.get(fallbackPageNumber);
  if (fallbackStart === virtualPageIndex && !options.preferFirstOnSharedScreen) {
    return { pageNumber: fallbackPageNumber, offset: 0 };
  }
  let currentScreenPage: number | undefined;
  let previousScreenPage: number | undefined;
  let previousScreenStart = -Infinity;
  for (const [page, start] of sourcePageStarts.entries()) {
    if (start === virtualPageIndex) {
      if (currentScreenPage === undefined || page < currentScreenPage) currentScreenPage = page;
    } else if (start < virtualPageIndex && (
      start > previousScreenStart
      || (start === previousScreenStart && (previousScreenPage === undefined || page > previousScreenPage))
    )) {
      previousScreenStart = start;
      previousScreenPage = page;
    }
  }
  const source: readonly [number, number] | undefined = currentScreenPage !== undefined
    ? [currentScreenPage, virtualPageIndex]
    : previousScreenPage !== undefined
      ? [previousScreenPage, previousScreenStart]
      : undefined;
  return source
    ? { pageNumber: source[0], offset: Math.max(0, virtualPageIndex - source[1]) }
    : { pageNumber: fallbackPageNumber, offset: Math.max(0, virtualPageIndex - (fallbackStart ?? 0)) };
}

export function pdfSourceVirtualPageIndex(localX: number, pagePadding: number, columnWidth: number, columnGap: number, visibleColumns: number) {
  const sourceColumn = Math.floor(Math.max(0, localX - pagePadding) / (columnWidth + columnGap));
  return Math.floor(sourceColumn / Math.max(1, visibleColumns));
}

function pdfSourcePageVirtualCount(sourcePageStarts: ReadonlyMap<number, number>, sourcePage: number, totalCount: number) {
  const start = sourcePageStarts.get(sourcePage) ?? 0;
  return Math.max(1, (sourcePageStarts.get(sourcePage + 1) ?? totalCount) - start);
}

function publishPrintedPdfNavigation(document: PDFDocumentProxy, pages: ReadonlyMap<number, readonly PdfReadingBlock[]>, onNavigation: (items: TocItem[]) => void, signatureRef: { current: string }) {
  const items = pdfPrintedTocNavigation(pages, document.numPages);
  if (items.length === 0) return;
  const signature = items.map(item => `${item.locator}:${item.label}`).join("|");
  if (signature === signatureRef.current) return;
  signatureRef.current = signature;
  onNavigation(items);
}

export function pdfTurnPositionAt(
  cursor: { pageNumber: number; virtualPageIndex: number; virtualPageCount: number },
  direction: "PREVIOUS" | "NEXT",
  sourcePageStarts: ReadonlyMap<number, number>,
) {
  const nextIndex = cursor.virtualPageIndex + (direction === "NEXT" ? 1 : -1);
  if (nextIndex < 0 || nextIndex >= cursor.virtualPageCount) return null;
  return { pageNumber: pdfSourcePositionAt(sourcePageStarts, nextIndex, cursor.pageNumber, { preferFirstOnSharedScreen: true }).pageNumber, virtualPageIndex: nextIndex };
}

export function remapPdfSourceTarget(
  target: { pageNumber: number; offset: number; virtualPageIndex: number },
  sourcePageStarts: ReadonlyMap<number, number>,
  totalCount: number,
) {
  const start = sourcePageStarts.get(target.pageNumber);
  return start === undefined
    ? null
    : { ...target, virtualPageIndex: Math.min(Math.max(0, totalCount - 1), start + target.offset) };
}

const UNSAFE_CSS_FONT_CHARS = new Set(['"', "'", "\\", "{", "}", ";", "(", ")", "<", ">"]);

function isControlChar(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0;
  return code <= 0x1f || code === 0x7f;
}

function sanitizeCssFontFamilyName(rawFontFamily: string): string | null {
  const firstToken = rawFontFamily.split(",")[0]?.trim() ?? "";
  const unquoted = firstToken.replace(/^["']|["']$/gu, "");
  const cleaned = [...unquoted].filter((ch) => !isControlChar(ch) && !UNSAFE_CSS_FONT_CHARS.has(ch)).join("").trim();
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

export default function PdfDocumentReader({ bookId, annotations, theme, fontSize, fontFamily, pageTurnEnabled = true, fontSourceUrl, contentUrl, dataRange, readOnly = false, target, targetRevision, onNavigation, onAnnotationActivate, onToggleChrome, onSelect, onPosition }: {
  bookId: string;
  annotations: Annotation[];
  theme: { background: string; foreground: string; muted: string };
  fontSize: number;
  fontFamily: string;
  pageTurnEnabled?: boolean;
  fontSourceUrl?: string;
  contentUrl?: string;
  dataRange?: PDFDataRangeTransport;
  readOnly?: boolean;
  target?: string;
  targetRevision?: number;
  onNavigation?: (items: TocItem[]) => void;
  onAnnotationActivate?: (id: string, rect?: DOMRect) => void;
  onToggleChrome?: () => void;
  onSelect: (selection: ReaderSelection) => void;
  onPosition: (locator: string, progress: number) => void;
}) {
  const annotationActivationRootRef = useRef<HTMLDivElement | null>(null);
  const annotationsRef = useRef(annotations);
  const annotationCallbackRef = useRef(onAnnotationActivate);
  const annotatedSourcePagesRef = useRef(new Set<number>());
  useLayoutEffect(() => {
    annotationsRef.current = annotations;
    annotationCallbackRef.current = onAnnotationActivate;
  }, [annotations, onAnnotationActivate]);
  const activeReadOnlyRef = useRef(readOnly);
  useLayoutEffect(() => {
    activeReadOnlyRef.current = readOnly;
  }, [readOnly]);
  const pendingPositionRef = useRef<{ bookId: string; locator: string; progress: number; persistenceUser: string | null } | null>(null);
  const lastPersistedPositionRef = useRef<{ bookId: string; locator: string; progress: number } | null>(null);
  const saveTimerRef = useRef<number | undefined>(undefined);
  const flushPosition = useCallback(() => {
    if (saveTimerRef.current !== undefined) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = undefined;
    }
    const pending = pendingPositionRef.current;
    if (!pending) return Promise.resolve();
    pendingPositionRef.current = null;
    if (activeReadOnlyRef.current || pending.persistenceUser !== persistenceUserId()) return Promise.resolve();
    lastPersistedPositionRef.current = { bookId: pending.bookId, locator: pending.locator, progress: pending.progress };
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
      void flushPosition();
    };
  }, [bookId, flushPosition]);
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  // PDF 原始页与重排后的虚拟页分开管理；locator 的 offset 指向原始页内分页。
  // Track original PDF pages separately from reflowed virtual pages; locator offset identifies pagination within an original page.
  const [virtualPageIndex, setVirtualPageIndex] = useState(0);
  const [virtualPageCount, setVirtualPageCount] = useState(1);
  const [sourcePageStartRevision, setSourcePageStartRevision] = useState(0);
  const [readingBlocks, setReadingBlocks] = useState<PdfSourceBlock[]>([]);
  const [textLoading, setTextLoading] = useState(true);
  const [textError, setTextError] = useState("");
  const [error, setError] = useState("");
  const readingTextRef = useRef<HTMLDivElement | null>(null);
  const textCacheRef = useRef(new Map<number, PdfReadingBlock[]>());
  const footnoteOriginRef = useRef(new Map<string, string>());
  const outlineNavigationRef = useRef<TocItem[] | null>(null);
  const printedNavigationSignatureRef = useRef("");
  const initialTargetPageRef = useRef(1);
  const parsedThroughRef = useRef(0);
  const hasDisplayedTextRef = useRef(false);
  const [displayedPosition, setDisplayedPosition] = useState({
    pageNumber: 1,
    virtualPageIndex: 0,
    virtualPageCount: 1,
  });
  const initialTargetRef = useRef(target);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const touchHadSelectionRef = useRef(false);
  const lastTouchEndAtRef = useRef(0);
  const mouseStartRef = useRef<{ x: number; y: number } | null>(null);
  const mouseHadSelectionRef = useRef(false);
  const readingSurfaceRef = useRef<HTMLDivElement | null>(null);
  const pageLayout = useReaderPageLayout(readingSurfaceRef);
  const wideSpread = pageLayout?.spread ?? false;
  const hasTextBlocks = useMemo(() => readingBlocks.some((item) => !item.imagePage), [readingBlocks]);
  const latestCursorRef = useRef({
    pageNumber,
    virtualPageIndex,
    virtualPageCount,
  });
  useLayoutEffect(() => {
    latestCursorRef.current = {
      pageNumber,
      virtualPageIndex,
      virtualPageCount,
    };
  }, [pageNumber, virtualPageIndex, virtualPageCount]);
  const sourcePageStartsRef = useRef(new Map<number, number>());
  const pendingSourceTargetRef = useRef<{ pageNumber: number; offset: number } | null>(null);
  const restoredSourceTargetRef = useRef<{ pageNumber: number; offset: number; virtualPageIndex: number } | null>(null);
  const annotationRevision = useMemo(
    () => annotations.map((annotation) => `${annotation.id}:${annotation.updatedAt ?? annotation.createdAt}:${annotation.style}:${annotation.color ?? ""}`).join(","),
    [annotations],
  );
  const pageSnapshotKey = `${bookId}:${pageNumber}:${virtualPageIndex}:${virtualPageCount}:${textLoading}:${wideSpread}:${theme.background}:${theme.foreground}:${fontSize}:${fontFamily}:${annotationRevision}`;
  const { turnPage, turning } = usePageTurnTransition(
    readingSurfaceRef,
    pageTurnEnabled,
    { spread: wideSpread, snapshotKey: pageSnapshotKey, snapshot: !hasTextBlocks },
  );

  useEffect(() => {
    const root = annotationActivationRootRef.current;
    if (!root) return;
    return bindAnnotationNoteActivation(
      root,
      (id) => {
        if (!annotationCallbackRef.current) return undefined;
        const annotation = annotationsRef.current.find((candidate) => candidate.id === id);
        return annotation ? { id: annotation.id, note: annotation.note } : undefined;
      },
      (id, rect) => annotationCallbackRef.current?.(id, rect),
    );
  }, [error]);

  useEffect(() => {
    if (turning) return;
    const sourcePosition = pdfSourcePositionAt(sourcePageStartsRef.current, virtualPageIndex, pageNumber);
    const restoredTarget = restoredSourceTargetRef.current;
    const displayPosition = restoredTarget?.virtualPageIndex === virtualPageIndex
      ? { pageNumber: restoredTarget.pageNumber, offset: restoredTarget.offset }
      : sourcePosition;
    setDisplayedPosition({ pageNumber: displayPosition.pageNumber, virtualPageIndex: displayPosition.offset, virtualPageCount });
  }, [pageNumber, sourcePageStartRevision, turning, virtualPageCount, virtualPageIndex]);

  useEffect(() => {
    let disposed = false;
    textCacheRef.current.clear();
    outlineNavigationRef.current = null;
    printedNavigationSignatureRef.current = "";
    footnoteOriginRef.current.clear();
    sourcePageStartsRef.current.clear();
    pendingSourceTargetRef.current = null;
    restoredSourceTargetRef.current = null;
    initialTargetPageRef.current = 1;
    parsedThroughRef.current = 0;
    hasDisplayedTextRef.current = false;
    setSourcePageStartRevision((revision) => revision + 1);
    annotatedSourcePagesRef.current.clear();
    setDocument(null);
    setPageNumber(1);
    setVirtualPageIndex(0);
    setVirtualPageCount(1);
    setReadingBlocks([]);
    setTextLoading(true);
    setError("");
    setTextError("");
    // 每本书独立拥有 PDF 加载任务；切换或卸载时销毁任务并忽略迟到响应。
    // Each book owns its PDF loading task; switching or unmounting destroys it and ignores late responses.
    const task = getDocument(dataRange ? { range: dataRange, disableAutoFetch: true, disableStream: true, rangeChunkSize: 1024 * 1024 } : { url: contentUrl ?? `/api/v1/books/${bookId}/content`, withCredentials: true, rangeChunkSize: 1024 * 1024 });
    void Promise.all([task.promise, readOnly ? Promise.resolve(null) : api.getReadingPosition(bookId)]).then(([loaded, position]) => {
      if (disposed) return;
      setDocument(loaded);
      const locator = initialTargetRef.current ?? position?.locator;
      const match = locator?.match(/^pdf:page=(\d+)(?:&offset=(\d+))?/);
      if (match) {
        const sourcePage = Math.min(loaded.numPages, Math.max(1, Number(match[1])));
        setPageNumber(sourcePage);
        initialTargetPageRef.current = sourcePage;
        pendingSourceTargetRef.current = { pageNumber: sourcePage, offset: Math.max(0, Number(match[2] ?? 0)) };
      }
    }).catch((reason) => { if (!disposed) setError(reason instanceof Error ? reason.message : "无法打开 PDF"); });
    return () => {
      disposed = true;
      textCacheRef.current.clear();
      void task.destroy();
    };
  }, [bookId, contentUrl, dataRange, readOnly]);

  const navigateToTarget = useEffectEvent((loaded: PDFDocumentProxy, locator: string) => {
    const match = /^pdf:page=(\d+)(?:&offset=(\d+))?/u.exec(locator);
    if (!match) return;
    const nextPage = Math.min(loaded.numPages, Math.max(1, Number(match[1])));
    const offset = Math.max(0, Number(match[2] ?? 0));
    pendingSourceTargetRef.current = null;
    restoredSourceTargetRef.current = null;
    // Unmount the old text layout before it can clamp the destination's virtual offset.
    setPageNumber(nextPage);
    const sourceStart = sourcePageStartsRef.current.get(nextPage);
    if (sourceStart === undefined && parsedThroughRef.current < nextPage) pendingSourceTargetRef.current = { pageNumber: nextPage, offset };
    else if (sourceStart === undefined) {
      pendingSourceTargetRef.current = null;
      setVirtualPageIndex(0);
    }
    else {
      const targetIndex = sourceStart + offset;
      restoredSourceTargetRef.current = { pageNumber: nextPage, offset, virtualPageIndex: targetIndex };
      setVirtualPageIndex(targetIndex);
    }
  });
  useEffect(() => {
    if (document && target) navigateToTarget(document, target);
  }, [document, target, targetRevision]);

  useEffect(() => {
    if (!document || !onNavigation) return;
    let disposed = false;
    outlineNavigationRef.current = null;
    void (async () => {
      const items = await pdfNavigation(document);
      if (disposed) return;
      outlineNavigationRef.current = items;
      onNavigation(items);
    })().catch(() => {
      if (disposed) return;
      outlineNavigationRef.current = [];
      onNavigation([]);
      publishPrintedPdfNavigation(document, textCacheRef.current, onNavigation, printedNavigationSignatureRef);
    });
    return () => { disposed = true; };
  }, [document, onNavigation]);

  useEffect(() => {
    if (!document || !onNavigation) return;
    const outline = outlineNavigationRef.current;
    if (outline === null || outline.length > 0) return;
    publishPrintedPdfNavigation(document, textCacheRef.current, onNavigation, printedNavigationSignatureRef);
  }, [document, onNavigation, readingBlocks]);

  useEffect(() => {
    if (!document) return;
    let disposed = false;
    const allBlocks: PdfSourceBlock[] = [];
    const initialBatchSize = 12;
    const backgroundBatchSize = 36;
    void (async () => {
      for (let firstPage = 1; firstPage <= document.numPages;) {
        const step = hasDisplayedTextRef.current ? backgroundBatchSize : initialBatchSize;
        const lastPage = Math.min(document.numPages, firstPage + step - 1);
        for (let sourcePage = firstPage; sourcePage <= lastPage; sourcePage += 1) {
          let blocks = textCacheRef.current.get(sourcePage);
          if (!blocks) {
            const page = await document.getPage(sourcePage);
            if (disposed) {
              page.cleanup?.();
              return;
            }
            try {
              const content = await page.getTextContent();
              if (disposed) return;
              blocks = pdfTextToReadingBlocks(content.items);
              textCacheRef.current.set(sourcePage, blocks);
            } finally {
              page.cleanup?.();
            }
          }
          allBlocks.push(...(blocks.length
            ? blocks.map((block) => ({ block, pageNumber: sourcePage }))
            : [{ pageNumber: sourcePage, imagePage: true }]));
        }
        if (disposed) return;
        parsedThroughRef.current = lastPage;
        if (lastPage >= initialTargetPageRef.current || lastPage === document.numPages) {
          hasDisplayedTextRef.current = true;
          setReadingBlocks(movePdfFootnotesToChapterEnd(allBlocks));
          setTextLoading(false);
        }
        firstPage = lastPage + 1;
      }
      if (!disposed) setTextLoading(false);
    })().catch((reason) => {
      if (disposed) return;
      const message = reason instanceof Error ? reason.message : "PDF 文字解析失败";
      if (!hasDisplayedTextRef.current) setError(message);
      else setTextError(message);
    });
    return () => { disposed = true; };
  }, [document]);

  useEffect(() => {
    if (textLoading) return;
    if (readingTextRef.current) {
      const sourcePages = new Set(readingBlocks.map(({ pageNumber: sourcePage }) => sourcePage));
      const activeAnnotationPages = new Set(annotations
        .filter((annotation) => annotation.type !== "BOOKMARK")
        .map((annotation) => Number(annotation.locator?.match(/^pdf:page=(\d+)/u)?.[1]))
        .filter((sourcePage) => Number.isFinite(sourcePage)));
      const pagesToRefresh = new Set([...activeAnnotationPages, ...annotatedSourcePagesRef.current]);
      pagesToRefresh.forEach((sourcePage) => {
        if (sourcePages.has(sourcePage)) applyPdfTextAnnotations(readingTextRef.current!, sourcePage, annotations, { theme });
      });
      annotatedSourcePagesRef.current = activeAnnotationPages;
    }
  }, [annotations, document, readingBlocks, textLoading, theme.background, theme.foreground]);

  useEffect(() => {
    if (!document) return;
    if (turning) return;
    const unresolvedTarget = pendingSourceTargetRef.current;
    if (unresolvedTarget) {
      const locator = `pdf:page=${unresolvedTarget.pageNumber}&offset=${unresolvedTarget.offset}`;
      const sourceCount = pdfSourcePageVirtualCount(sourcePageStartsRef.current, unresolvedTarget.pageNumber, virtualPageCount);
      const progress = Math.max(0, Math.min(1, (unresolvedTarget.pageNumber - 1 + (unresolvedTarget.offset + 0.5) / sourceCount) / document.numPages));
      onPosition(locator, progress);
      return;
    }
    const sourcePosition = pdfSourcePositionAt(sourcePageStartsRef.current, virtualPageIndex, pageNumber);
    const restoredTarget = restoredSourceTargetRef.current;
    const position = restoredTarget?.virtualPageIndex === virtualPageIndex
      ? { pageNumber: restoredTarget.pageNumber, offset: restoredTarget.offset }
      : sourcePosition;
    const locator = `pdf:page=${position.pageNumber}&offset=${position.offset}`;
    const sourceCount = pdfSourcePageVirtualCount(sourcePageStartsRef.current, position.pageNumber, virtualPageCount);
    const progress = Math.max(0, Math.min(1, (position.pageNumber - 1 + (position.offset + 0.5) / sourceCount) / document.numPages));
    onPosition(locator, progress);
    if (!readOnly) {
      const alreadyPersisted = lastPersistedPositionRef.current
        && lastPersistedPositionRef.current.bookId === bookId
        && lastPersistedPositionRef.current.locator === locator
        && Math.abs(lastPersistedPositionRef.current.progress - progress) < 1e-6;
      if (!alreadyPersisted) {
        if (saveTimerRef.current !== undefined) window.clearTimeout(saveTimerRef.current);
        const pending = { bookId, locator, progress, persistenceUser: persistenceUserId() };
        pendingPositionRef.current = pending;
        const timer = window.setTimeout(() => {
          if (saveTimerRef.current === timer) saveTimerRef.current = undefined;
          if (pendingPositionRef.current === pending) void flushPosition();
        }, 350);
        saveTimerRef.current = timer;
      }
    }
  }, [bookId, document, flushPosition, onPosition, pageNumber, readOnly, sourcePageStartRevision, turning, virtualPageCount, virtualPageIndex]);

  const captureSelection = (fallbackPageNumber = pageNumber) => {
    const nativeSelection = window.getSelection();
    const quote = nativeSelection?.toString().trim() ?? "";
    if (!quote || quote.length > 600 || !nativeSelection?.rangeCount) return;
    const rect = nativeSelection.getRangeAt(0).getBoundingClientRect();
    const selectedNode = nativeSelection.getRangeAt(0).startContainer;
    const sourcePageNumber = (selectedNode instanceof HTMLElement ? selectedNode : selectedNode.parentElement)?.closest<HTMLElement>("[data-pdf-source-page]")?.dataset.pdfSourcePage;
    const sourcePage = Number(sourcePageNumber) || fallbackPageNumber;
    const sourceOffset = Math.max(0, virtualPageIndex - (sourcePageStartsRef.current.get(sourcePage) ?? 0));
    onSelect(readerSelectionFromRect({ quote, locator: `pdf:page=${sourcePage}&offset=${sourceOffset}`, rect }));
  };

  const jumpToPdfElement = useCallback((element: HTMLElement, sourcePageNumber: number) => {
    const frame = readingTextRef.current;
    const currentLayout = pageLayout;
    if (!frame || !currentLayout?.columnWidth) {
      element.focus({ preventScroll: true });
      return;
    }
    const frameLeft = frame.getBoundingClientRect().left;
    const localX = element.getBoundingClientRect().left - frameLeft;
    const targetIndex = Math.min(
      Math.max(0, virtualPageCount - 1),
      pdfSourceVirtualPageIndex(localX, currentLayout.pagePadding, currentLayout.columnWidth, currentLayout.columnGap, currentLayout.visibleColumns),
    );
    const sourceStart = sourcePageStartsRef.current.get(sourcePageNumber);
    const offset = sourceStart === undefined ? 0 : Math.max(0, targetIndex - sourceStart);
    restoredSourceTargetRef.current = { pageNumber: sourcePageNumber, offset, virtualPageIndex: targetIndex };
    setPageNumber(sourcePageNumber);
    setVirtualPageIndex(targetIndex);
    window.requestAnimationFrame(() => element.focus({ preventScroll: true }));
  }, [pageLayout, virtualPageCount]);

  const openFootnote = useCallback((targetKey: string, anchor: HTMLElement) => {
    footnoteOriginRef.current.set(targetKey, anchor.id);
    const note = window.document.getElementById(pdfFootnoteTargetId(targetKey));
    if (note) jumpToPdfElement(note, Number(note.dataset.pdfSourcePage) || pageNumber);
  }, [jumpToPdfElement, pageNumber]);

  const returnToFootnoteReference = useCallback((targetKey: string) => {
    const referenceId = footnoteOriginRef.current.get(targetKey);
    const reference = referenceId ? window.document.getElementById(referenceId) : null;
    if (reference) jumpToPdfElement(reference, Number(reference.dataset.pdfSourcePage) || pageNumber);
  }, [jumpToPdfElement, pageNumber]);

  const handleVirtualPageCountChange = useCallback((count: number, sourcePageStarts: Array<[number, number]>) => {
    const { pageNumber: currentPageNumber, virtualPageIndex: currentVirtualPageIndex } = latestCursorRef.current;
    const nextCount = Math.max(1, count);
    const previousStart = sourcePageStartsRef.current.get(currentPageNumber);
    const previousOffset = previousStart === undefined ? null : Math.max(0, currentVirtualPageIndex - previousStart);
    const nextStarts = new Map(sourcePageStarts);
    const currentStarts = sourcePageStartsRef.current;
    const startsChanged = currentStarts.size !== nextStarts.size
      || [...nextStarts].some(([sourcePage, start]) => currentStarts.get(sourcePage) !== start);
    sourcePageStartsRef.current = nextStarts;
    // 仅在分页起点真实变化时刷新依赖项，避免每次重新测量都重复保存阅读进度。
    // Only bump the revision when page starts really change, so re-measuring does not re-save reading progress.
    if (startsChanged) setSourcePageStartRevision((revision) => revision + 1);
    const pendingSourceTarget = pendingSourceTargetRef.current;
    if (pendingSourceTarget) {
      const targetStart = nextStarts.get(pendingSourceTarget.pageNumber);
      if (targetStart !== undefined) {
        pendingSourceTargetRef.current = null;
        setPageNumber(pendingSourceTarget.pageNumber);
        const targetIndex = Math.min(nextCount - 1, targetStart + pendingSourceTarget.offset);
        restoredSourceTargetRef.current = { ...pendingSourceTarget, virtualPageIndex: targetIndex };
        setVirtualPageIndex(targetIndex);
      }
    } else {
      const restoredTarget = restoredSourceTargetRef.current;
      if (restoredTarget) {
        const remappedTarget = remapPdfSourceTarget(restoredTarget, nextStarts, nextCount);
        if (remappedTarget) {
          restoredSourceTargetRef.current = remappedTarget;
          setPageNumber(remappedTarget.pageNumber);
          setVirtualPageIndex(remappedTarget.virtualPageIndex);
        }
      } else {
        const nextStart = nextStarts.get(currentPageNumber);
        if (nextStart !== undefined && previousOffset !== null) setVirtualPageIndex(Math.min(nextCount - 1, nextStart + previousOffset));
      }
    }
    setVirtualPageCount(nextCount);
    setVirtualPageIndex((current) => Math.min(current, nextCount - 1));
  }, []);

  const canPrevious = virtualPageIndex > 0;
  const canNext = Boolean(document) && virtualPageIndex < virtualPageCount - 1;
  const changeToPreviousPage = useCallback(() => {
    const cursor = latestCursorRef.current;
    restoredSourceTargetRef.current = null;
    const position = pdfTurnPositionAt(cursor, "PREVIOUS", sourcePageStartsRef.current);
    if (!position) return;
    setVirtualPageIndex(position.virtualPageIndex);
    setPageNumber(position.pageNumber);
  }, []);
  const changeToNextPage = useCallback(() => {
    const cursor = latestCursorRef.current;
    restoredSourceTargetRef.current = null;
    const position = pdfTurnPositionAt(cursor, "NEXT", sourcePageStartsRef.current);
    if (!position) return;
    setVirtualPageIndex(position.virtualPageIndex);
    setPageNumber(position.pageNumber);
  }, []);
  const goPrevious = useCallback(() => {
    if (canPrevious) void turnPage("PREVIOUS", changeToPreviousPage);
  }, [canPrevious, changeToPreviousPage, turnPage]);
  const goNext = useCallback(() => {
    if (canNext) void turnPage("NEXT", changeToNextPage);
  }, [canNext, changeToNextPage, turnPage]);

  useEffect(() => {
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
  }, [goNext, goPrevious]);

  const resolveTapZone = (clientX: number, fallbackElement: EventTarget | null) => {
    const surface = readingSurfaceRef.current;
    const surfaceRect = surface?.getBoundingClientRect();
    if (surfaceRect && surfaceRect.width > 0) return classifyReaderTapZone(clientX, surfaceRect.left, surfaceRect.width);
    const fallbackRect = fallbackElement instanceof Element ? fallbackElement.getBoundingClientRect() : undefined;
    if (fallbackRect && fallbackRect.width > 0) return classifyReaderTapZone(clientX, fallbackRect.left, fallbackRect.width);
    return classifyReaderTapZone(clientX, 0, 0);
  };
  const isReadingSurfaceTap = (target: EventTarget | null, currentTarget: EventTarget | null) => {
    const surface = readingSurfaceRef.current;
    if (!surface || target === currentTarget) return true;
    const node = target as Node | null;
    return Boolean(node && surface.contains(node));
  };
  const triggerTapZone = (clientX: number, target: EventTarget | null, currentTarget: EventTarget | null) => {
    if (!onToggleChrome) return;
    if (!isReadingSurfaceTap(target, currentTarget) || isReaderInteractiveTapTarget(target)) return;
    const zone = resolveTapZone(clientX, currentTarget);
    if (zone === "PREVIOUS") goPrevious();
    else if (zone === "NEXT") goNext();
    else onToggleChrome();
  };
  const handleTouchStart = (event: TouchEvent) => {
    if (event.touches && event.touches.length > 1) {
      touchStartRef.current = null;
      touchHadSelectionRef.current = false;
      return;
    }
    const touch = event.changedTouches[0];
    touchStartRef.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
    touchHadSelectionRef.current = hasReaderTextSelection();
  };
  const handleTouchEnd = (event: TouchEvent) => {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    const hadSelection = touchHadSelectionRef.current || hasReaderTextSelection();
    touchHadSelectionRef.current = false;
    const touch = event.changedTouches[0];
    if (!start || !touch) return;
    lastTouchEndAtRef.current = Date.now();
    const endX = touch.clientX;
    const endY = touch.clientY;
    if (isReaderHorizontalSwipe({ startX: start.x, startY: start.y, endX, endY, hasSelection: hadSelection })) {
      if (endX < start.x) goNext();
      else goPrevious();
      return;
    }
    if (onToggleChrome && Math.hypot(endX - start.x, endY - start.y) < 10 && !hadSelection) {
      triggerTapZone(endX, event.target, event.currentTarget);
    }
  };
  const handleMouseDown = (event: MouseEvent) => {
    if (!onToggleChrome || event.button !== 0) return;
    mouseStartRef.current = { x: event.clientX, y: event.clientY };
    mouseHadSelectionRef.current = hasReaderTextSelection();
  };
  const handleClick = (event: MouseEvent) => {
    const start = mouseStartRef.current;
    mouseStartRef.current = null;
    const hadSelection = mouseHadSelectionRef.current || hasReaderTextSelection();
    mouseHadSelectionRef.current = false;
    if (!onToggleChrome) return;
    if (Date.now() - lastTouchEndAtRef.current < 700) return;
    if (event.defaultPrevented || event.button !== 0) return;
    if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) >= 10) return;
    if (hadSelection) return;
    triggerTapZone(event.clientX, event.target, event.currentTarget);
  };

  const customFontFaceRule = useMemo(() => {
    const safeUrl = sanitizeCssFontUrl(fontSourceUrl);
    const safeFamily = sanitizeCssFontFamilyName(fontFamily);
    if (!safeUrl || !safeFamily) return null;
    return `@font-face { font-family: "${safeFamily}"; src: url("${safeUrl}"); font-display: swap; }`;
  }, [fontFamily, fontSourceUrl]);

  if (error) return <Stack ref={annotationActivationRootRef} className="reader-viewport" sx={{ height: "100%", alignItems: "center", justifyContent: "center", p: 3 }}><Alert severity="error">{error}</Alert></Stack>;

  return (
    <Stack ref={annotationActivationRootRef} className="reader-viewport" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd} onMouseDown={onToggleChrome ? handleMouseDown : undefined} onClick={onToggleChrome ? handleClick : undefined} sx={{ height: "100%", minHeight: 0, overflow: "hidden", bgcolor: theme.background, color: theme.foreground }}>
      {customFontFaceRule && <style>{customFontFaceRule}</style>}
      {textError && <Alert severity="warning">{textError}</Alert>}
      <Box ref={readingSurfaceRef} className="reader-page-turn-surface" data-reader-spread={wideSpread} sx={{ position: "relative", ...readerWidthSx, flex: "1 1 auto", minHeight: 0, overflow: "hidden", bgcolor: theme.background, backfaceVisibility: "hidden", transformStyle: "preserve-3d", willChange: turning ? "transform, opacity, filter, clip-path" : "auto" }}>
        <PdfReadingClipFrame width={readingBlocks.length === 0 ? undefined : pageLayout?.articleWidth}>
          {textLoading
            ? <Stack spacing={1.5} sx={{ height: "100%", alignItems: "center", justifyContent: "center" }}><CircularProgress size={30} /><Typography sx={{ color: theme.muted }}>正在解析第 {pageNumber} 页文字…</Typography></Stack>
            : <PdfPagedText textRef={readingTextRef} document={document!} blocks={readingBlocks} sourcePageStarts={sourcePageStartsRef.current} pageNumber={pageNumber} theme={theme} fontFamily={fontFamily} fontSize={fontSize} layout={pageLayout} pageIndex={virtualPageIndex} turning={turning} onPageCountChange={handleVirtualPageCountChange} onOpenFootnote={openFootnote} onReturnToReference={returnToFootnoteReference} onCaptureSelection={() => captureSelection(pageNumber)} />}
        </PdfReadingClipFrame>
        <PageTurnShade />
      </Box>
      <Stack component="nav" aria-label="PDF 翻页" className="pdf-reader-pagination" direction="row" spacing={1} sx={{ ...readerWidthSx, flex: `0 0 ${tokens.layout.readerControlHeight}px`, minHeight: tokens.layout.readerControlHeight, alignItems: "center", justifyContent: "center", overflowX: "auto", py: 0.75, bgcolor: theme.background, color: theme.foreground, borderTop: "1px solid", borderColor: "divider" }}>
        <IconButton color="inherit" aria-label="PDF 上一页" disabled={turning || !canPrevious} onClick={goPrevious} sx={{ width: tokens.layout.touchTarget, height: tokens.layout.touchTarget }}><NavigateBeforeRounded /></IconButton>
        <Typography variant="body2" sx={{ minWidth: 0, flex: "1 1 auto", textAlign: "center", whiteSpace: "nowrap", color: theme.muted }}>{document ? `第 ${displayedPosition.pageNumber} 页 · 共 ${document.numPages} 页` : "正在打开 PDF…"}</Typography>
        <IconButton color="inherit" aria-label="PDF 下一页" disabled={turning || !canNext} onClick={goNext} sx={{ width: tokens.layout.touchTarget, height: tokens.layout.touchTarget }}><NavigateNextRounded /></IconButton>
      </Stack>
    </Stack>
  );
}

export function PdfReadingClipFrame({ children, width }: { children: ReactNode; width?: number }) {
  return <Box className="pdf-reading-clip-frame" sx={{ height: "100%", minHeight: 0, width: width ? `${width}px` : "100%", maxWidth: "100%", mx: "auto", overflow: "hidden" }}>{children}</Box>;
}

export function PdfPagedText({ textRef, document, blocks, sourcePageStarts, pageNumber, theme, fontFamily, fontSize, layout, pageIndex, turning, onPageCountChange, onOpenFootnote, onReturnToReference, onCaptureSelection }: {
  textRef: RefObject<HTMLDivElement | null>;
  document: PDFDocumentProxy;
  blocks: PdfSourceBlock[];
  sourcePageStarts: ReadonlyMap<number, number>;
  pageNumber: number;
  theme: { background: string; foreground: string; muted: string };
  fontFamily: string;
  fontSize: number;
  layout: ReaderPageLayout | null;
  pageIndex: number;
  turning: boolean;
  onPageCountChange: (count: number, sourcePageStarts: Array<[number, number]>) => void;
  onOpenFootnote: (targetKey: string, anchor: HTMLElement) => void;
  onReturnToReference: (targetKey: string) => void;
  onCaptureSelection: () => void;
}) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const onPageCountChangeRef = useRef(onPageCountChange);
  useLayoutEffect(() => {
    onPageCountChangeRef.current = onPageCountChange;
  }, [onPageCountChange]);
  const visibleColumns = layout?.visibleColumns ?? 1;
  const columnWidth = layout?.columnWidth ?? null;
  const columnGap = layout?.columnGap ?? tokens.layout.readerPageGap;
  const pagePadding = layout?.pagePadding ?? tokens.spacing[5];
  const displayBlocks = blocks;
  const footnoteTargetKeys = useMemo(() => new Set(
    displayBlocks.flatMap(({ block, footnoteTargetKey }) => block?.kind === "footnote" && footnoteTargetKey ? [footnoteTargetKey] : []),
  ), [displayBlocks]);
  const referenceTargetKeys = useMemo(() => new Set(
    displayBlocks.flatMap(({ block, referenceTargetKey }) => block?.kind === "reference" && referenceTargetKey ? [referenceTargetKey] : []),
  ), [displayBlocks]);
  const renderGroups = useMemo(() => groupPdfSourceBlocks(displayBlocks), [displayBlocks]);

  useEffect(() => {
    if (turning) return;
    const frame = frameRef.current;
    if (!frame || columnWidth === null) return;
    let animationFrame = 0;
    const measure = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(() => {
        const totalColumns = Math.max(1, Math.round((frame.scrollWidth + columnGap) / (columnWidth + columnGap)));
        const frameLeft = frame.getBoundingClientRect().left;
        const sourcePageStarts = new Map<number, number>();
        frame.querySelectorAll<HTMLElement>("[data-pdf-source-marker]").forEach((span) => {
          const sourcePage = Number(span.dataset.pdfSourcePage);
          if (!Number.isFinite(sourcePage) || sourcePageStarts.has(sourcePage)) return;
          let firstLeft: number | undefined;
          if (!span.hasAttribute("data-pdf-image-page")) {
            const textWalker = window.document.createTreeWalker(span, NodeFilter.SHOW_TEXT);
            const firstText = textWalker.nextNode();
            if (firstText?.textContent) {
              const firstCharacter = window.document.createRange();
              firstCharacter.setStart(firstText, 0);
              firstCharacter.setEnd(firstText, Math.min(1, firstText.textContent.length));
              if (typeof firstCharacter.getBoundingClientRect === "function") firstLeft = firstCharacter.getBoundingClientRect().left;
            }
          }
          const localX = (firstLeft ?? span.getBoundingClientRect().left) - frameLeft;
          sourcePageStarts.set(sourcePage, pdfSourceVirtualPageIndex(localX, pagePadding, columnWidth, columnGap, visibleColumns));
        });
        onPageCountChangeRef.current(Math.max(1, Math.ceil(totalColumns / visibleColumns)), [...sourcePageStarts.entries()]);
      });
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    return () => { observer.disconnect(); window.cancelAnimationFrame(animationFrame); };
  }, [displayBlocks, columnGap, columnWidth, fontFamily, fontSize, layout?.articleWidth, pagePadding, turning, visibleColumns]);

  const pageStride = layout?.pageStride ?? 0;

  return (
    <Box
      ref={(node: HTMLDivElement | null) => {
        frameRef.current = node;
        textRef.current = node;
      }}
      component="article"
      aria-label={`PDF 第 ${pageNumber} 页阅读正文`}
      onMouseUp={onCaptureSelection}
      onTouchEnd={onCaptureSelection}
      className="reader-paged-text"
      style={{ transform: columnWidth === null ? `translateX(-${pageIndex * 100}%)` : `translateX(-${pageIndex * pageStride}px)` }}
      sx={{
        height: "100%",
        width: layout ? `${layout.articleWidth}px` : "100%",
        maxWidth: "100%",
        mx: "auto",
        overflow: "visible",
        transition: "none",
        // 由浏览器按文本需要生成完整列宽，避免固定列数在窄屏把横排中文挤成近似竖排。
        // Let the browser create only as many full-width columns as the text
        // needs. A fixed column count made each column just a few pixels wide
        // on narrow reader viewports, which made horizontal Chinese text look
        // like vertical writing.
        columnCount: "auto",
        columnWidth: columnWidth === null ? "auto" : `${columnWidth}px`,
        columnGap: `${columnGap}px`,
        columnFill: "auto",
        direction: "ltr",
        writingMode: "horizontal-tb",
        textOrientation: "mixed",
        unicodeBidi: "normal",
        px: `${pagePadding}px`,
        pt: { xs: `${tokens.spacing[6]}px`, md: `${tokens.spacing[10]}px` },
        pb: `${tokens.spacing[6]}px`,
        color: theme.foreground,
        background: theme.background,
        fontFamily,
        fontSize,
        lineHeight: tokens.typography.lineHeight.body,
        "& > *": { breakInside: "auto" },
        "& h2, & h3, & aside": { breakInside: "avoid" },
      }}
    >
      {renderGroups.map((group) => {
        if (group.length > 1) {
          const first = group[0]!;
          const firstSource = first.source;
          const firstPage = firstSource.pageNumber;
          const last = group[group.length - 1]!;
          return <Typography key={`${firstPage}-${first.index}-${last.source.pageNumber}-${last.index}`} component="p" data-pdf-source-page={firstPage} sx={{ m: 0, mb: `${tokens.spacing[5]}px`, color: "inherit", fontFamily: "inherit", fontSize: "inherit", lineHeight: tokens.typography.lineHeight.body, textAlign: "justify", textIndent: first.index === 0 ? 0 : "2em" }}>
            {group.map((part, partIndex) => {
              const sourcePage = part.source.pageNumber;
              const text = part.source.block!.text;
              return <Fragment key={`${sourcePage}-${part.index}`}>
                <PdfInlineText text={text} pageNumber={sourcePage} blockIndex={part.index} chapterIndex={part.source.chapterIndex ?? 0} sourceStart={part.sourceStart} footnoteTargetKeys={footnoteTargetKeys} referenceTargetKeys={referenceTargetKeys} onOpenFootnote={onOpenFootnote} />
                {partIndex < group.length - 1 && pdfPageBoundarySeparator(text, group[partIndex + 1]!.source.block!.text)}
              </Fragment>;
            })}
          </Typography>;
        }
        const { source, index, sourceStart } = group[0]!;
        const { block, pageNumber: sourcePageNumber, imagePage } = source;
        const imageStart = sourcePageStarts.get(sourcePageNumber);
        const imageIsNearViewport = imageStart === undefined
          ? Math.abs(sourcePageNumber - pageNumber) <= visibleColumns + 1
          : imageStart >= pageIndex - 1 && imageStart <= pageIndex + visibleColumns;
        return <Fragment key={`${sourcePageNumber}-${index}`}>
          {imagePage
            ? <Box data-pdf-source-page={sourcePageNumber} data-pdf-image-page="" data-pdf-source-marker={sourceStart ? "" : undefined} sx={{ height: "100%", minHeight: "100%", breakInside: "avoid" }}>{imageIsNearViewport && <PdfImageSpread document={document} pageNumber={sourcePageNumber} spread={false} muted={theme.muted} />}</Box>
            : <PdfReadingBlockView source={source} block={block!} index={index} pageNumber={sourcePageNumber} sourceStart={sourceStart} footnoteTargetKeys={footnoteTargetKeys} referenceTargetKeys={referenceTargetKeys} onOpenFootnote={onOpenFootnote} onReturnToReference={onReturnToReference} />}
        </Fragment>;
      })}
    </Box>
  );
}

function PdfReadingBlockView({ source, block, index, pageNumber, sourceStart, footnoteTargetKeys, referenceTargetKeys, onOpenFootnote, onReturnToReference }: { source: PdfSourceBlock; block: PdfReadingBlock; index: number; pageNumber: number; sourceStart: boolean; footnoteTargetKeys: ReadonlySet<string>; referenceTargetKeys: ReadonlySet<string>; onOpenFootnote: (targetKey: string, anchor: HTMLElement) => void; onReturnToReference: (targetKey: string) => void }) {
  const chapterIndex = source.chapterIndex ?? 0;
  const inlineText = (text: string) => <PdfInlineText text={text} pageNumber={pageNumber} blockIndex={index} chapterIndex={chapterIndex} sourceStart={sourceStart} footnoteTargetKeys={footnoteTargetKeys} referenceTargetKeys={referenceTargetKeys} onOpenFootnote={onOpenFootnote} />;
  if (block.kind === "footnote") {
    const targetKey = source.footnoteTargetKey;
    return <Box component="aside" role="note" tabIndex={-1} id={targetKey ? pdfFootnoteTargetId(targetKey) : undefined} data-pdf-footnote-key={targetKey} data-pdf-source-page={pageNumber} data-pdf-source-marker={sourceStart ? "" : undefined} sx={{ mt: `${tokens.spacing[6]}px`, pt: `${tokens.spacing[4]}px`, minWidth: 0, maxWidth: "100%", borderTop: 1, borderColor: "divider", scrollMargin: `${tokens.spacing[6]}px`, breakInside: "avoid", overflowWrap: "anywhere" }}>
      <Stack direction="row" sx={{ alignItems: "flex-start", gap: `${tokens.spacing[3]}px`, minWidth: 0, maxWidth: "100%" }}>
        {block.marker && (targetKey
          ? <Box component="button" type="button" aria-label={`返回正文引用 ${block.marker}`} onClick={() => onReturnToReference(targetKey)} sx={{ appearance: "none", background: "none", border: 0, borderRadius: 0, p: 0, m: 0, boxShadow: "none", cursor: "pointer", flexShrink: 0, color: "primary.main", fontFamily: "inherit", fontSize: tokens.typography.fontSize.bodySm, fontWeight: tokens.typography.fontWeight.semibold, lineHeight: tokens.typography.lineHeight.body, "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: "2px" } }}>{block.marker}</Box>
          : <Box component="span" sx={{ flexShrink: 0, color: "text.secondary", fontSize: tokens.typography.fontSize.bodySm, lineHeight: tokens.typography.lineHeight.body }}>{block.marker}</Box>)}
        <Typography component="p" sx={{ m: 0, minWidth: 0, maxWidth: "100%", flex: "1 1 auto", color: "text.secondary", fontFamily: "inherit", fontSize: tokens.typography.fontSize.bodySm, lineHeight: tokens.typography.lineHeight.body, overflowWrap: "anywhere", wordBreak: "break-word" }}>{block.text}</Typography>
      </Stack>
    </Box>;
  }
  if (block.kind === "heading") {
    const appendixHeading = block.notesSection || block.bibliographySection;
    return <Typography component={appendixHeading ? "h3" : "h2"} data-pdf-source-page={pageNumber} data-pdf-chapter-start={block.chapterStart ? "" : undefined} data-pdf-notes-section={block.notesSection ? "" : undefined} data-pdf-bibliography-section={block.bibliographySection ? "" : undefined} sx={{ m: 0, mb: `${tokens.spacing[8]}px`, breakBefore: block.chapterStart || appendixHeading ? "column" : "auto", breakAfter: "avoid-column", color: "inherit", fontFamily: "inherit", fontSize: appendixHeading ? tokens.typography.fontSize.bodySm : "inherit", fontWeight: tokens.typography.fontWeight.semibold, lineHeight: tokens.typography.lineHeight.heading, textAlign: appendixHeading ? "left" : "center", textTransform: "none" }}>{appendixHeading ? block.text : inlineText(block.text)}</Typography>;
  }
  if (block.kind === "toc-entry") {
    return (
      <Box component="p" data-pdf-source-page={pageNumber} sx={{ m: 0, mb: `${tokens.spacing[4]}px`, display: "flex", alignItems: "baseline", color: "inherit", fontFamily: "inherit", fontSize: "inherit", lineHeight: tokens.typography.lineHeight.body, textAlign: "left" }}>
        <Box component="span" data-pdf-source-page={pageNumber} data-pdf-source-marker={sourceStart ? "" : undefined} sx={{ minWidth: 0 }}>{block.text}</Box>
        <Box component="span" aria-hidden sx={{ minWidth: tokens.spacing[6], flex: 1, borderBottom: 1, borderColor: "currentColor", borderStyle: "dotted", opacity: 0.38 }} />
        <Box component="span" sx={{ flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{block.pageLabel}</Box>
      </Box>
    );
  }
  if (block.kind === "reference") {
    const targetKey = source.referenceTargetKey;
    return <Box component="aside" role="doc-biblioentry" tabIndex={targetKey ? -1 : undefined} id={targetKey ? pdfFootnoteTargetId(targetKey) : undefined} data-pdf-reference-key={targetKey} data-pdf-source-page={pageNumber} sx={{ display: "flex", alignItems: "flex-start", gap: `${tokens.spacing[3]}px`, mt: `${tokens.spacing[3]}px`, minWidth: 0, maxWidth: "100%", scrollMargin: `${tokens.spacing[6]}px`, breakInside: "avoid", overflowWrap: "anywhere" }}>
      {block.marker && (targetKey
        ? <Box component="button" type="button" aria-label={`返回正文引用 ${block.marker}`} onClick={() => onReturnToReference(targetKey)} sx={{ appearance: "none", background: "none", border: 0, borderRadius: 0, p: 0, m: 0, boxShadow: "none", cursor: "pointer", flexShrink: 0, color: "primary.main", fontFamily: "inherit", fontSize: tokens.typography.fontSize.bodySm, fontWeight: tokens.typography.fontWeight.semibold, lineHeight: tokens.typography.lineHeight.body, "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: "2px" } }}>{block.marker}</Box>
        : <Box component="span" sx={{ flexShrink: 0, color: "text.secondary", fontSize: tokens.typography.fontSize.bodySm, lineHeight: tokens.typography.lineHeight.body }}>{block.marker}</Box>)}
      <Typography component="p" sx={{ m: 0, minWidth: 0, maxWidth: "100%", flex: "1 1 auto", color: "text.secondary", fontFamily: "inherit", fontSize: tokens.typography.fontSize.bodySm, lineHeight: tokens.typography.lineHeight.body, overflowWrap: "anywhere", wordBreak: "break-word" }}>{block.text}</Typography>
    </Box>;
  }
  return <Typography component="p" data-pdf-source-page={pageNumber} sx={{ m: 0, mb: `${tokens.spacing[5]}px`, color: "inherit", fontFamily: "inherit", fontSize: "inherit", lineHeight: tokens.typography.lineHeight.body, textAlign: "justify", textIndent: index === 0 ? 0 : "2em" }}>{inlineText(block.text)}</Typography>;
}

function PdfInlineText({ text, pageNumber, blockIndex, chapterIndex = 0, sourceStart = false, footnoteTargetKeys, referenceTargetKeys, onOpenFootnote }: { text: string; pageNumber: number; blockIndex: number; chapterIndex?: number; sourceStart?: boolean; footnoteTargetKeys: ReadonlySet<string>; referenceTargetKeys: ReadonlySet<string>; onOpenFootnote: (targetKey: string, anchor: HTMLElement) => void }) {
  return splitPdfInlineFootnoteReferences(text).map((part, partIndex) => {
    if (part.kind === "text") return <Box component="span" data-pdf-text data-pdf-source-page={pageNumber} data-pdf-source-marker={sourceStart && partIndex === 0 ? "" : undefined} key={`${partIndex}-${part.text}`}>{part.text}</Box>;
    const footnoteKey = pdfFootnoteTargetKey(chapterIndex, part.marker);
    const referenceKey = pdfReferenceTargetKey(chapterIndex, part.marker);
    const isFootnoteReference = footnoteTargetKeys.has(footnoteKey);
    const targetKey = isFootnoteReference ? footnoteKey : referenceTargetKeys.has(referenceKey) ? referenceKey : undefined;
    const id = `pdf-footnote-ref-${pageNumber}-${targetKey}-${blockIndex}-${partIndex}`;
    if (!targetKey) return <Box component="span" data-pdf-source-page={pageNumber} data-pdf-source-marker={sourceStart && partIndex === 0 ? "" : undefined} key={id} sx={{ fontSize: "0.72em", lineHeight: 1, verticalAlign: "super" }}>{part.marker}</Box>;
    return (
      <Box
        component="button"
        type="button"
        data-pdf-source-page={pageNumber}
        data-pdf-source-marker={sourceStart && partIndex === 0 ? "" : undefined}
        id={id}
        data-pdf-footnote-reference={isFootnoteReference ? targetKey : undefined}
        data-pdf-reference-citation={isFootnoteReference ? undefined : targetKey}
        aria-label={isFootnoteReference ? `查看文中注释 ${part.marker}` : `查看参考文献 ${part.marker}`}
        onClick={(event: MouseEvent<HTMLButtonElement>) => onOpenFootnote(targetKey, event.currentTarget)}
        key={id}
        sx={{ appearance: "none", background: "none", border: 0, borderRadius: 0, display: "inline", minWidth: 0, p: 0, m: 0, boxShadow: "none", cursor: "pointer", color: "inherit", fontFamily: "inherit", fontSize: "0.72em", fontWeight: "inherit", lineHeight: 1, verticalAlign: "super", textIndent: 0, textDecoration: "none", "&:hover": { textDecoration: "underline" }, "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: "2px" } }}
      >
        {part.marker}
      </Box>
    );
  });
}

function footnoteMarkerKey(marker: string) {
  return marker === "*" ? "star" : marker.replace(/\D/gu, "");
}
