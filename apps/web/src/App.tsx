// 应用路由组合层，区分公开页面、认证内容和管理角色入口。
// Composes application routes with distinct public, authenticated and management entry points.
import { lazy, Suspense } from "react";
import { Navigate, Outlet, Route, Routes, useLocation, useParams } from "react-router-dom";
import { RequireAuth, useAuth } from "./auth/AuthContext";
import { SetupGate } from "./auth/SetupGate";
import { AppLoading } from "./components/AppLoading";
import { AppShell } from "./components/AppShell";
import { normalizeSettingsHash } from "./pages/settings-navigation";

const ArticlesPage = lazy(() => import("./pages/ArticlesPage").then(m => ({ default: m.ArticlesPage })));
const ArticleCollectionDetailPage = lazy(() => import("./pages/ArticleCollectionDetailPage").then(m => ({ default: m.ArticleCollectionDetailPage })));
const ArticleReaderPage = lazy(() => import("./pages/ArticleReaderPage").then(m => ({ default: m.ArticleReaderPage })));
const DiscoverPage = lazy(() => import("./pages/DiscoverPage").then(m => ({ default: m.DiscoverPage })));
const VaultPage = lazy(() => import("./pages/VaultPage").then(m => ({ default: m.VaultPage })));
const VirtualLibraryRoute = lazy(() => import("./pages/VirtualLibraryRoute").then(m => ({ default: m.VirtualLibraryRoute })));
const SearchPage = lazy(() => import("./pages/SearchPage").then(m => ({ default: m.SearchPage })));
const ProfilePage = lazy(() => import("./pages/ProfilePage").then(m => ({ default: m.ProfilePage })));
const RegisterPage = lazy(() => import("./pages/RegisterPage").then(m => ({ default: m.RegisterPage })));
const SettingsPage = lazy(() => import("./pages/SettingsPage").then(module => ({ default: module.SettingsPage })));
const BookDetailPage = lazy(() => import("./pages/BookDetailPage").then(module => ({ default: module.BookDetailPage })));
const MetadataEditPage = lazy(() => import("./pages/MetadataEditPage").then(module => ({ default: module.MetadataEditPage })));
const ReadingNotesPage = lazy(() => import("./pages/ReadingNotesPage").then(module => ({ default: module.ReadingNotesPage })));
const ReadingPostPage = lazy(() => import("./features/notes/ReadingPosts").then(module => ({ default: module.ReadingPostPage })));
const ChangePasswordPage = lazy(() => import("./pages/ChangePasswordPage").then((module) => ({ default: module.ChangePasswordPage })));
const BooklistDetailPage = lazy(() => import("./pages/BooklistDetailPage").then((module) => ({ default: module.BooklistDetailPage })));
const KnowledgeGraphPage = lazy(() => import("./pages/KnowledgeGraphPage").then(module => ({ default: module.KnowledgeGraphPage })));
const LibraryPage = lazy(() => import("./pages/LibraryPage").then((module) => ({ default: module.LibraryPage })));
const LibraryOverviewPage = lazy(() => import("./pages/LibraryOverviewPage").then(module => ({ default: module.LibraryOverviewPage })));
const RecoveryPage = lazy(() => import("./pages/RecoveryPage").then(m => ({ default: m.RecoveryPage })));
const LoginPage = lazy(() => import("./pages/LoginPage").then((module) => ({ default: module.LoginPage })));
const NotFoundPage = lazy(() => import("./pages/NotFoundPage").then((module) => ({ default: module.NotFoundPage })));
const ReaderPage = lazy(() => import("./pages/ReaderPage").then((module) => ({ default: module.ReaderPage })));
const SetupPage = lazy(() => import("./pages/SetupPage").then((module) => ({ default: module.SetupPage })));

function ShellPageFallback() {
  return (
    <div className="bk-app-loading" role="status" aria-label="正在打开页面…" aria-live="polite" aria-atomic="true" aria-busy="true" style={{ minHeight: "40vh" }}>
      <span className="bk-app-loading__indicator" aria-hidden="true" />
      <span className="bk-app-loading__label">正在打开页面…</span>
    </div>
  );
}

function ProtectedShell() {
  return <RequireAuth><AppShell><Suspense fallback={<ShellPageFallback />}><Outlet /></Suspense></AppShell></RequireAuth>;
}

function PublicShell() {
  return <AppShell><Suspense fallback={<ShellPageFallback />}><Outlet /></Suspense></AppShell>;
}

function LegacyCategoryRedirect() {
  const { ready } = useAuth();
  const location = useLocation();
  const { categoryId } = useParams();
  if (!ready) return <AppLoading label="正在确认登录状态…" />;

  const params = new URLSearchParams(location.search);
  if (categoryId) params.set("category", categoryId);
  params.set("advanced", "1");
  const search = params.toString();
  return <Navigate replace to={{
    pathname: "/library",
    search: search ? `?${search}` : "",
    hash: location.hash,
  }} />;
}

function LegacyLibraryRedirect() {
  const location = useLocation();
  return <Navigate replace to={{ pathname: "/library", search: location.search, hash: location.hash }} state={location.state} />;
}

function ReadingNotesIndex() {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const legacy = ["type", "bookId", "articleId", "q"].some(key => params.has(key));
  if (!legacy) return <ReadingNotesPage kind="ALL" />;

  const next = new URLSearchParams(params);
  const section = params.get("type") === "articles" || params.has("articleId") ? "articles" : "books";
  next.delete("type");
  next.set("view", "annotations");
  const search = next.toString();
  return <Navigate replace to={{ pathname: `/annotations/${section}`, search: search ? `?${search}` : "", hash: location.hash }} state={location.state} />;
}

function LegacyNotesOverviewRedirect() {
  const location = useLocation();
  return <Navigate replace to={{ pathname: "/annotations", search: location.search, hash: location.hash }} state={location.state} />;
}

function AdminUsersRedirect() {
  const location = useLocation();
  const hash = normalizeSettingsHash(location.hash || "#users");
  return <Navigate replace to={{ pathname: "/settings", search: location.search, hash }} state={location.state} />;
}

function RecoverRedirect() {
  const location = useLocation();
  return <Navigate replace to={{ pathname: "/forgot-password", search: location.search, hash: location.hash }} state={location.state} />;
}

export default function App() {
  return (
    <Suspense fallback={<AppLoading label="正在打开页面…" />}>
      <SetupGate>
      <Routes>
        <Route path="/recover" element={<RecoverRedirect />} />
        <Route path="/forgot-password" element={<RecoveryPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/setup" element={<SetupPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/change-password" element={<RequireAuth passwordChangeOnly><ChangePasswordPage /></RequireAuth>} />
        <Route element={<PublicShell />}>
          <Route path="/library" element={<LibraryPage />} />
          <Route path="/discover" element={<DiscoverPage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/categories" element={<LegacyCategoryRedirect />} />
          <Route path="/categories/:categoryId" element={<LegacyCategoryRedirect />} />
          <Route path="/booklists" element={<Navigate replace to="/discover?tab=booklists" />} />
          <Route path="/booklists/:booklistId" element={<BooklistDetailPage />} />
          <Route path="/reader/:bookId" element={<ReaderPage />} />
          <Route path="/virtual-library" element={<VirtualLibraryRoute />} />
          <Route path="/library/books/:bookId" element={<BookDetailPage />} />
        </Route>
        <Route element={<ProtectedShell />}>
          <Route path="/library/overview" element={<LibraryOverviewPage />} />
          <Route path="/articles" element={<ArticlesPage />} />
          <Route path="/articles/:articleId" element={<ArticleReaderPage />} />
          <Route path="/article-collections" element={<Navigate replace to="/discover?tab=collections" />} />
          <Route path="/article-collections/:collectionId" element={<ArticleCollectionDetailPage />} />
          <Route path="/library/books/:bookId/edit" element={<RequireAuth roles={["OWNER", "ADMIN"]}><MetadataEditPage /></RequireAuth>} />
          <Route path="/library/uploads/:uploadId" element={<RequireAuth roles={["OWNER", "ADMIN"]}><MetadataEditPage /></RequireAuth>} />
          <Route path="/vault" element={<VaultPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/library/all" element={<LegacyLibraryRedirect />} />
          <Route path="/knowledge-graph" element={<KnowledgeGraphPage />} />
          <Route path="/display-books" element={<LegacyLibraryRedirect />} />
          <Route path="/settings/display-books" element={<LegacyLibraryRedirect />} />
          <Route path="/recycle-bin" element={<RequireAuth roles={["OWNER", "ADMIN"]}><Navigate to="/settings#catalog/recycle-bin" replace /></RequireAuth>} />
          <Route path="/annotations" element={<ReadingNotesIndex />} />
          <Route path="/annotations/books" element={<ReadingNotesPage kind="BOOK" />} />
          <Route path="/annotations/articles" element={<ReadingNotesPage kind="ARTICLE" />} />
          <Route path="/annotations/all" element={<LegacyNotesOverviewRedirect />} />
          <Route path="/annotations/posts/:kind/:postId" element={<ReadingPostPage />} />
          <Route path="/admin/library-roots" element={<Navigate to="/settings#catalog/library-roots" replace />} />
          <Route path="/admin/users" element={<RequireAuth roles={["OWNER", "ADMIN"]}><AdminUsersRedirect /></RequireAuth>} />
          <Route path="/admin/file-operations" element={<Navigate to="/settings#catalog/operations" replace />} />
          <Route path="/admin/reader-fonts" element={<Navigate to="/settings#services/reader-fonts" replace />} />
          <Route path="/admin/recycle-bin" element={<RequireAuth roles={["OWNER", "ADMIN"]}><Navigate to="/settings#catalog/recycle-bin" replace /></RequireAuth>} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
        <Route path="/" element={<Navigate to="/library" replace />} />
      </Routes>
      </SetupGate>
    </Suspense>
  );
}
