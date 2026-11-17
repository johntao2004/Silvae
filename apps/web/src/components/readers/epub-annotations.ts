// 把批注样式应用到 EPUB 文档范围，清理旧标记后重建，避免叠加重复包装。
// Applies annotation styles to EPUB ranges, rebuilding after old markers are cleared to avoid repeated wrappers.
import { annotationColorHex, readerHighlightStyle, type AnnotationTextTheme } from "../../domain/annotation-colors";
import type { Annotation } from "../../domain/types";
import { tokens } from "../../theme/tokens";

export const EPUB_INLINE_ANNOTATION_CLASS = "page-annotation-inline";

function isReadableTextNode(node: Text) {
  const parent = node.parentElement;
  return Boolean(node.data && parent && !parent.closest("script, style, noscript"));
}

interface EpubTextRun {
  node: Text;
  textStart: number;
  normStart: number;
  length: number;
}

export interface EpubTextIndex {
  normalizedText: string;
  runs: EpubTextRun[];
}

export function createEpubTextIndex(document: Document, searchRoot: Node = document.body): EpubTextIndex {
  const nodeFilter = document.defaultView?.NodeFilter ?? NodeFilter;
  const walker = document.createTreeWalker(searchRoot, nodeFilter.SHOW_TEXT);
  const chunks: string[] = [];
  const runs: EpubTextRun[] = [];
  let normOffset = 0;
  let current = walker.nextNode();
  while (current) {
    const node = current as Text;
    if (isReadableTextNode(node)) {
      const data = node.data;
      let runStart = -1;
      for (let offset = 0; offset < data.length; offset += 1) {
        if (!/\s/u.test(data[offset])) {
          if (runStart < 0) runStart = offset;
        } else if (runStart >= 0) {
          const chunk = data.slice(runStart, offset);
          chunks.push(chunk);
          runs.push({ node, textStart: runStart, normStart: normOffset, length: chunk.length });
          normOffset += chunk.length;
          runStart = -1;
        }
      }
      if (runStart >= 0) {
        const chunk = data.slice(runStart);
        chunks.push(chunk);
        runs.push({ node, textStart: runStart, normStart: normOffset, length: chunk.length });
        normOffset += chunk.length;
      }
    }
    current = walker.nextNode();
  }
  return { normalizedText: chunks.join(""), runs };
}

function locateRun(runs: EpubTextRun[], normPosition: number): { node: Text; offset: number } | undefined {
  let low = 0;
  let high = runs.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const run = runs[mid]!;
    if (normPosition < run.normStart) high = mid - 1;
    else if (normPosition >= run.normStart + run.length) low = mid + 1;
    else return { node: run.node, offset: run.textStart + (normPosition - run.normStart) };
  }
  return undefined;
}

export function findEpubTextRange(
  document: Document,
  quote: string,
  searchRoot: Node = document.body,
  cachedIndex?: EpubTextIndex,
) {
  const root = searchRoot;
  const normalizedQuote = quote.replace(/\s/gu, "");
  if (!root || !normalizedQuote) return undefined;

  const index = cachedIndex ?? createEpubTextIndex(document, root);
  const start = index.normalizedText.indexOf(normalizedQuote);
  if (start < 0) return undefined;
  const first = locateRun(index.runs, start);
  const last = locateRun(index.runs, start + normalizedQuote.length - 1);
  if (!first || !last) return undefined;

  const range = document.createRange();
  range.setStart(first.node, first.offset);
  range.setEnd(last.node, last.offset + 1);
  return range;
}

export function isEpubArticleParagraphLocator(locator: string) {
  return /^(?:article\.xhtml#)?p-\d+$/u.test(locator);
}

export function findEpubArticleParagraphRange(document: Document, locator: string, quote: string) {
  const match = /^(?:article\.xhtml#)?(p-\d+)$/u.exec(locator);
  const paragraph = match?.[1] ? document.getElementById(match[1]) : null;
  if (!paragraph || !quote) return undefined;
  return findEpubTextRange(document, quote, paragraph);
}

export function clearEpubInlineAnnotations(document: Document) {
  document.querySelectorAll<HTMLElement>(`.${EPUB_INLINE_ANNOTATION_CLASS}`).forEach((wrapper) => {
    const parent = wrapper.parentNode;
    if (!parent) return;
    while (wrapper.firstChild) parent.insertBefore(wrapper.firstChild, wrapper);
    wrapper.remove();
  });
  document.body?.normalize();
}

export function applyEpubInlineAnnotation(range: Range, annotation: Annotation, theme: AnnotationTextTheme = {
  background: tokens.color.semantic.canvas,
  foreground: tokens.color.semantic.textPrimary,
}) {
  if (range.collapsed) return 0;
  const document = range.startContainer.ownerDocument;
  if (!document) return 0;
  const root = range.commonAncestorContainer.nodeType === Node.TEXT_NODE
    ? range.commonAncestorContainer.parentNode
    : range.commonAncestorContainer;
  if (!root) return 0;

  const nodeFilter = document.defaultView?.NodeFilter ?? NodeFilter;
  const walker = document.createTreeWalker(root, nodeFilter.SHOW_TEXT);
  const selected: Array<{ node: Text; start: number; end: number }> = [];
  let current = walker.nextNode();
  while (current) {
    const node = current as Text;
    if (isReadableTextNode(node) && range.intersectsNode(node)) {
      const start = node === range.startContainer ? range.startOffset : 0;
      const end = node === range.endContainer ? range.endOffset : node.data.length;
      if (end > start) selected.push({ node, start, end });
    }
    current = walker.nextNode();
  }

  selected.reverse().forEach(({ node, start, end }, index) => {
    const selectedText = node.splitText(start);
    selectedText.splitText(end - start);
    const wrapper = document.createElement("span");
    wrapper.className = EPUB_INLINE_ANNOTATION_CLASS;
    wrapper.dataset.annotationId = annotation.id;
    wrapper.dataset.annotationStyle = annotation.style;
    wrapper.dataset.highlightColor = annotation.color ?? "YELLOW";
    if (annotation.id) {
      wrapper.setAttribute("role", "button");
      wrapper.setAttribute("aria-label", "编辑划线或笔记");
      wrapper.tabIndex = index === selected.length - 1 ? 0 : -1;
      wrapper.style.cursor = "pointer";
    }
    wrapper.style.setProperty("color", "inherit", "important");
    wrapper.style.setProperty("box-decoration-break", "clone");
    wrapper.style.setProperty("-webkit-box-decoration-break", "clone");
    if (annotation.style === "HIGHLIGHT") {
      const highlight = readerHighlightStyle(annotation.color, theme);
      wrapper.style.setProperty("background-color", highlight.background, "important");
      wrapper.style.setProperty("color", highlight.color, "important");
    } else if (annotation.style === "BOLD") {
      wrapper.style.setProperty("font-weight", "700", "important");
    } else {
      const color = annotationColorHex(annotation.color);
      wrapper.style.setProperty("text-decoration-line", "underline", "important");
      wrapper.style.setProperty("text-decoration-color", color, "important");
      wrapper.style.setProperty("text-decoration-thickness", "3px", "important");
      wrapper.style.setProperty("text-underline-offset", "0.2em", "important");
      wrapper.style.setProperty("text-decoration-skip-ink", "none", "important");
    }
    selectedText.parentNode?.insertBefore(wrapper, selectedText);
    wrapper.append(selectedText);
  });

  return selected.length;
}
