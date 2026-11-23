import type { PDFDocumentProxy } from "pdfjs-dist";
import { pdfNavigation, pdfPrintedTocNavigation } from "./pdf-navigation";

function documentWith(outline: unknown) {
  return { numPages: 500, getOutline: async () => outline, getDestination: async () => { throw new Error("broken destination"); } } as unknown as PDFDocumentProxy;
}
describe("PDF source navigation", () => {
  it("preserves source numeric titles and their destinations", async () => {
    const items = await pdfNavigation(documentWith([{ title: "目录", dest: [5] }, ...Array.from({ length: 340 }, (_, i) => ({ title: String(i + 1), dest: [i + 7] }))]));
    expect(items[0].label).toBe("目录");
    expect(items[1]).toMatchObject({ label: "1", locator: "pdf:page=8" });
    expect(items[340]).toMatchObject({ label: "340", locator: "pdf:page=347" });
  });
  it("returns no generated entries when the source has no outline", async () => {
    expect(await pdfNavigation(documentWith(null))).toEqual([]);
  });
  it("filters placeholder bookmarks that do not describe the source PDF", async () => {
    expect(await pdfNavigation(documentWith([
      { title: "未标题", dest: [15] },
      { title: "空白页面", dest: [42] },
      { title: "第一章", dest: [52] },
    ]))).toEqual([{ label: "第一章", href: "pdf:page=53", locator: "pdf:page=53", depth: 0 }]);
  });
  it("retains numeric chapter titles when destinations are not consecutive pages", async () => {
    const items = await pdfNavigation(documentWith(Array.from({ length: 12 }, (_, i) => ({ title: String(i + 1), dest: [i * 10] }))));
    expect(items.map(item => item.label)).toEqual(Array.from({ length: 12 }, (_, i) => String(i + 1)));
  });
  it("keeps valid siblings and a parent with no destination when one destination is malformed", async () => {
    const items = await pdfNavigation(documentWith([{ title: "broken", dest: "missing" }, { title: "分部", items: [{ title: "章节", dest: [10] }] }, { title: "后记", dest: [40] }]));
    expect(items).toEqual([
      { label: "分部", href: "pdf:page=11", locator: "pdf:page=11", depth: 0 },
      { label: "章节", href: "pdf:page=11", locator: "pdf:page=11", depth: 1 },
      { label: "后记", href: "pdf:page=41", locator: "pdf:page=41", depth: 0 },
    ]);
  });
  it("maps printed contents to PDF pages using several matching body titles", () => {
    const pages = new Map([
      [7, [
        { kind: "toc-entry" as const, text: "在中国共产党全国代表会议上的讲话（一九五五年三月）", pageLabel: "143—156" },
        { kind: "toc-entry" as const, text: "关于正确处理人民内部矛盾的问题（一九五七年二月）", pageLabel: "196—202" },
        { kind: "toc-entry" as const, text: "尚未匹配的章节", pageLabel: "250—253" },
      ]],
      [156, [{ kind: "paragraph" as const, text: "在中国共产党全国代表会议上的讲话" }]],
      [209, [{ kind: "paragraph" as const, text: "关于正确处理人民内部矛盾的问题" }]],
    ]);

    expect(pdfPrintedTocNavigation(pages, 514)).toEqual([
      { label: "在中国共产党全国代表会议上的讲话（一九五五年三月）", href: "pdf:page=156", locator: "pdf:page=156", depth: 0 },
      { label: "关于正确处理人民内部矛盾的问题（一九五七年二月）", href: "pdf:page=209", locator: "pdf:page=209", depth: 0 },
      { label: "尚未匹配的章节", href: "pdf:page=263", locator: "pdf:page=263", depth: 0 },
    ]);
  });
  it("does not guess an offset without multiple body-title matches", () => {
    const pages = new Map([
      [7, [{ kind: "toc-entry" as const, text: "第一章标题", pageLabel: "10" }]],
      [20, [{ kind: "paragraph" as const, text: "第一章标题" }]],
    ]);
    expect(pdfPrintedTocNavigation(pages, 50)).toEqual([]);
  });
});
