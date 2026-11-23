import type { PDFDocumentProxy } from "pdfjs-dist";
import type { TocItem } from "./types";
import type { PdfReadingBlock } from "./pdf-reading-text";

// 直接使用原文件目录标题，仅隔离损坏的导航目标。
// Keep source outline titles and isolate malformed navigation destinations.
export async function pdfNavigation(document: PDFDocumentProxy): Promise<TocItem[]> {
  const outline = await document.getOutline();
  const flatten = async (entries: NonNullable<typeof outline>, depth = 0): Promise<TocItem[]> => (await Promise.all(entries.map(async entry => {
    const children = await flatten(entry.items ?? [], depth + 1);
    let pageNumber: number | undefined;
    try {
      const destination = typeof entry.dest === "string" ? await document.getDestination(entry.dest) : entry.dest;
      const page = destination?.[0];
      pageNumber = page === undefined ? undefined : typeof page === "number" ? page + 1 : (await document.getPageIndex(page)) + 1;
      if (!Number.isInteger(pageNumber) || pageNumber! < 1 || pageNumber! > document.numPages) pageNumber = undefined;
    } catch { /* 单个目标损坏不丢弃有效节点。 Keep valid siblings and children when a source destination is broken. */ }
    const locator = pageNumber ? `pdf:page=${pageNumber}` : children[0]?.locator;
    const label = entry.title.trim();
    if (isPlaceholderOutlineLabel(label)) return children;
    return [...(locator && label ? [{ href: locator, locator, label, depth }] : []), ...children];
  }))).flat();
  return outline ? await flatten(outline) : [];
}

/** Build usable PDF navigation from printed TOC entries when the file has no real bookmarks. */
export function pdfPrintedTocNavigation(pages: ReadonlyMap<number, readonly PdfReadingBlock[]>, numPages: number): TocItem[] {
  const parsedPages = [...pages.entries()].sort(([left], [right]) => left - right);
  let tocPages: number[] = [];
  for (let index = 0; index < parsedPages.length; index += 1) {
    if (!parsedPages[index]?.[1].some(block => block.kind === "toc-entry")) continue;
    const run = [parsedPages[index]![0]];
    while (parsedPages[index + 1]?.[1].some(block => block.kind === "toc-entry")) run.push(parsedPages[++index]![0]);
    if (run.length > tocPages.length) tocPages = run;
  }
  if (tocPages.length === 0) return [];
  const firstBodyPage = (tocPages.at(-1) ?? 0) + 1;
  const tocPageSet = new Set(tocPages);
  const entries = parsedPages.flatMap(([page, blocks]) => tocPageSet.has(page)
    ? blocks.flatMap(block => block.kind === "toc-entry"
      ? [{ page, label: block.text.trim(), printedPage: Number(block.pageLabel.match(/^\d+/u)?.[0]) }]
      : [])
    : [])
    .filter(entry => entry.label.length > 0 && Number.isInteger(entry.printedPage) && entry.printedPage! > 0);
  if (entries.length === 0) return [];

  const bodyPages = parsedPages.filter(([page]) => page >= firstBodyPage);
  const offsets = new Map<number, Map<number, { label: string; printedPage: number }>>();
  entries.forEach(entry => {
    const title = normalizeTitle(stripPrintedDate(entry.label));
    if (title.length < 2) return;
    const match = bodyPages.find(([, blocks]) => blocks.some(block => {
      if (block.kind === "toc-entry" || block.kind === "footnote") return false;
      return normalizeTitle(block.text).includes(title);
    }));
    if (!match) return;
    const offset = match[0] - entry.printedPage!;
    const anchors = offsets.get(offset) ?? new Map<number, { label: string; printedPage: number }>();
    anchors.set(entry.printedPage!, { label: entry.label, printedPage: entry.printedPage! });
    offsets.set(offset, anchors);
  });
  const anchorCandidates = [...offsets.entries()].map(([offset, anchors]) => ({ offset, anchors: [...anchors.values()] }));
  anchorCandidates.forEach(candidate => {
    candidate.anchors = candidate.anchors.filter(anchor => {
      const title = normalizeTitle(stripPrintedDate(anchor.label));
      return bodyPages.some(([page, blocks]) => page === anchor.printedPage + candidate.offset && blocks.some(block =>
        block.kind !== "toc-entry" && block.kind !== "footnote" && normalizeTitle(block.text).includes(title)));
    });
  });
  const bestCandidate = anchorCandidates.sort((left, right) => right.anchors.length - left.anchors.length || left.offset - right.offset)[0];
  const pageOffset = bestCandidate?.offset;
  const bestAnchors = bestCandidate?.anchors ?? [];
  if (pageOffset === undefined || bestAnchors.length < 2 || bestAnchors.length / entries.length < 0.1) return [];

  return entries.flatMap(({ label, printedPage }) => {
    const pageNumber = printedPage! + pageOffset;
    if (pageNumber < 1 || pageNumber > numPages) return [];
    const locator = `pdf:page=${pageNumber}`;
    return [{ href: locator, locator, label, depth: inferDepth(label) }];
  });
}

function normalizeTitle(value: string) {
  return value.toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

function stripPrintedDate(value: string) {
  return value.replace(/[（(][^）)]*(?:一九|二〇|二○|19\d{2})[^）)]*[）)]\s*$/u, "");
}

function isPlaceholderOutlineLabel(value: string) {
  return /^(?:untitled(?:\s+page)?|blank(?:\s+page)?|no title|未标题|无标题|空白页面|空白页|页面\s*\d+)$/iu.test(value.trim());
}

function inferDepth(label: string) {
  if (/^[一二三四五六七八九十]+[、.． ]/u.test(label) || /^[（(]\d+[)）]/u.test(label)) return 1;
  return 0;
}
