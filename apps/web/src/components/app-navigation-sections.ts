/** Shared labels and paths for AppShell submenus and the role page tree. */
export const libraryNavigationSections = [
  { label: "书库概览", path: "/library/overview", requiresUser: true },
  { label: "知识图谱", path: "/knowledge-graph", requiresUser: true },
  { label: "3D 书库", path: "/virtual-library", requiresUser: false },
] as const;

export interface NavigationSection {
  readonly label: string;
  readonly path: string;
}

export const articlesNavigationSections: readonly NavigationSection[] = [];

export const notesNavigationSections = [
  { label: "书籍笔记", path: "/annotations/books" },
  { label: "文章笔记", path: "/annotations/articles" },
] as const;
