// 验证气泡去重、重试入口、自动关闭与内联 Alert 语义展示。
// Checks notice deduplication, retry actions, automatic bubble dismissal and persistent inline Alert semantics.
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import ConfigProvider from "antd/es/config-provider";
import { afterEach, vi } from "vitest";
import { Alert } from "./feedback";
import { FeedbackBubble, FeedbackProvider } from "./notifications";

afterEach(() => {
  vi.useRealTimers();
});

describe("bubble feedback", () => {
  it("keeps notices outside the page and preserves retry actions", async () => {
    const retry = vi.fn();
    const { unmount } = render(<FeedbackProvider><main data-testid="page">
      <FeedbackBubble severity="error" action={<button onClick={retry}>重试</button>}>保存失败</FeedbackBubble>
    </main></FeedbackProvider>);
    expect(await screen.findByText("保存失败")).toBeInTheDocument();
    expect(within(screen.getByTestId("page")).queryByText("保存失败")).toBeNull();
    fireEvent.click(screen.getByText("重试"));
    expect(retry).toHaveBeenCalledOnce();
    unmount();
    await waitFor(() => expect(screen.queryByText("保存失败")).toBeNull());
  });

  it("updates an existing bubble instead of accumulating duplicates", async () => {
    const view = (text: string) => <FeedbackProvider><FeedbackBubble>{text}</FeedbackBubble></FeedbackProvider>;
    const { rerender } = render(view("第一条"));
    await screen.findByText("第一条");
    rerender(view("第二条"));
    await screen.findByText("第二条");
    expect(screen.queryByText("第一条")).toBeNull();
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });
});

describe("automatic dismissal", () => {
  it.each(["success", "info", "warning", "error"] as const)("dismisses %s bubbles after configured duration", async (severity) => {
    const onClose = vi.fn();
    // jsdom does not emit the CSS animation-end event used to remove notices.
    render(<ConfigProvider theme={{ token: { motion: false } }}><FeedbackProvider><FeedbackBubble severity={severity} duration={0.05} onClose={onClose}>操作提示</FeedbackBubble></FeedbackProvider></ConfigProvider>);
    expect(await screen.findByText("操作提示")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("操作提示")).toBeNull(), { timeout: 2000 });
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe("inline alert", () => {
  it("renders inline inside the page with alert semantics and persists without auto-dismissing", () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    render(<main data-testid="page"><Alert severity="error" onClose={onClose}>无法保存更改</Alert></main>);
    const alert = within(screen.getByTestId("page")).getByRole("alert");
    expect(alert).toHaveTextContent("无法保存更改");
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(within(screen.getByTestId("page")).getByRole("alert")).toHaveTextContent("无法保存更改");
    expect(onClose).not.toHaveBeenCalled();
  });
});
