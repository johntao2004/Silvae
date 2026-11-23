import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useLocation } from "react-router-dom";
import { api } from "../api/client";
import { TestProviders } from "../test/TestProviders";
import { LibraryPage } from "../pages/LibraryPage";
import { PublicLibraryPage } from "../pages/PublicLibraryPage";

function Location() {
  const location = useLocation();
  return <output data-testid="url">{location.search}</output>;
}

describe("catalog advanced filters", () => {
  beforeEach(() => {
    sessionStorage.setItem("humite-demo-session", JSON.stringify({ id: "owner", username: "owner", displayName: "站点所有者", role: "OWNER", mustChangePassword: false }));
    localStorage.setItem("humite-library-overview:owner", "hidden");
    vi.spyOn(api, "listCategories");
    vi.spyOn(api, "listBooks").mockResolvedValue({ items: [] });
    vi.spyOn(api, "listDisplayBooks").mockResolvedValue({ items: [], revision: 1 });
  });
  afterEach(() => vi.restoreAllMocks());

  it("opens on demand, combines Thema/search/format/sort without custom categories, and retains filters when collapsed", async () => {
    render(<TestProviders initialPath="/library/all?format=PDF&sort=title&q=诗"><LibraryPage /><Location /></TestProviders>);
    expect(screen.queryByRole("region", { name: "高级筛选" })).not.toBeInTheDocument();
    expect(api.listCategories).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "高级筛选" }));
    const panel = screen.getByRole("region", { name: "高级筛选" });
    expect(within(panel).queryByRole("textbox", { name: "关键词" })).not.toBeInTheDocument();
    expect(within(panel).queryByText("自定义分类")).not.toBeInTheDocument();
    expect(within(panel).queryByRole("button", { name: /管理分类|创建分类/ })).not.toBeInTheDocument();

    const select = await within(panel).findByRole("combobox", { name: "学科分类" });
    fireEvent.mouseDown(select);
    fireEvent.click(await screen.findByText("未指定学科分类"));
    await waitFor(() => expect(api.listBooks).toHaveBeenLastCalledWith(expect.objectContaining({
      subjectCode: "UNCLASSIFIED",
      q: "诗",
      format: "PDF",
      sort: "title",
      cursor: undefined,
    })));
    expect(api.listCategories).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "高级筛选" }));
    expect(screen.queryByRole("region", { name: "高级筛选" })).not.toBeInTheDocument();
    expect(screen.getByTestId("url")).toHaveTextContent("subject=UNCLASSIFIED");
    expect(screen.getByTestId("url")).toHaveTextContent("advanced=0");

    fireEvent.click(screen.getByRole("button", { name: "清除筛选" }));
    expect(screen.getByTestId("url")).toHaveTextContent("sort=title");
    expect(screen.getByTestId("url")).not.toHaveTextContent("subject=");
    expect(screen.getByTestId("url")).not.toHaveTextContent("format=");
  });

  it("uses only the public catalog for anonymous Thema filters and hides custom category controls", async () => {
    sessionStorage.clear();
    render(<TestProviders initialPath="/library?subject=F&format=EPUB&sort=author&q=散文"><PublicLibraryPage /></TestProviders>);
    await screen.findByRole("combobox", { name: "学科分类" });
    expect(api.listDisplayBooks).toHaveBeenCalledWith(expect.objectContaining({ subjectCode: "F", q: "散文", format: "EPUB", sort: "author" }));
    expect(api.listBooks).not.toHaveBeenCalled();
    expect(api.listCategories).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "管理分类" })).not.toBeInTheDocument();
    expect(screen.queryByText("自定义分类")).not.toBeInTheDocument();
  });

  it("combines a deep Thema prefix with existing filters and restores it from the URL", async () => {
    render(<TestProviders initialPath="/library?subject=RNK&format=PDF&sort=title"><LibraryPage /><Location /></TestProviders>);
    expect(await screen.findByRole("combobox", { name: "学科分类" })).toBeInTheDocument();
    await waitFor(() => expect(api.listBooks).toHaveBeenCalledWith(expect.objectContaining({ subjectCode: "RNK", format: "PDF", sort: "title" })));
    fireEvent.click(screen.getByRole("button", { name: "重置" }));
    await waitFor(() => expect(screen.getByTestId("url")).not.toHaveTextContent("subject="));
  });

  it("passes Thema filters to the public endpoint without querying the private catalog", async () => {
    sessionStorage.clear();
    render(<TestProviders initialPath="/library?subject=UNCLASSIFIED"><PublicLibraryPage /></TestProviders>);
    await waitFor(() => expect(api.listDisplayBooks).toHaveBeenCalledWith(expect.objectContaining({ subjectCode: "UNCLASSIFIED" })));
    expect(api.listBooks).not.toHaveBeenCalled();
  });
});
