// 覆盖中英文断行、缩进、列表与空白处理，保留真实段落结构而非机械拼接每行。
// Covers Chinese/Latin lines, indentation, lists and whitespace while preserving actual paragraph structure.
import { describe, expect, it } from "vitest";
import { pdfPageBoundarySeparator, pdfTextToParagraphs, pdfTextToReadingBlocks, shouldJoinPdfPageBoundaryParagraphs, splitPdfInlineFootnoteReferences } from "./pdf-reading-text";

const item = (str: string, x: number, y: number, options: { width?: number; height?: number; hasEOL?: boolean } = {}) => ({
  str,
  transform: [1, 0, 0, options.height ?? 12, x, y],
  width: options.width ?? str.length * 8,
  height: options.height ?? 12,
  hasEOL: options.hasEOL ?? false,
});

describe("pdfTextToParagraphs", () => {
  it("reflows consecutive Chinese PDF lines into a reading paragraph", () => {
    const paragraphs = pdfTextToParagraphs([
      item("黄昏从山脊落下来时，", 48, 720, { hasEOL: true }),
      item("河面先暗了一层。", 36, 704, { hasEOL: true }),
    ]);

    expect(paragraphs).toEqual(["黄昏从山脊落下来时，河面先暗了一层。"]);
  });

  it("joins widely spaced PDF baselines while retaining real paragraph indentation", () => {
    expect(pdfTextToParagraphs([
      item("第一段的开头，", 72.525, 743.22, { hasEOL: true }),
      item("这里仍是同一段的正文，", 42.525, 715.2, { hasEOL: true }),
      item("这里也是连续正文，", 42.525, 687.2, { hasEOL: true }),
      item("直到这一句结束。", 42.525, 659.2, { hasEOL: true }),
      item("第二段从这里开始。", 70.525, 620.68, { hasEOL: true }),
    ])).toEqual(["第一段的开头，这里仍是同一段的正文，这里也是连续正文，直到这一句结束。", "第二段从这里开始。"]);
  });

  it("retains a paragraph break with extra spacing and no indentation", () => {
    expect(pdfTextToParagraphs([
      item("第一行，", 42, 743, { hasEOL: true }),
      item("第二行，", 42, 715, { hasEOL: true }),
      item("第三行，", 42, 687, { hasEOL: true }),
      item("第四行。", 42, 659, { hasEOL: true }),
      item("另一段。", 42, 614, { hasEOL: true }),
    ])).toEqual(["第一行，第二行，第三行，第四行。", "另一段。"]);
  });

  it("keeps numbered items apart with regular wide line spacing", () => {
    expect(pdfTextToParagraphs([
      item("1. 第一项", 42, 743, { hasEOL: true }),
      item("第一项的续行。", 42, 715, { hasEOL: true }),
      item("2. 第二项", 42, 687, { hasEOL: true }),
      item("第二项的续行。", 42, 659, { hasEOL: true }),
    ])).toEqual(["1. 第一项第一项的续行。", "2. 第二项第二项的续行。"]);
  });

  it("keeps visibly indented lines as separate paragraphs", () => {
    const paragraphs = pdfTextToParagraphs([
      item("第一段结束。", 36, 720, { hasEOL: true }),
      item("第二段开始。", 56, 704, { hasEOL: true }),
    ]);

    expect(paragraphs).toEqual(["第一段结束。", "第二段开始。"]);
  });

  it("preserves spaces between split Latin words and ignores non-text items", () => {
    const paragraphs = pdfTextToParagraphs([
      item("HELLO", 36, 720, { width: 35 }),
      { type: "beginMarkedContent", id: "text" },
      item("WORLD", 76, 720, { width: 66, hasEOL: true }),
    ]);

    expect(paragraphs).toEqual(["HELLO WORLD"]);
  });

  it("returns no fabricated content for image-only pages", () => {
    expect(pdfTextToParagraphs([{ type: "beginMarkedContent" }])).toEqual([]);
  });

  it("structures table-of-contents entries instead of joining them into prose", () => {
    const blocks = pdfTextToReadingBlocks([
      item("目", 236, 615, { width: 26, height: 26 }),
      item("录", 340, 615, { width: 26, height: 26, hasEOL: true }),
      item("社会主义革命和社会主义建设时期（一）", 150, 556, { height: 18, hasEOL: true }),
      item("中国人民站起来了（一九四九年九月二十一日）…………………3—7", 90, 505, { height: 16, hasEOL: true }),
      item("永远保持艰苦奋斗的作风（一九四九年十月", 90, 436, { height: 16, hasEOL: true }),
      item("二十六日）……………………………12", 108, 413, { height: 12, hasEOL: true }),
    ]);

    expect(blocks).toEqual([
      { kind: "heading", text: "目录" },
      { kind: "heading", text: "社会主义革命和社会主义建设时期（一）" },
      { kind: "toc-entry", text: "中国人民站起来了（一九四九年九月二十一日）", pageLabel: "3—7" },
      { kind: "toc-entry", text: "永远保持艰苦奋斗的作风（一九四九年十月二十六日）", pageLabel: "12" },
    ]);
  });

  it("keeps superscript references inline and separates page footnotes", () => {
    const blocks = pdfTextToReadingBlocks([
      item("我们曾和蒋介石国民党一道开过一次政治协商会议", 90, 161, { width: 352, height: 16 }),
      item("[1]", 442, 169, { width: 12, height: 8 }),
      item("。那次", 454, 161, { width: 40, height: 16, hasEOL: true }),
      item("* 这是毛泽东同志在中国人民政治协商会议第一届全体会议上", 125, 136, { height: 14, hasEOL: true }),
      item("的开幕词。", 139, 113, { height: 14 }),
    ]);

    expect(blocks).toEqual([
      { kind: "paragraph", text: "我们曾和蒋介石国民党一道开过一次政治协商会议[1]。那次" },
      { kind: "footnote", marker: "*", text: "这是毛泽东同志在中国人民政治协商会议第一届全体会议上的开幕词。" },
    ]);
  });

  it("recognizes numbered notes in a notes section", () => {
    const blocks = pdfTextToReadingBlocks([
      item("注", 122, 561, { width: 12, height: 12 }),
      item("释", 158, 561, { width: 12, height: 12, hasEOL: true }),
      item("[1]参看本书第四卷《以自卫战争粉碎蒋介石的进攻》[2]。", 122, 538, { height: 12, hasEOL: true }),
    ]);

    expect(blocks).toEqual([
      { kind: "heading", text: "注 释", notesSection: true },
      { kind: "footnote", marker: "[1]", text: "参看本书第四卷《以自卫战争粉碎蒋介石的进攻》[2]。" },
    ]);
  });

  it("does not treat a bibliography section as movable footnotes", () => {
    const blocks = pdfTextToReadingBlocks([
      item("参考文献", 180, 561, { width: 80, height: 18, hasEOL: true }),
      item("[1]毛泽东选集第五卷，北京：人民出版社，1977年。", 90, 538, { height: 12, hasEOL: true }),
    ]);

    expect(blocks).toEqual([
      { kind: "heading", text: "参考文献", bibliographySection: true },
      { kind: "footnote", marker: "[1]", text: "毛泽东选集第五卷，北京：人民出版社，1977年。" },
    ]);
  });

  it("separates a trailing 注释 heading from the preceding sentence", () => {
    const blocks = pdfTextToReadingBlocks([
      item("庆贺中国人民政治协商会议的成功！", 90, 500, { width: 300, height: 16 }),
      item("注", 390, 500, { width: 12, height: 12 }),
      item("释", 402, 500, { width: 12, height: 12, hasEOL: true }),
      item("* 这是对应的脚注。", 90, 470, { height: 12, hasEOL: true }),
    ]);

    expect(blocks).toEqual([
      { kind: "paragraph", text: "庆贺中国人民政治协商会议的成功！" },
      { kind: "heading", text: "注释", notesSection: true },
      { kind: "footnote", marker: "*", text: "这是对应的脚注。" },
    ]);
  });

  it("preserves an enlarged chapter title and its superscript as a page boundary", () => {
    const blocks = pdfTextToReadingBlocks([
      item("中国人民大团结万岁", 180.78, 569.36, { width: 234.84, height: 25.98 }),
      item("*", 415.62, 582.38, { width: 6.51, height: 13.02 }),
      item("（一九四九年九月三十日）", 205.44, 533.96, { width: 192.08, height: 16.02 }),
      item("全国同胞们：中国人民政治协商会议业已胜利地完成", 122.58, 482.65, { width: 390.49, height: 16.02, hasEOL: true }),
      item("了自己的任务。", 90, 459.61, { width: 112.05, height: 16.02, hasEOL: true }),
    ]);

    expect(blocks[0]).toEqual({ kind: "heading", text: "中国人民大团结万岁*", chapterStart: true });
    expect(blocks.slice(1).every(block => block.kind === "paragraph")).toBe(true);
    expect(blocks.map(block => block.text).join("")).toContain("全国同胞们：中国人民政治协商会议业已胜利地完成了自己的任务。");
  });

  it("keeps a wrapped chapter title together after preceding body text", () => {
    const blocks = pdfTextToReadingBlocks([
      item("前一篇的末尾仍然保留在自己的正文中，不与下一篇标题合并。", 90, 720, { width: 423, height: 16, hasEOL: true }),
      item("为争取国家财政经济状况的", 132, 569, { width: 338, height: 26, hasEOL: true }),
      item("基本好转而斗争*", 197, 530, { width: 208, height: 26, hasEOL: true }),
      item("这里是新一篇的正文，原文中的两行标题只需要一个分页起点。", 90, 480, { width: 423, height: 16, hasEOL: true }),
    ]);

    expect(blocks).toEqual([
      { kind: "paragraph", text: "前一篇的末尾仍然保留在自己的正文中，不与下一篇标题合并。" },
      { kind: "heading", text: "为争取国家财政经济状况的基本好转而斗争*", chapterStart: true },
      { kind: "paragraph", text: "这里是新一篇的正文，原文中的两行标题只需要一个分页起点。" },
    ]);
  });

  it("does not force chapter breaks for smaller section titles, notes or ordinary centered text", () => {
    const blocks = pdfTextToReadingBlocks([
      item("一 篇内小节", 240, 720, { width: 123, height: 22, hasEOL: true }),
      item("这是篇内小节的正文，应该保持连续阅读而不是再开始新的一页。", 90, 680, { width: 423, height: 16, hasEOL: true }),
      item("这行正文继续原来的内容，字号也与上一行相同。", 90, 657, { width: 423, height: 16, hasEOL: true }),
      item("居中的普通正文", 245, 634, { width: 112, height: 16, hasEOL: true }),
      item("注释", 122, 590, { width: 48, height: 12, hasEOL: true }),
      item("[1]这是注释，仍然附在当前篇末尾。", 122, 567, { height: 12, hasEOL: true }),
    ]);

    expect(blocks.some(block => block.kind === "heading" && block.chapterStart)).toBe(false);
    expect(blocks).toContainEqual({ kind: "heading", text: "注释", notesSection: true });
  });

  it("does not mistake a section number for a chapter on a page dominated by smaller notes", () => {
    const blocks = pdfTextToReadingBlocks([
      item("二十", 275, 720, { width: 52, height: 26, hasEOL: true }),
      item("这是篇内的一段正文。", 90, 680, { width: 423, height: 16, hasEOL: true }),
      item("[1]这一页的大部分文字属于篇内附注，较小的注释字号不应让小节编号成为新篇章。", 90, 500, { width: 423, height: 12, hasEOL: true }),
    ]);

    expect(blocks.some(block => block.kind === "heading" && block.chapterStart)).toBe(false);
  });

  it("splits common Chinese footnote markers into clickable references", () => {
    expect(splitPdfInlineFootnoteReferences("标题*与正文［1］、〔2〕")).toEqual([
      { kind: "text", text: "标题" },
      { kind: "footnote-reference", marker: "*" },
      { kind: "text", text: "与正文" },
      { kind: "footnote-reference", marker: "[1]" },
      { kind: "text", text: "、" },
      { kind: "footnote-reference", marker: "[2]" },
    ]);
  });
});

describe("PDF page-boundary paragraph joining", () => {
  it("joins unfinished paragraph fragments while retaining punctuation and title boundaries", () => {
    expect(shouldJoinPdfPageBoundaryParagraphs(
      { kind: "paragraph", text: "诸位代表先生们：我们有一个共同的感觉，这就是我们" },
      { kind: "paragraph", text: "的工作将写在人类的历史上。" },
    )).toBe(true);
    expect(shouldJoinPdfPageBoundaryParagraphs(
      { kind: "paragraph", text: "上一句已经结束。" },
      { kind: "paragraph", text: "下一段另起。" },
    )).toBe(false);
    expect(shouldJoinPdfPageBoundaryParagraphs(
      { kind: "paragraph", text: "第一章" },
      { kind: "paragraph", text: "接下来是正文内容。" },
    )).toBe(false);
    expect(shouldJoinPdfPageBoundaryParagraphs(
      { kind: "paragraph", text: "前文尚未结束" },
      { kind: "paragraph", text: "一、下一节标题" },
    )).toBe(false);
    expect(shouldJoinPdfPageBoundaryParagraphs(
      { kind: "heading", text: "注释" },
      { kind: "paragraph", text: "正文内容继续。" },
    )).toBe(false);
  });

  it("adds a separator only when adjacent source fragments split an English word boundary", () => {
    expect(pdfPageBoundarySeparator("the long-", "term continues")).toBe("");
    expect(pdfPageBoundarySeparator("history", "continues")).toBe(" ");
    expect(pdfPageBoundarySeparator("这是", "同一句话")).toBe("");
  });
});
