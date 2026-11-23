// 覆盖重排页裁切、单双页布局及跨原始页回退；上一页尚未测量时应返回等待状态。
// Covers reflow clipping, single/spread layout and cross-original-page back navigation, returning a pending state when the previous page is not measured.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { getDocument } from "pdfjs-dist";
import { vi } from "vitest";
import type { Annotation } from "../../domain/types";
import { api } from "../../api/client";
import { tokens } from "../../theme/tokens";
import PdfDocumentReader, { PdfPagedText, PdfReadingClipFrame, groupPdfSourceBlocks, movePdfFootnotesToChapterEnd, pdfFootnoteTargetKey, pdfReferenceTargetKey, pdfSourcePositionAt, pdfSourceVirtualPageIndex, pdfTurnPositionAt, remapPdfSourceTarget } from "./PdfDocumentReader";

vi.mock("pdfjs-dist", () => ({
  getDocument: vi.fn(),
  GlobalWorkerOptions: {},
  TextLayer: class {},
}));

vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({ default: "pdf-worker" }));

describe("PdfReadingClipFrame", () => {
  it("clips virtual PDF columns at the inner reading-page boundary", () => {
    const { container } = render(
      <PdfReadingClipFrame>
        <p>下一虚拟页</p>
      </PdfReadingClipFrame>,
    );

    const frame = container.querySelector(".pdf-reading-clip-frame");
    expect(frame).not.toBeNull();
    expect(frame).toHaveStyle({ height: "100%", minHeight: "0", width: "100%", overflow: "hidden" });
    expect(frame).toContainElement(screen.getByText("下一虚拟页"));
  });

  it("derives the PDF spread from the measured reading surface", async () => {
    const widthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get() {
        return this.classList?.contains("reader-page-turn-surface") ? tokens.layout.breakpointTablet : 0;
      },
    });
    vi.mocked(getDocument).mockReturnValue({
      promise: new Promise(() => undefined),
      destroy: vi.fn(),
    } as unknown as ReturnType<typeof getDocument>);

    const { container } = render(
      <PdfDocumentReader
        bookId="book-pdf"
        annotations={[]}
        theme={{ background: "white", foreground: "black", muted: "gray" }}
        fontSize={19}
        fontFamily="serif"
        readOnly
        onSelect={vi.fn()}
        onPosition={vi.fn()}
      />,
    );

    const frame = container.querySelector(".pdf-reading-clip-frame");
    const readingSurface = container.querySelector(".reader-page-turn-surface");
    const pagination = screen.getByRole("navigation", { name: "PDF 翻页" });
    await waitFor(() => expect(readingSurface).toHaveAttribute("data-reader-spread", "true"));
    await waitFor(() => expect(frame?.parentElement).toHaveStyle({ width: "100%", maxWidth: "none" }));
    expect(readingSurface?.nextElementSibling).toBe(pagination);
    if (widthDescriptor) Object.defineProperty(HTMLElement.prototype, "clientWidth", widthDescriptor);
    else Reflect.deleteProperty(HTMLElement.prototype, "clientWidth");
  });

  it("jumps to PDF bookmarks after opening, including repeated requests to the same target", async () => {
    const onPosition = vi.fn();
    vi.mocked(getDocument).mockReturnValue({
      promise: Promise.resolve({ numPages: 8, getPage: vi.fn(() => new Promise(() => undefined)) }),
      destroy: vi.fn(),
    } as unknown as ReturnType<typeof getDocument>);
    const props = { bookId: "pdf-bookmark", annotations: [], theme: { background: "white", foreground: "black", muted: "gray" }, fontSize: 19, fontFamily: "serif", readOnly: true, onSelect: vi.fn(), onPosition };
    const view = render(<PdfDocumentReader {...props} />);
    await waitFor(() => expect(onPosition).toHaveBeenCalledWith("pdf:page=1&offset=0", expect.any(Number)));
    view.rerender(<PdfDocumentReader {...props} target="pdf:page=5&offset=2" targetRevision={1} />);
    await waitFor(() => expect(onPosition).toHaveBeenLastCalledWith("pdf:page=5&offset=2", expect.any(Number)));
    view.rerender(<PdfDocumentReader {...props} target="pdf:page=2" targetRevision={2} />);
    await waitFor(() => expect(onPosition).toHaveBeenLastCalledWith("pdf:page=2&offset=0", expect.any(Number)));
    view.rerender(<PdfDocumentReader {...props} target="pdf:page=5&offset=2" targetRevision={3} />);
    await waitFor(() => expect(onPosition).toHaveBeenLastCalledWith("pdf:page=5&offset=2", expect.any(Number)));
  });

  it("resolves PDF outlines into chapter boundaries for bookmark markers", async () => {
    const onNavigation = vi.fn();
    vi.mocked(getDocument).mockReturnValue({
      promise: Promise.resolve({ numPages: 8, getPage: vi.fn(() => new Promise(() => undefined)),
        getOutline: vi.fn().mockResolvedValue([{ title: "第一章", dest: "chapter-one", items: [{ title: "第一点", dest: [2], items: [] }] }]),
        getDestination: vi.fn().mockResolvedValue([{ num: 12, gen: 0 }]),
        getPageIndex: vi.fn().mockResolvedValue(1),
      }),
      destroy: vi.fn(),
    } as unknown as ReturnType<typeof getDocument>);
    render(<PdfDocumentReader bookId="pdf-outline" annotations={[]} theme={{ background: "white", foreground: "black", muted: "gray" }} fontSize={19} fontFamily="serif" readOnly onNavigation={onNavigation} onSelect={vi.fn()} onPosition={vi.fn()} />);
    await waitFor(() => expect(onNavigation).toHaveBeenCalledWith([
      { href: "pdf:page=2", locator: "pdf:page=2", label: "第一章", depth: 0 },
      { href: "pdf:page=3", locator: "pdf:page=3", label: "第一点", depth: 1 },
    ]));
  });

  it("builds PDF navigation from printed contents when the outline has only placeholders", async () => {
    const onNavigation = vi.fn();
    const pageText = (lines: string[]) => ({
      getTextContent: vi.fn().mockResolvedValue({
        items: lines.map((str, index) => ({
          str,
          transform: [1, 0, 0, 12, 36, 720 - index * 24],
          width: str.length * 12,
          height: 12,
          hasEOL: true,
        })),
      }),
    });
    const pages = [
      pageText(["目录", "第一章 概述 .... 1", "第二章 方法 .... 2", "第三章 结果 .... 3"]),
      pageText(["第一章 概述", "这是概述正文。"]),
      pageText(["第二章 方法", "这是方法正文。"]),
      pageText(["第三章 结果", "这是结果正文。"]),
    ];
    vi.mocked(getDocument).mockReturnValue({
      promise: Promise.resolve({
        numPages: pages.length,
        getPage: vi.fn(async (pageNumber: number) => pages[pageNumber - 1]),
        getOutline: vi.fn().mockResolvedValue([
          { title: "未标题", dest: [0], items: [] },
          { title: "空白页面", dest: [1], items: [] },
        ]),
        getPageIndex: vi.fn(async (ref: { num: number }) => ref.num - 1),
      }),
      destroy: vi.fn(),
    } as unknown as ReturnType<typeof getDocument>);

    render(<PdfDocumentReader bookId="pdf-printed-toc" annotations={[]} theme={{ background: "white", foreground: "black", muted: "gray" }} fontSize={19} fontFamily="serif" readOnly onNavigation={onNavigation} onSelect={vi.fn()} onPosition={vi.fn()} />);

    await waitFor(() => expect(onNavigation).toHaveBeenCalledWith([
      { href: "pdf:page=2", locator: "pdf:page=2", label: "第一章 概述", depth: 0 },
      { href: "pdf:page=3", locator: "pdf:page=3", label: "第二章 方法", depth: 0 },
      { href: "pdf:page=4", locator: "pdf:page=4", label: "第三章 结果", depth: 0 },
    ]));
  });

  it("uses the bottom navigation as the only generated PDF page label", async () => {
    vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    const page = {
      getTextContent: vi.fn().mockResolvedValue({
        items: [{ str: "这是一段正文。", transform: [1, 0, 0, 12, 36, 720], width: 96, height: 12, hasEOL: true }],
      }),
    };
    vi.mocked(getDocument).mockReturnValue({
      promise: Promise.resolve({ numPages: 8, getPage: vi.fn().mockImplementation(async (pageNumber: number) => pageNumber === 1 ? page : ({
        getTextContent: vi.fn().mockResolvedValue({ items: [{ str: `下一原页继续排版${pageNumber}`, transform: [1, 0, 0, 12, 36, 720], width: 120, height: 12, hasEOL: true }] }),
      })) }),
      destroy: vi.fn(),
    } as unknown as ReturnType<typeof getDocument>);

    const onSelect = vi.fn();
    const { container } = render(
      <PdfDocumentReader
        bookId="book-pdf"
        annotations={[]}
        theme={{ background: "white", foreground: "black", muted: "gray" }}
        fontSize={19}
        fontFamily="serif"
        readOnly
        onSelect={onSelect}
        onPosition={vi.fn()}
      />,
    );

    expect(await screen.findByText("这是一段正文。")).toBeInTheDocument();
    const nextPageText = screen.getByText("下一原页继续排版2");
    expect(nextPageText).toHaveAttribute("data-pdf-source-page", "2");
    const selectionRange = document.createRange();
    selectionRange.selectNodeContents(nextPageText);
    Object.defineProperty(selectionRange, "getBoundingClientRect", { value: () => new DOMRect(1, 2, 20, 10) });
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(selectionRange);
    fireEvent.mouseUp(container.querySelector("article")!);
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ locator: "pdf:page=2&offset=0" }));
    selection?.removeAllRanges();
    expect(screen.getByRole("navigation", { name: "PDF 翻页" })).toHaveTextContent("第 1 页 · 共 8 页");
    expect(screen.queryByText(/^第 1 页$/u)).not.toBeInTheDocument();
  });
});

describe("PDF footnote placement", () => {
  it("moves each note to the end of its article and gives only matching references a target", () => {
    const blocks = movePdfFootnotesToChapterEnd([
      { pageNumber: 1, block: { kind: "paragraph", text: "第一篇正文引用[2]并参见[1]。" } },
      { pageNumber: 1, block: { kind: "heading", text: "参考文献", bibliographySection: true } },
      { pageNumber: 1, block: { kind: "footnote", marker: "[1]", text: "参考文献保留原位。" } },
      { pageNumber: 2, block: { kind: "heading", text: "注释", notesSection: true } },
      { pageNumber: 2, block: { kind: "footnote", marker: "[2]", text: "第一篇脚注。" } },
      { pageNumber: 2, block: { kind: "footnote", marker: "[2]", text: "同标记的重复定义。" } },
      { pageNumber: 3, block: { kind: "heading", text: "第二篇", chapterStart: true } },
      { pageNumber: 3, block: { kind: "paragraph", text: "第二篇正文引用*。" } },
      { pageNumber: 4, block: { kind: "footnote", marker: "*", text: "第二篇脚注。" } },
    ]);

    expect(blocks.map(({ block }) => block?.kind === "footnote" ? block.text : block?.text)).toEqual([
      "第一篇正文引用[2]并参见[1]。", "参考文献", "参考文献保留原位。", "注释", "第一篇脚注。", "同标记的重复定义。", "第二篇", "第二篇正文引用*。", "注释", "第二篇脚注。",
    ]);
    const notes = blocks.filter(({ block }) => block?.kind === "footnote");
    expect(notes.map(({ pageNumber }) => pageNumber)).toEqual([1, 1, 3]);
    expect(notes.map(({ footnoteTargetKey }) => footnoteTargetKey)).toEqual([
      pdfFootnoteTargetKey(0, "[2]"), undefined, pdfFootnoteTargetKey(1, "*"),
    ]);
    const references = blocks.filter(({ block }) => block?.kind === "reference");
    expect(references).toHaveLength(1);
    expect(references[0]?.referenceTargetKey).toBe(pdfReferenceTargetKey(0, "[1]"));
    expect(blocks.filter(({ block }) => block?.kind === "footnote" && block.text === "第一篇脚注。")).toHaveLength(1);
  });
});

it("pauses PDF source geometry measurement during page-turn transforms and measures after", async () => {
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
  const onPageCountChange = vi.fn();
  const props = {
    textRef: createRef<HTMLDivElement>(),
    document: {} as never,
    blocks: [{ pageNumber: 1, block: { kind: "paragraph" as const, text: "动画期间不读取变换后的坐标。" } }],
    sourcePageStarts: new Map<number, number>(),
    pageNumber: 1,
    theme: { background: "white", foreground: "black", muted: "gray" },
    fontFamily: "serif",
    fontSize: 19,
    layout: { surfaceWidth: 400, contentWidth: 400, spread: false, visibleColumns: 1, pagePadding: 24, columnWidth: 300, columnGap: 40, pageStride: 340, articleWidth: 348 },
    pageIndex: 0,
    onPageCountChange,
    onOpenFootnote: vi.fn(),
    onReturnToReference: vi.fn(),
    onCaptureSelection: vi.fn(),
  };
  const view = render(<PdfPagedText {...props} turning />);
  expect(onPageCountChange).not.toHaveBeenCalled();

  view.rerender(<PdfPagedText {...props} turning={false} />);
  await waitFor(() => expect(onPageCountChange).toHaveBeenCalledOnce());
});

describe("PdfDocumentReader annotation activation", () => {
  it("opens notes by click or keyboard, ignores selected text and plain highlights, and keeps the callback current", async () => {
    vi.mocked(getDocument).mockClear();
    const page = {
      getTextContent: vi.fn().mockResolvedValue({
        items: [{ str: "点击笔记打开，普通高亮不打开。", transform: [1, 0, 0, 12, 36, 720], width: 240, height: 12, hasEOL: true }],
      }),
    };
    vi.mocked(getDocument).mockReturnValue({
      promise: Promise.resolve({ numPages: 1, getPage: vi.fn().mockResolvedValue(page) }),
      destroy: vi.fn(),
    } as unknown as ReturnType<typeof getDocument>);
    const note: Annotation = {
      id: "pdf-note",
      bookId: "book-pdf",
      type: "NOTE",
      style: "HIGHLIGHT",
      color: "PINK",
      locator: "pdf:page=1&offset=0",
      quote: "点击笔记打开",
      note: "这段内容要再读一次。",
      createdAt: "2026-10-28T00:00:00Z",
    };
    const plainHighlight: Annotation = {
      id: "pdf-plain-highlight",
      bookId: "book-pdf",
      type: "HIGHLIGHT",
      style: "HIGHLIGHT",
      color: "YELLOW",
      locator: "pdf:page=1&offset=0",
      quote: "普通高亮不打开",
      createdAt: "2026-10-28T00:00:00Z",
    };
    const firstCallback = vi.fn();
    const latestCallback = vi.fn();
    const props = {
      bookId: "book-pdf",
      annotations: [note, plainHighlight],
      theme: { background: "white", foreground: "black", muted: "gray" },
      fontSize: 19,
      fontFamily: "serif",
      readOnly: true,
      onSelect: vi.fn(),
      onPosition: vi.fn(),
    };
    const view = render(<PdfDocumentReader {...props} onAnnotationActivate={firstCallback} />);
    const noteMark = (await screen.findAllByRole("button", { name: "编辑划线或笔记" })).find(mark => mark.dataset.annotationId === "pdf-note")!;
    expect(noteMark).toHaveAttribute("data-annotation-id", "pdf-note");
    const plainMark = view.container.querySelector<HTMLElement>('[data-annotation-id="pdf-plain-highlight"]');
    expect(plainMark).not.toBeNull();

    fireEvent.click(noteMark);
    fireEvent.keyDown(noteMark, { key: "Enter" });
    fireEvent.keyDown(noteMark, { key: " " });
    expect(firstCallback).toHaveBeenNthCalledWith(1, "pdf-note", expect.any(DOMRect));
    expect(firstCallback).toHaveBeenNthCalledWith(2, "pdf-note", expect.any(DOMRect));
    expect(firstCallback).toHaveBeenNthCalledWith(3, "pdf-note", expect.any(DOMRect));

    const range = document.createRange();
    range.selectNodeContents(noteMark);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    fireEvent.click(noteMark);
    selection?.removeAllRanges();
    fireEvent.click(plainMark!);
    expect(firstCallback).toHaveBeenCalledTimes(4);

    view.rerender(<PdfDocumentReader {...props} onAnnotationActivate={latestCallback} />);
    fireEvent.click(view.container.querySelector('[data-annotation-id="pdf-note"]')!);
    expect(latestCallback).toHaveBeenCalledWith("pdf-note", expect.any(DOMRect));
    expect(firstCallback).toHaveBeenCalledTimes(4);
    expect(getDocument).toHaveBeenCalledTimes(1);
  });
});

describe("pdfTurnPositionAt", () => {
  it("advances from the latest virtual cursor after a layout reflow", () => {
    const cursorAfterResize = {
      pageNumber: 54,
      virtualPageIndex: 1912,
      virtualPageCount: 2500,
    };
    const starts = new Map([[54, 1912], [55, 1915]]);
    expect(pdfTurnPositionAt(cursorAfterResize, "NEXT", starts))
      .toEqual({ pageNumber: 54, virtualPageIndex: 1913 });
    expect(pdfTurnPositionAt(cursorAfterResize, "PREVIOUS", starts))
      .toEqual({ pageNumber: 54, virtualPageIndex: 1911 });
  });
});

describe("pdfTurnPositionAt on a screen shared by two source pages", () => {
  it("returns to the first source page when paging back onto the shared first screen", () => {
    // Pages 1 and 2 both start on screen 0; the reader is on page 2, offset 1 (screen 1).
    const starts = new Map([[1, 0], [2, 0], [3, 2]]);
    const cursor = { pageNumber: 2, virtualPageIndex: 1, virtualPageCount: 6 };
    expect(pdfTurnPositionAt(cursor, "PREVIOUS", starts)).toEqual({ pageNumber: 1, virtualPageIndex: 0 });
  });

  it("still continues the current page when advancing past a shared screen", () => {
    const starts = new Map([[1, 0], [2, 0], [3, 2]]);
    expect(pdfTurnPositionAt({ pageNumber: 1, virtualPageIndex: 0, virtualPageCount: 6 }, "NEXT", starts))
      .toEqual({ pageNumber: 2, virtualPageIndex: 1 });
  });
});

describe("remapPdfSourceTarget", () => {
  it("keeps the requested source page when later layout measurement changes its virtual index", () => {
    const target = { pageNumber: 18, offset: 0, virtualPageIndex: 37 };
    expect(remapPdfSourceTarget(target, new Map([[18, 1912]]), 2500))
      .toEqual({ pageNumber: 18, offset: 0, virtualPageIndex: 1912 });
    expect(remapPdfSourceTarget(target, new Map(), 2500)).toBeNull();
  });
});

describe("pdfSourcePositionAt", () => {
  it("keeps same-screen source pages anchored to the first page and advances at the next screen start", () => {
    const starts = new Map([[17, 0], [18, 0], [19, 1]]);
    expect(pdfSourcePositionAt(starts, 0, 17)).toEqual({ pageNumber: 17, offset: 0 });
    expect(pdfSourcePositionAt(starts, 1, 0)).toEqual({ pageNumber: 19, offset: 0 });
    expect(pdfSourcePositionAt(starts, 2, 19)).toEqual({ pageNumber: 19, offset: 1 });
  });

  it("round-trips a locator for a source page sharing a screen with the preceding page", () => {
    const sourcePage = 18;
    const offset = 0;
    const starts = new Map([[17, 0], [18, 0]]);
    const destinationIndex = starts.get(sourcePage)! + offset;
    expect(pdfSourcePositionAt(starts, destinationIndex, sourcePage)).toEqual({ pageNumber: 18, offset: 0 });
  });
});

describe("groupPdfSourceBlocks", () => {
  it("joins a paragraph across consecutive source pages without dropping each page segment", () => {
    const groups = groupPdfSourceBlocks([
      { pageNumber: 17, block: { kind: "paragraph", text: "诸位代表先生们：我们有一个共同的感觉，这就是我们" } },
      { pageNumber: 18, block: { kind: "paragraph", text: "的工作将写在人类的历史上继续前进" } },
      { pageNumber: 19, block: { kind: "paragraph", text: "，并且继续推动人类社会向前发展。" } },
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.map(({ source }) => source.pageNumber)).toEqual([17, 18, 19]);
    expect(groups[0]?.map(({ source }) => source.block?.text).join("")).toContain("这就是我们的工作将写在人类的历史上继续前进，并且继续推动人类社会向前发展。");
  });

  it("does not merge across sentence endings, headings or image pages", () => {
    expect(groupPdfSourceBlocks([
      { pageNumber: 1, block: { kind: "paragraph", text: "上一句结束。" } },
      { pageNumber: 2, block: { kind: "paragraph", text: "下一句开始。" } },
    ])).toHaveLength(2);
    expect(groupPdfSourceBlocks([
      { pageNumber: 1, block: { kind: "paragraph", text: "前文尚未结束" } },
      { pageNumber: 2, block: { kind: "heading", text: "下一章" } },
    ])).toHaveLength(2);
    expect(groupPdfSourceBlocks([
      { pageNumber: 1, block: { kind: "paragraph", text: "前文尚未结束" } },
      { pageNumber: 2, imagePage: true },
      { pageNumber: 3, block: { kind: "paragraph", text: "后文继续" } },
    ])).toHaveLength(3);
  });
});

it("maps first-character source positions with floor, including the within-column case", () => {
  expect(pdfSourceVirtualPageIndex(48 + 500, 48, 760, 120, 1)).toBe(0);
  expect(pdfSourceVirtualPageIndex(48 + 760 + 120 + 12, 48, 760, 120, 1)).toBe(1);
  expect(pdfSourceVirtualPageIndex(48 + 760 + 120 + 12, 48, 760, 120, 2)).toBe(0);
});

it("flows short paragraphs from adjacent original PDF pages in one reading stream", async () => {
  vi.mocked(getDocument).mockReturnValue({
    promise: Promise.resolve({
      numPages: 3,
      getPage: vi.fn(async (pageNumber: number) => ({
        getTextContent: async () => ({ items: [{ str: `第${pageNumber}页短段。`, transform: [1, 0, 0, 12, 36, 720], width: 88, height: 12, hasEOL: true }] }),
      })),
    }),
    destroy: vi.fn(),
  } as unknown as ReturnType<typeof getDocument>);

  const { container } = render(<PdfDocumentReader bookId="pdf-continuous-pages" annotations={[]} theme={{ background: "white", foreground: "black", muted: "gray" }} fontSize={19} fontFamily="serif" readOnly onSelect={vi.fn()} onPosition={vi.fn()} />);
  expect(await screen.findByText("第3页短段。")).toBeInTheDocument();
  const article = container.querySelector("article")!;
  expect(article).toContainElement(screen.getByText("第1页短段。"));
  expect(article).toContainElement(screen.getByText("第2页短段。"));
  expect(article).toContainElement(screen.getByText("第3页短段。"));
  expect(article?.querySelectorAll("[data-pdf-source-marker]")).toHaveLength(3);
});

it("starts the next article on a new column after the preceding article's notes", async () => {
  const textItem = (str: string, x: number, y: number, width: number, height: number) => ({
    str, transform: [1, 0, 0, height, x, y], width, height, hasEOL: true,
  });
  const pages = [
    [
      textItem("上一篇的最后一句。", 90, 720, 160, 16),
      textItem("注释", 122, 670, 48, 12),
      textItem("[1]参看本书第四卷。", 122, 647, 160, 12),
    ],
    [
      textItem("中国人民大团结万岁*", 180, 569, 241, 26),
      textItem("全国同胞们：中国人民政治协商会议业已胜利地完成", 122, 482, 390, 16),
      textItem("了自己的任务，接下来的正文属于新的一篇。", 90, 459, 423, 16),
    ],
  ];
  vi.mocked(getDocument).mockReturnValue({
    promise: Promise.resolve({
      numPages: pages.length,
      getPage: vi.fn(async (pageNumber: number) => ({ getTextContent: async () => ({ items: pages[pageNumber - 1] }) })),
    }),
    destroy: vi.fn(),
  } as unknown as ReturnType<typeof getDocument>);

  render(<PdfDocumentReader bookId="pdf-chapter-breaks" annotations={[]} theme={{ background: "white", foreground: "black", muted: "gray" }} fontSize={19} fontFamily="serif" readOnly onSelect={vi.fn()} onPosition={vi.fn()} />);
  const title = await screen.findByText("中国人民大团结万岁");
  expect(title.closest("h2")).toHaveAttribute("data-pdf-chapter-start");
  expect(title.closest("h2")).toHaveStyle({ breakBefore: "column", breakAfter: "avoid-column" });
  expect(title).toHaveAttribute("data-pdf-source-page", "2");
  expect(title).toHaveAttribute("data-pdf-source-marker");
  expect(screen.getByRole("heading", { name: "注释" })).toBeInTheDocument();
  expect(screen.getByRole("note")).toHaveTextContent("参看本书第四卷。");
  expect(screen.queryByRole("button", { name: "查看文中注释 *" })).not.toBeInTheDocument();
});

it("shows a PDF footnote once at the article end and lets its reference jump to it", async () => {
  const page = {
    getTextContent: vi.fn().mockResolvedValue({
      items: [
        { str: "这一句正文引用了注释*。", transform: [1, 0, 0, 16, 90, 720], width: 190, height: 16, hasEOL: true },
        { str: "注释", transform: [1, 0, 0, 12, 122, 670], width: 48, height: 12, hasEOL: true },
        { str: "* 这条脚注应该只在篇末显示一次。", transform: [1, 0, 0, 12, 122, 647], width: 210, height: 12, hasEOL: true },
      ],
    }),
  };
  vi.mocked(getDocument).mockReturnValue({
    promise: Promise.resolve({ numPages: 1, getPage: vi.fn().mockResolvedValue(page) }),
    destroy: vi.fn(),
  } as unknown as ReturnType<typeof getDocument>);

  const { container } = render(<PdfDocumentReader bookId="pdf-footnote-end" annotations={[]} theme={{ background: "white", foreground: "black", muted: "gray" }} fontSize={19} fontFamily="serif" readOnly onSelect={vi.fn()} onPosition={vi.fn()} />);
  const reference = await screen.findByRole("button", { name: "查看文中注释 *" });
  const note = await screen.findByRole("note");

  expect(container.querySelectorAll("article aside")).toHaveLength(1);
  expect(note).toHaveTextContent("这条脚注应该只在篇末显示一次。");
  expect(container.querySelector("article")).toHaveTextContent("正文引用");

  fireEvent.click(reference);
  await waitFor(() => expect(note).toHaveFocus());
});

it("renders a continued paragraph as one node while retaining selectable source-page spans", async () => {
  const firstSegment = "诸位代表先生们：我们有一个共同的感觉，这就是我们";
  const secondSegment = "的工作将写在人类的历史上并且继续进行下去。";
  vi.mocked(getDocument).mockReturnValue({
    promise: Promise.resolve({
      numPages: 2,
      getPage: vi.fn(async (pageNumber: number) => ({
        getTextContent: async () => ({ items: [{ str: pageNumber === 1 ? firstSegment : secondSegment, transform: [1, 0, 0, 12, 36, 720], width: 250, height: 12, hasEOL: true }] }),
      })),
    }),
    destroy: vi.fn(),
  } as unknown as ReturnType<typeof getDocument>);
  const onSelect = vi.fn();
  const { container } = render(<PdfDocumentReader bookId="pdf-continued-paragraph" annotations={[]} theme={{ background: "white", foreground: "black", muted: "gray" }} fontSize={19} fontFamily="serif" readOnly onSelect={onSelect} onPosition={vi.fn()} />);

  expect(await screen.findByText(firstSegment)).toBeInTheDocument();
  const firstSpan = screen.getByText(firstSegment);
  const secondSpan = screen.getByText(secondSegment);
  expect(firstSpan.closest("p")).toBe(secondSpan.closest("p"));
  expect(firstSpan).toHaveAttribute("data-pdf-source-page", "1");
  expect(secondSpan).toHaveAttribute("data-pdf-source-page", "2");
  expect(firstSpan).toHaveAttribute("data-pdf-source-marker");
  expect(secondSpan).toHaveAttribute("data-pdf-source-marker");

  const selectionRange = document.createRange();
  selectionRange.selectNodeContents(secondSpan);
  Object.defineProperty(selectionRange, "getBoundingClientRect", { value: () => new DOMRect(1, 2, 20, 10) });
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(selectionRange);
  fireEvent.mouseUp(container.querySelector("article")!);
  expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ locator: "pdf:page=2&offset=0" }));
  selection?.removeAllRanges();
});

it("appends later extraction batches, restores page 13 without saving page 1, and retains an image-page placeholder", async () => {
  const widthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get() { return this.classList?.contains("reader-page-turn-surface") ? tokens.layout.breakpointTablet : 0; },
  });
  const canvasContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
  const getPosition = vi.spyOn(api, "getReadingPosition").mockResolvedValue({ locator: "pdf:page=13&offset=0" } as never);
  const savePosition = vi.spyOn(api, "saveReadingPosition").mockResolvedValue({} as never);
  vi.mocked(getDocument).mockReturnValue({
    promise: Promise.resolve({
      numPages: 13,
      getPage: vi.fn(async (pageNumber: number) => ({
        getTextContent: async () => ({ items: pageNumber === 2 ? [] : [{ str: `第${pageNumber}页批次正文。`, transform: [1, 0, 0, 12, 36, 720], width: 120, height: 12, hasEOL: true }] }),
        getViewport: ({ scale }: { scale: number }) => ({ width: 200 * scale, height: 300 * scale }),
        render: () => ({ promise: Promise.resolve(), cancel: vi.fn() }),
      })),
    }),
    destroy: vi.fn(),
  } as unknown as ReturnType<typeof getDocument>);

  try {
    const { container } = render(<PdfDocumentReader bookId="pdf-batched-target" annotations={[]} theme={{ background: "white", foreground: "black", muted: "gray" }} fontSize={19} fontFamily="serif" target="pdf:page=13&offset=0" targetRevision={1} onSelect={vi.fn()} onPosition={vi.fn()} />);
    expect(await screen.findByText("第13页批次正文。")).toBeInTheDocument();
    expect(container.querySelector("article")).toContainElement(screen.getByText("第1页批次正文。"));
    expect(container.querySelector("[data-pdf-source-page='2'][data-pdf-source-marker]")).not.toBeNull();
    await waitFor(() => expect(savePosition).toHaveBeenCalledWith("pdf-batched-target", "pdf:page=13&offset=0", expect.any(Number)));
    expect(savePosition).not.toHaveBeenCalledWith("pdf-batched-target", "pdf:page=1&offset=0", expect.any(Number));
  } finally {
    getPosition.mockRestore();
    savePosition.mockRestore();
    canvasContext.mockRestore();
    if (widthDescriptor) Object.defineProperty(HTMLElement.prototype, "clientWidth", widthDescriptor);
    else Reflect.deleteProperty(HTMLElement.prototype, "clientWidth");
  }
});

it("shows two scanned pages on wide screens and advances without skipping pages", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => tokens.layout.breakpointTablet });
  const context = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as CanvasRenderingContext2D);
  const page = { getTextContent: async () => ({ items: [], styles: {} }), getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }), render: () => ({ promise: Promise.resolve(), cancel: vi.fn() }) };
  vi.mocked(getDocument).mockReturnValue({ promise: Promise.resolve({ numPages: 5, getPage: async () => page }), destroy: vi.fn() } as unknown as ReturnType<typeof getDocument>);
  try {
    render(<PdfDocumentReader bookId="scan" annotations={[]} theme={{ background: "white", foreground: "black", muted: "gray" }} fontSize={19} fontFamily="sans-serif" pageTurnEnabled={false} readOnly onSelect={vi.fn()} onPosition={vi.fn()} />);
    expect(await screen.findByRole("img", { name: "PDF 第 1 页图片" })).toBeInTheDocument();
    expect(await screen.findByRole("img", { name: "PDF 第 2 页图片" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "PDF 下一页" }));
    expect(await screen.findByRole("img", { name: "PDF 第 3 页图片" })).toBeInTheDocument();
    expect(await screen.findByRole("img", { name: "PDF 第 4 页图片" })).toBeInTheDocument();
  } finally {
    context.mockRestore();
    if (descriptor) Object.defineProperty(HTMLElement.prototype, "clientWidth", descriptor);
  }
});
