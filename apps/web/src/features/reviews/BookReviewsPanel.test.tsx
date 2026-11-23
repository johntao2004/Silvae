import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TestProviders } from "../../test/TestProviders";
import { BookReviewsPanel } from "./BookReviewsPanel";
import { readingPosts, type ReadingPost } from "../notes/posts-api";

vi.mock("../content/MarkdownEditor", async () => {
  const React = await import("react");
  return { MarkdownEditor: ({ value, onChange, label, disabled }: { value: string; onChange: (value: string) => void; label: string; disabled?: boolean }) => React.createElement("textarea", { "aria-label": label, value, disabled, onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => onChange(event.target.value) }) };
});

const saved: ReadingPost = {
  id: "review-1",
  kind: "BOOK",
  sourceId: "book-1",
  sourceTitle: "书籍",
  userId: "owner",
  authorName: "作者",
  title: "重新理解阅读",
  markdown: "## 原文\n\n**思考**",
  excerpt: "原文 思考",
  visibility: "PRIVATE",
  revision: 3,
  createdAt: "2026-10-22T00:00:00Z",
  updatedAt: "2026-10-22T00:00:00Z",
};

function renderPanel() { return render(<TestProviders><BookReviewsPanel bookId="book-1" /></TestProviders>); }

describe("BookReviewsPanel", () => {
  beforeEach(() => {
    sessionStorage.setItem("humite-demo-session", JSON.stringify({ id: "owner", username: "owner", displayName: "作者", role: "OWNER", mustChangePassword: false }));
    vi.spyOn(readingPosts, "listBySource").mockResolvedValue({ items: [], nextCursor: null });
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); sessionStorage.clear(); });

  it("creates a separate private long-form review, invalidates post queries, and renders Markdown", async () => {
    const invalidate = vi.spyOn(QueryClient.prototype, "invalidateQueries");
    const create = vi.spyOn(readingPosts, "create").mockImplementation(async draft => {
      const result: ReadingPost = { ...saved, ...draft, excerpt: draft.markdown.slice(0, 240) };
      vi.mocked(readingPosts.listBySource).mockResolvedValue({ items: [result], nextCursor: null });
      return result;
    });
    renderPanel();
    await screen.findByText("暂无随笔");
    expect(readingPosts.listBySource).toHaveBeenCalledWith("BOOK", "book-1");
    fireEvent.click(screen.getByRole("button", { name: "写随笔" }));
    const drawer = await screen.findByRole("dialog", { name: "写随笔" });
    fireEvent.change(within(drawer).getByRole("textbox", { name: "标题" }), { target: { value: "读后的思考" } });
    const markdown = "## 我的观点\n\n**重点**\n\n- 观察\n\n| 名称 | 内容 |\n| --- | --- |\n| 思考 | 重新理解 |\n\n```js\nconst read = true;\n```";
    fireEvent.change(within(drawer).getByRole("textbox", { name: "随笔正文" }), { target: { value: markdown } });
    expect(within(drawer).queryByRole("button", { name: "预览" })).not.toBeInTheDocument();
    expect(within(drawer).getByRole("textbox", { name: "随笔正文" })).toHaveValue(markdown);
    fireEvent.click(within(drawer).getByRole("button", { name: "保存随笔" }));
    await waitFor(() => expect(create).toHaveBeenCalledWith({
      kind: "BOOK",
      sourceId: "book-1",
      title: "读后的思考",
      markdown,
      visibility: "PRIVATE",
    }));
    expect(await screen.findByRole("heading", { name: "读后的思考" })).toBeInTheDocument();
    expect(await screen.findByText("已保存")).toBeInTheDocument();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["reading-posts", "BOOK", "book-1"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["reading-posts"] });
  });

  it("only offers editing for the author's reviews and sends the original revision", async () => {
    vi.mocked(readingPosts.listBySource).mockResolvedValue({
      items: [saved, { ...saved, id: "other", userId: "member", title: "其他人的共享随笔", visibility: "LIBRARY" }],
      nextCursor: null,
    });
    const update = vi.spyOn(readingPosts, "update").mockResolvedValue({ ...saved, title: "修订", revision: 4 });
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "编辑随笔：重新理解阅读" }));
    expect(screen.queryByRole("button", { name: "编辑随笔：其他人的共享随笔" })).not.toBeInTheDocument();
    const drawer = await screen.findByRole("dialog", { name: "编辑随笔" });
    expect(within(drawer).getByRole("textbox", { name: "随笔正文" })).toHaveValue(saved.markdown);
    fireEvent.change(within(drawer).getByRole("textbox", { name: "标题" }), { target: { value: "修订" } });
    fireEvent.click(within(drawer).getByRole("button", { name: "保存随笔" }));
    await waitFor(() => expect(update).toHaveBeenCalledWith(saved, {
      kind: "BOOK",
      sourceId: "book-1",
      title: "修订",
      markdown: saved.markdown ?? "",
      visibility: "PRIVATE",
    }));
  });

  it("keeps the draft open after a revision conflict", async () => {
    vi.mocked(readingPosts.listBySource).mockResolvedValue({ items: [saved], nextCursor: null });
    const update = vi.spyOn(readingPosts, "update").mockRejectedValue(new Error("随笔已被更新，请刷新后重试。"));
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "编辑随笔：重新理解阅读" }));
    const drawer = await screen.findByRole("dialog", { name: "编辑随笔" });
    fireEvent.change(within(drawer).getByRole("textbox", { name: "随笔正文" }), { target: { value: "未保存的修改" } });
    fireEvent.click(within(drawer).getByRole("button", { name: "保存随笔" }));
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(await screen.findByText("随笔已被更新，请刷新后重试。")).toBeInTheDocument();
    expect(within(drawer).getByRole("textbox", { name: "随笔正文" })).toHaveValue("未保存的修改");
  });

  it("does not request or render reviews for anonymous users", () => {
    sessionStorage.removeItem("humite-demo-session");
    renderPanel();
    expect(readingPosts.listBySource).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: "随笔" })).not.toBeInTheDocument();
  });

  it("supports creating, listing by source, and updating book posts in demo mode", async () => {
    vi.restoreAllMocks();
    render(<TestProviders><BookReviewsPanel bookId="book-demo-1" bookTitle="演示书目" /></TestProviders>);
    await screen.findByText("暂无随笔");

    fireEvent.click(screen.getByRole("button", { name: "写随笔" }));
    const createDrawer = await screen.findByRole("dialog", { name: "写随笔" });
    fireEvent.change(within(createDrawer).getByRole("textbox", { name: "标题" }), { target: { value: "演示随笔" } });
    fireEvent.change(within(createDrawer).getByRole("textbox", { name: "随笔正文" }), { target: { value: "第一版内容" } });
    fireEvent.click(within(createDrawer).getByRole("button", { name: "保存随笔" }));
    expect(await screen.findByRole("heading", { name: "演示随笔" })).toBeInTheDocument();

    fireEvent.click(await screen.findByRole("button", { name: "编辑随笔：演示随笔" }));
    const editDrawer = await screen.findByRole("dialog", { name: "编辑随笔" });
    fireEvent.change(within(editDrawer).getByRole("textbox", { name: "标题" }), { target: { value: "修订演示随笔" } });
    fireEvent.click(within(editDrawer).getByRole("button", { name: "保存随笔" }));
    expect(await screen.findByRole("heading", { name: "修订演示随笔" })).toBeInTheDocument();

    const listed = await readingPosts.listBySource("BOOK", "book-demo-1");
    expect(listed.items).toHaveLength(1);
    expect(listed.items[0].revision).toBe(2);
    await expect(readingPosts.update({ ...listed.items[0], revision: 1 }, {
      kind: "BOOK",
      sourceId: "book-demo-1",
      title: "过期修改",
      markdown: "冲突内容",
      visibility: "PRIVATE",
    })).rejects.toThrow("随笔已在其他页面更新");
  });
});
