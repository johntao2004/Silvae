import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "../api/client";
import type { ReaderFont } from "../domain/types";
import { TestProviders } from "../test/TestProviders";
import { ReaderFontsPage } from "./ReaderFontsPage";

const fontsFixture: ReaderFont[] = [
  {
    id: "source-han-sans-sc",
    displayName: "思源黑体",
    familyName: "Source Han Sans SC",
    kind: "SANS",
    source: "PRESET",
    status: "ENABLED",
    format: "WOFF2",
    licenseNote: "SIL Open Font License 1.1",
  },
  {
    id: "custom-serif",
    displayName: "霞鹜文楷",
    familyName: "LXGW WenKai",
    kind: "SERIF",
    source: "CUSTOM",
    status: "ENABLED",
    format: "TTF",
    contentUrl: "/api/v1/reader-fonts/custom-serif/content",
    licenseNote: "OFL 1.1",
  },
];

beforeEach(() => {
  sessionStorage.setItem("humite-demo-session", JSON.stringify({
    id: "admin", username: "admin", displayName: "管理员", role: "ADMIN", mustChangePassword: false,
  }));
});

afterEach(() => vi.restoreAllMocks());

it("renders minimalist font cards with only displayName and switch, stripping preview copy, chips and license notes", async () => {
  vi.spyOn(api, "listReaderFontsForAdmin").mockResolvedValue(fontsFixture);
  render(<TestProviders><ReaderFontsPage /></TestProviders>);

  const presetCard = await screen.findByTestId("reader-font-card-source-han-sans-sc");
  const customCard = screen.getByTestId("reader-font-card-custom-serif");

  expect(screen.getByRole("heading", { name: "上传自定义字体" }).closest(".bk-settings-card")).not.toBeNull();
  expect(screen.getByRole("heading", { name: "已安装字体" }).closest(".bk-settings-card")).not.toBeNull();
  expect(screen.getByLabelText("展示名称（可选）").closest(".bk-settings-field-grid")).not.toBeNull();
  expect(presetCard.closest(".bk-settings-stack")).not.toBeNull();
  expect(presetCard.closest(".bk-settings-toggle-list")).not.toBeNull();
  expect(presetCard).toHaveClass("bk-settings-toggle-row");

  expect(within(presetCard).getByRole("heading", { name: "思源黑体" })).toBeInTheDocument();
  expect(within(presetCard).getByRole("switch", { name: "思源黑体为预设字体，已启用" })).toBeDisabled();

  const customHeading = within(customCard).getByRole("heading", { name: "霞鹜文楷" });
  expect(customHeading).toBeInTheDocument();
  expect(getComputedStyle(customHeading.parentElement!).flexDirection).toBe("row");
  expect(within(customCard).getByRole("switch", { name: "停用霞鹜文楷" })).toBeEnabled();

  for (const card of [presetCard, customCard]) {
    expect(within(card).queryByText(/Humite阅读正文预览/)).not.toBeInTheDocument();
    expect(within(card).queryByText("衬线")).not.toBeInTheDocument();
    expect(within(card).queryByText("无衬线")).not.toBeInTheDocument();
    expect(within(card).queryByText("预设")).not.toBeInTheDocument();
    expect(within(card).queryByText("自定义")).not.toBeInTheDocument();
    expect(within(card).queryByText(/OFL|License/i)).not.toBeInTheDocument();
  }
});

it("toggles custom font status cleanly", async () => {
  vi.spyOn(api, "listReaderFontsForAdmin").mockResolvedValue(fontsFixture);
  const setStatus = vi.spyOn(api, "setReaderFontStatus").mockResolvedValue({ ...fontsFixture[1], status: "DISABLED" });
  render(<TestProviders><ReaderFontsPage /></TestProviders>);

  const toggle = await screen.findByRole("switch", { name: "停用霞鹜文楷" });
  fireEvent.click(toggle);
  await waitFor(() => expect(setStatus).toHaveBeenCalledWith("custom-serif", "DISABLED"));
});