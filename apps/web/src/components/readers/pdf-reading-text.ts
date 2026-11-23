export interface PdfTextItemLike {
  str: string;
  transform: number[];
  width?: number;
  height?: number;
  hasEOL?: boolean;
}

interface ReadingLine {
  text: string;
  x: number;
  y: number;
  height: number;
  endX: number;
}

export type PdfReadingBlock =
  | { kind: "paragraph"; text: string }
  | { kind: "heading"; text: string; chapterStart?: boolean; notesSection?: boolean; bibliographySection?: boolean }
  | { kind: "toc-entry"; text: string; pageLabel: string }
  | { kind: "footnote"; marker: string; text: string }
  | { kind: "reference"; marker: string; text: string };

export function shouldJoinPdfPageBoundaryParagraphs(previous: PdfReadingBlock, next: PdfReadingBlock) {
  if (previous.kind !== "paragraph" || next.kind !== "paragraph") return false;
  if (isShortTitleOrList(previous.text) || isShortTitleOrList(next.text)) return false;
  const previousText = previous.text.trim().replace(/["'”’」』】）)]+$/u, "");
  return !/[。.!！？?；;…⋯]$/u.test(previousText);
}

export function pdfPageBoundarySeparator(previous: string, next: string) {
  return /[A-Za-z0-9,.;:!?)]$/u.test(previous.trimEnd()) && /^[A-Za-z0-9]/u.test(next.trimStart()) ? " " : "";
}

function isShortTitleOrList(value: string) {
  const text = value.trim();
  if (text.length <= 12 || /[:：]$/u.test(text)) return true;
  return /^(?:第.{1,14}[章节篇部卷]|[一二三四五六七八九十]+[、.．]|\d+[.)、]|[（(]\d+[)）]|[•●▪-]\s?)/u.test(text);
}

export type PdfInlineTextPart =
  | { kind: "text"; text: string }
  | { kind: "footnote-reference"; marker: string };

export function pdfTextToReadingBlocks(items: unknown[]): PdfReadingBlock[] {
  const lines = splitTrailingFootnoteSectionHeadings(buildLines(items));
  if (lines.length === 0) return [];
  if (isTableOfContents(lines)) return tableOfContentsBlocks(lines);
  const chapterLines = findChapterHeadingLines(lines);
  const blocks: PdfReadingBlock[] = [];
  let bodyLines: ReadingLine[] = [];
  let title = "";
  const flushBody = () => {
    blocks.push(...reflowParagraphs(bodyLines).map(readingBlockFromParagraph));
    bodyLines = [];
  };
  const flushTitle = () => {
    if (title) blocks.push({ kind: "heading", text: title, chapterStart: true });
    title = "";
  };
  for (const line of lines) {
    if (chapterLines.has(line)) {
      flushBody();
      title += lineSeparator(title, line.text) + line.text;
    } else {
      flushTitle();
      bodyLines.push(line);
    }
  }
  flushTitle();
  flushBody();
  return blocks;
}

function splitTrailingFootnoteSectionHeadings(lines: ReadingLine[]) {
  return lines.flatMap((line) => {
    const match = line.text.match(/^(.+[。.!！？?；;])\s*(注\s*释)$/u);
    if (!match?.[1] || !match[2]) return [line];
    const headingWidth = line.height * 2;
    return [
      { ...line, text: match[1], endX: Math.max(line.x, line.endX - headingWidth) },
      { ...line, text: match[2], x: Math.max(line.x, line.endX - headingWidth) },
    ];
  });
}

function findChapterHeadingLines(lines: ReadingLine[]) {
  // 按正文字符数估计常用字号，只把明显放大且居中的原文标题作为篇章起点。
  // Weight font sizes by text length, and reserve chapter breaks for enlarged, centered source titles.
  const fontWeights = new Map<number, number>();
  lines.forEach(line => {
    const height = Math.round(line.height);
    fontWeights.set(height, (fontWeights.get(height) ?? 0) + line.text.length);
  });
  const bodyHeight = [...fontWeights].sort((left, right) => right[1] - left[1])[0]?.[0] ?? 0;
  const bodyLines = lines.filter(line => Math.abs(line.height - bodyHeight) <= bodyHeight * 0.15);
  const left = Math.min(...bodyLines.map(line => line.x));
  const right = Math.max(...bodyLines.map(line => line.endX));
  const center = (left + right) / 2;
  return new Set(lines.filter(line => line.height >= bodyHeight * 1.5
    && !parseFootnote(line.text)
    && !isNotesSectionHeading(line.text)
    && !isBibliographySectionHeading(line.text)
    && !/^[一二三四五六七八九十百千零〇○\d]+$/u.test(line.text.replace(/\s/gu, ""))
    && Math.abs((line.x + line.endX) / 2 - center) <= Math.max(line.height * 2, (right - left) * 0.1)));
}

export function pdfTextToParagraphs(items: unknown[]): string[] {
  return reflowParagraphs(buildLines(items));
}

function buildLines(items: unknown[]): ReadingLine[] {
  const lines: ReadingLine[] = [];
  let current: ReadingLine | null = null;

  items.filter(isTextItem).forEach((item) => {
    const text = normalizeText(item.str);
    if (!text) {
      if (item.hasEOL && current) {
        lines.push(current);
        current = null;
      }
      return;
    }

    const x = finite(item.transform[4]);
    const y = finite(item.transform[5]);
    const height = Math.max(1, Math.abs(finite(item.height) || finite(item.transform[3]) || 12));
    const width = Math.max(0, finite(item.width));
    const startsNewLine = current && Math.abs(current.y - y) > Math.max(2, Math.max(current.height, height) * 0.55);
    if (startsNewLine && current) {
      lines.push(current);
      current = null;
    }

    if (!current) {
      current = { text, x, y, height, endX: x + width };
    } else {
      const gap = x - current.endX;
      current.text += tokenSeparator(current.text, text, gap, height) + text;
      current.height = Math.max(current.height, height);
      current.endX = Math.max(current.endX, x + width);
    }

    if (item.hasEOL && current) {
      lines.push(current);
      current = null;
    }
  });
  if (current) lines.push(current);
  return lines;
}

function reflowParagraphs(lines: ReadingLine[]): string[] {
  if (lines.length === 0) return [];

  // PDF 行距独立于字号，因此估计页面常规基线间距，而不是把每行都拆成独立段落。
  // PDF line spacing is independent of font size (e.g. 12pt text on 28pt
  // baselines). Learn the page's regular spacing instead of splitting each line.
  const gaps = lines.slice(1).flatMap((line, index) => {
    const previous = lines[index];
    const gap = Math.abs(previous.y - line.y);
    const sameScale = Math.max(previous.height, line.height) / Math.max(1, Math.min(previous.height, line.height)) <= 1.35;
    return sameScale && gap > Math.max(previous.height, line.height) * 0.55 ? [gap] : [];
  }).sort((a, b) => a - b);
  const regularGap = gaps.length >= 3 ? gaps[Math.floor((gaps.length - 1) / 2)] : 0;
  const paragraphs: string[] = [];
  let paragraph = lines[0].text;
  for (let index = 1; index < lines.length; index += 1) {
    const previous = lines[index - 1];
    const line = lines[index];
    const referenceHeight = Math.max(previous.height, line.height);
    const verticalGap = Math.abs(previous.y - line.y);
    const fontScaleChanged = Math.max(previous.height, line.height) / Math.max(1, Math.min(previous.height, line.height)) > 1.35;
    const visiblyIndented = line.x - previous.x > referenceHeight * 1.15;
    const startsFootnote = Boolean(parseFootnote(line.text));
    const startsListItem = /^(?:\d+[.)、]|[（(]\d+[)）]|[•●▪-]\s)/u.test(line.text);
    const startsFootnoteSection = line.text.replace(/\s/gu, "") === "注释";
    const startsParagraph = startsFootnote || startsFootnoteSection || startsListItem || fontScaleChanged || visiblyIndented || verticalGap > Math.max(referenceHeight * 1.65, regularGap * 1.25);

    if (startsParagraph) {
      paragraphs.push(paragraph.trim());
      paragraph = line.text;
    } else {
      paragraph += lineSeparator(paragraph, line.text) + line.text;
    }
  }
  paragraphs.push(paragraph.trim());
  return paragraphs.filter(Boolean);
}

function readingBlockFromParagraph(text: string): PdfReadingBlock {
  if (isNotesSectionHeading(text)) return { kind: "heading", text: text.trim(), notesSection: true };
  if (isBibliographySectionHeading(text)) return { kind: "heading", text: text.trim(), bibliographySection: true };
  return parseFootnote(text) ?? { kind: "paragraph", text };
}

function isNotesSectionHeading(value: string) {
  return /^(?:注释|注解|注|notes?)$/iu.test(value.replace(/[\s：:。]+/gu, "").toLocaleLowerCase());
}

function isBibliographySectionHeading(value: string) {
  return /^(?:参考文献|参考资料|引用文献|bibliography|references)$/iu.test(value.replace(/[\s：:。]+/gu, "").toLocaleLowerCase());
}

function parseFootnote(value: string): Extract<PdfReadingBlock, { kind: "footnote" }> | null {
  const match = value.trim().match(/^(\*|\[\d+\]|［\d+］|〔\d+〕|\(\d+\)|（\d+）)\s*(.+)$/u);
  if (!match?.[1] || !match[2]) return null;
  return { kind: "footnote", marker: normalizeFootnoteMarker(match[1]), text: match[2].trim() };
}

export function splitPdfInlineFootnoteReferences(value: string): PdfInlineTextPart[] {
  const parts: PdfInlineTextPart[] = [];
  let cursor = 0;
  const pattern = /(\*|\[\d+\]|［\d+］|〔\d+〕|\(\d+\)|（\d+）)/gu;
  for (const match of value.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > cursor) parts.push({ kind: "text", text: value.slice(cursor, index) });
    parts.push({ kind: "footnote-reference", marker: normalizeFootnoteMarker(match[0]) });
    cursor = index + match[0].length;
  }
  if (cursor < value.length) parts.push({ kind: "text", text: value.slice(cursor) });
  return parts.length > 0 ? parts : [{ kind: "text", text: value }];
}

function normalizeFootnoteMarker(value: string) {
  const number = value.match(/\d+/u)?.[0];
  return number ? `[${number}]` : value;
}

function isTableOfContents(lines: ReadingLine[]) {
  const hasContentsHeading = lines.some((line) => line.text.replace(/\s/gu, "") === "目录");
  const leaderLines = lines.filter((line) => parseTableOfContentsEntry(line.text)).length;
  return hasContentsHeading || leaderLines >= 3;
}

function tableOfContentsBlocks(lines: ReadingLine[]): PdfReadingBlock[] {
  const contentLines = lines.filter((line) => line.text.replace(/\s/gu, "") !== "目录");
  const leftEdge = Math.min(...contentLines.map((line) => line.x));
  const sortedHeights = contentLines.map((line) => line.height).sort((left, right) => left - right);
  const medianHeight = sortedHeights[Math.floor(sortedHeights.length / 2)] ?? 1;
  const blocks: PdfReadingBlock[] = [];
  let pending: string[] = [];

  const flushPending = () => {
    const text = pending.join("").trim();
    if (text) blocks.push({ kind: "paragraph", text });
    pending = [];
  };

  lines.forEach((line) => {
    if (line.text.replace(/\s/gu, "") === "目录") {
      flushPending();
      blocks.push({ kind: "heading", text: "目录" });
      return;
    }

    const directEntry = parseTableOfContentsEntry(line.text);
    if (directEntry && pending.length === 0) {
      blocks.push(directEntry);
      return;
    }

    const centeredSection = pending.length === 0
      && line.x > leftEdge + line.height * 2
      && line.height >= medianHeight;
    if (centeredSection) {
      blocks.push({ kind: "heading", text: line.text });
      return;
    }

    pending.push(line.text);
    const wrappedEntry = parseTableOfContentsEntry(pending.join(""));
    if (wrappedEntry) {
      blocks.push(wrappedEntry);
      pending = [];
    }
  });
  flushPending();
  return blocks;
}

function parseTableOfContentsEntry(value: string): PdfReadingBlock | null {
  const match = value.trim().match(/^(.*?)[.…·]{3,}\s*(\d+(?:\s*[—–-]\s*\d+)?)$/u);
  if (!match?.[1] || !match[2]) return null;
  return {
    kind: "toc-entry",
    text: match[1].trim(),
    pageLabel: match[2].replace(/\s/gu, ""),
  };
}

function isTextItem(value: unknown): value is PdfTextItemLike {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PdfTextItemLike>;
  return typeof candidate.str === "string" && Array.isArray(candidate.transform) && candidate.transform.length >= 6;
}

function normalizeText(value: string) {
  return value.replace(/\s+/gu, " ").trim();
}

function tokenSeparator(previous: string, next: string, gap: number, height: number) {
  if (!previous || !next || /\s$/u.test(previous) || /^\s/u.test(next)) return "";
  const latinBoundary = /[A-Za-z0-9)]$/u.test(previous) && /^[A-Za-z0-9(]/u.test(next);
  return latinBoundary || gap > height * 0.42 ? " " : "";
}

function lineSeparator(previous: string, next: string) {
  return /[A-Za-z0-9,;:)]$/u.test(previous) && /^[A-Za-z0-9(]/u.test(next) ? " " : "";
}

function finite(value: number | undefined) {
  return Number.isFinite(value) ? Number(value) : 0;
}
