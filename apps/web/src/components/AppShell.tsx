import { usePermissions, PermissionBoundary } from "../auth/permissions";
// 共享导航与账号操作壳，显示权限取自认证状态而非代替服务端权限检查。
// Shared navigation/account shell derives display permissions from auth state without replacing server authorization.
import { useSiteSettingsQuery, SiteMetadata, SiteFooter } from "../site/site-settings";
import { pageWidthSx, topNavigationSurfaceSx } from "./PageHeader";
import {
  AutoStoriesOutlined,
  CategoryOutlined,
  CloseRounded,
  DescriptionOutlined,
  EditNoteRounded,
  ExpandMoreRounded,
  HomeOutlined,
  LibraryBooksOutlined,
  LockOutlined,
  NotesOutlined,
  SearchRounded,
  SettingsOutlined,
  ThreeDRotationOutlined,
} from "@/ui/icons";

import { AppBar, Box, Stack, Toolbar, Typography, type UiTheme } from "@/ui/primitives";
import { Alert, Avatar } from "@/ui/feedback";
import { Button } from "@/ui/buttons";
import { Dropdown } from "@/ui/antd";
import { InputAdornment } from "@/ui/primitives";
import { TextField } from "@/ui/forms";
import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent, type MouseEvent, type PropsWithChildren } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { DEFAULT_SITE_SETTINGS } from "../api/client";
import { useIsMobileViewport } from "../hooks/useIsMobileViewport";
import { tokens } from "../theme/tokens";
import { MobileBottomNav, type MobileBottomNavItem } from "./MobileBottomNav";
import { SiteThemeMenu } from "./SiteThemeMenu";
import { useOrdinaryPageScale } from "../theme/useOrdinaryPageScale";
import { articlesNavigationSections, libraryNavigationSections, notesNavigationSections } from "./app-navigation-sections";
import { useVaultNavigationStatus } from "../features/vault/use-vault-navigation-status";

const navigation = [
  { label: "藏书楼", path: "/library", icon: <LibraryBooksOutlined /> },
  { label: "发现", path: "/discover", icon: <CategoryOutlined /> },
  { label: "文章", path: "/articles", icon: <NotesOutlined /> },
  { label: "阅读笔记", path: "/annotations", icon: <NotesOutlined /> },
  { label: "加密书库", path: "/vault", icon: <LockOutlined /> },
];

const headerControlSx = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: `${tokens.layout.iconButtonSize}px`,
  height: `${tokens.layout.iconButtonSize}px`,
  minWidth: `${tokens.layout.iconButtonSize}px`,
  minHeight: `${tokens.layout.iconButtonSize}px`,
  p: 0,
  flexShrink: 0,
  border: 0,
  borderRadius: `${tokens.radius.md}px`,
  bgcolor: "transparent",
  color: "text.primary",
  cursor: "pointer",
  transition: "background-color 150ms ease, color 150ms ease",
  "&:hover": { bgcolor: "action.hover" },
  "&:focus-visible": { outline: "none", boxShadow: "var(--shadow-focus)" },
};

const mobileLibraryHubPaths = new Set(["/library", "/library/overview", "/knowledge-graph"]);
const mobileNotesHubPaths = new Set(["/annotations", "/annotations/books", "/annotations/articles"]);

export function AppShell({ children }: PropsWithChildren) {
  const siteQuery = useSiteSettingsQuery();
  const site = siteQuery.data ?? DEFAULT_SITE_SETTINGS;
  const { user, logout } = useAuth();
  const { canVisit } = usePermissions();
  const vaultEnabled = useVaultNavigationStatus(user?.id, Boolean(user && canVisit("/vault")));
  const [logoutError, setLogoutError] = useState("");
  const location = useLocation();
  const navigate = useNavigate();

  const [libraryMenuOpen, setLibraryMenuOpen] = useState(false);
  const [notesMenuOpen, setNotesMenuOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const librarySections = libraryNavigationSections
    .filter(item => (!item.requiresUser || user)
      && (item.path !== "/virtual-library" || (siteQuery.isSuccess && site.virtualLibraryEnabled)))
    .filter(item => canVisit(item.path));
  const notesSections = notesNavigationSections.filter(item => canVisit(item.path));
  const articlesSections = articlesNavigationSections.filter(item => canVisit(item.path));
  const libraryNavigation = (user ? navigation : navigation.filter(item => item.path === "/library" || item.path === "/discover"))
    .filter(item => item.path !== "/vault" || vaultEnabled)
    .filter(item => canVisit(item.path) || (item.path === "/articles" && articlesSections.length > 0)
      || (item.path === "/annotations" && notesSections.length > 0));
  const searchLabel = "搜索书籍、文章、笔记、书单";
  const searchableLibrary = canVisit("/search");
  const isMobile = useIsMobileViewport();
  const isImmersiveRoute = /^\/reader\/[^/]+/.test(location.pathname)
    || /^\/articles\/[^/]+/.test(location.pathname)
    || location.pathname === "/virtual-library";
  const readerRoute = location.pathname.startsWith("/reader/") || /^\/articles\/[^/]+\/?$/.test(location.pathname);
  useOrdinaryPageScale(!readerRoute && location.pathname !== "/virtual-library");
  const [query, setQuery] = useState(location.pathname === "/search" ? new URLSearchParams(location.search).get("q") ?? "" : "");
  useEffect(() => {
    if (location.pathname === "/search") setQuery(new URLSearchParams(location.search).get("q") ?? "");
  }, [location.pathname, location.search]);
  const [searchExpanded, setSearchExpanded] = useState(Boolean(query));
  const searchTriggerRef = useRef<HTMLElement>(null);
  const matchesRoute = (prefix: string) => location.pathname === prefix || location.pathname.startsWith(`${prefix}/`);
  const isActivePath = (path: string) => matchesRoute(path)
    || (path === "/discover" && (matchesRoute("/booklists") || matchesRoute("/article-collections")))
    || (path === "/library" && ["/knowledge-graph", "/virtual-library"].some(matchesRoute));

  const hasVaultAccess = Boolean(user && vaultEnabled && canVisit("/vault"));
  const showSettingsBottomTab = Boolean(user && canVisit("/settings"));
  const showDiscoverBottomTab = canVisit("/discover");
  const showVaultBottomTab = !showSettingsBottomTab && hasVaultAccess;
  const showDedicated3dTab = !showSettingsBottomTab && !showVaultBottomTab && siteQuery.isSuccess && site.virtualLibraryEnabled && canVisit("/virtual-library");
  const bottomNavItems: MobileBottomNavItem[] = [];
  if (isMobile && !isImmersiveRoute) {
    const articlesDestination = canVisit("/articles") ? "/articles" : articlesSections[0]?.path;
    const notesDestination = canVisit("/annotations") ? "/annotations" : notesSections[0]?.path;

    if (canVisit("/library")) {
      bottomNavItems.push({
        label: "藏书",
        path: "/library",
        icon: <AutoStoriesOutlined />,
        active: isActivePath("/library") && (!showDedicated3dTab || location.pathname !== "/virtual-library"),
      });
    }
    if (showDiscoverBottomTab) {
      bottomNavItems.push({
        label: "发现",
        path: "/discover",
        icon: <CategoryOutlined />,
        active: isActivePath("/discover"),
      });
    }
    if (user && articlesDestination) {
      bottomNavItems.push({
        label: "文章",
        path: articlesDestination,
        icon: <DescriptionOutlined />,
        active: isActivePath("/articles"),
      });
    }
    if (user && notesDestination) {
      bottomNavItems.push({
        label: "笔记",
        path: notesDestination,
        icon: <EditNoteRounded />,
        active: isActivePath("/annotations"),
      });
    }
    if (showVaultBottomTab) {
      bottomNavItems.push({
        label: "加密库",
        path: "/vault",
        icon: <LockOutlined />,
        active: isActivePath("/vault"),
      });
    } else if (showSettingsBottomTab) {
      bottomNavItems.push({
        label: "设置",
        path: "/settings",
        icon: <SettingsOutlined />,
        active: location.pathname.startsWith("/settings"),
      });
    } else if (showDedicated3dTab) {
      bottomNavItems.push({
        label: "3D",
        path: "/virtual-library",
        icon: <ThreeDRotationOutlined />,
        active: location.pathname === "/virtual-library",
      });
    } else if (user) {
      bottomNavItems.push({
        label: "我的",
        path: "/profile",
        icon: <HomeOutlined />,
        active: location.pathname === "/profile",
      });
    }
  }

  const selectedLibraryPath = librarySections.find(section => location.pathname === section.path || location.pathname.startsWith(`${section.path}/`))?.path;
  const selectedNotesPath = location.pathname.startsWith("/annotations/posts/book/") ? "/annotations/books"
    : location.pathname.startsWith("/annotations/posts/article/") ? "/annotations/articles"
      : notesSections.find(section => isActivePath(section.path))?.path;

  let mobileSectionTabs: Array<{ label: string; path: string; active: boolean }> = [];
  if (isMobile && !isImmersiveRoute) {
    if (mobileLibraryHubPaths.has(location.pathname)) {
      const items = [
        ...(canVisit("/library") ? [{ label: "全部藏书", path: "/library" }] : []),
        ...librarySections.map(({ label, path }) => ({ label, path })),
      ];
      mobileSectionTabs = items.map(item => ({ ...item, active: location.pathname === item.path }));
    } else if (mobileNotesHubPaths.has(location.pathname)) {
      const items = [
        ...(canVisit("/annotations") ? [{ label: "全部笔记", path: "/annotations" }] : []),
        ...notesSections.map(({ label, path }) => ({ label, path })),
      ];
      mobileSectionTabs = items.map(item => ({ ...item, active: location.pathname === item.path }));
    }
  }
  const hasMobileSubNav = mobileSectionTabs.length > 1;

  const updateQuery = (value: string) => setQuery(value);

  const linkButton = (item: (typeof navigation)[number]) => {
    const library = item.path === "/library";
    const notes = item.path === "/annotations";
    const sections = library ? librarySections : notes ? notesSections : [];
    const grouped = (library || notes) && sections.length > 0;
    const menuOpen = library ? libraryMenuOpen : notesMenuOpen;
    const setMenuOpen = library ? setLibraryMenuOpen : setNotesMenuOpen;
    const selectedPath = library ? selectedLibraryPath : notes ? selectedNotesPath : undefined;
    const destination = canVisit(item.path) ? item.path : sections[0]?.path ?? item.path;
    const active = isActivePath(item.path);
    const button = (
      <Box
        key={item.path}
        component={Link}
        to={destination}
        aria-haspopup={grouped ? "menu" : undefined}
        aria-expanded={grouped ? menuOpen : undefined}
        aria-current={active ? "page" : undefined}
        onClick={grouped ? () => setMenuOpen(false) : undefined}
        onKeyDown={grouped ? (event: KeyboardEvent<HTMLElement>) => {
          if (event.key === "ArrowDown") { event.preventDefault(); setMenuOpen(true); }
          if (event.key === "Escape") setMenuOpen(false);
        } : undefined}
        className={`bk-nav-link${active ? " bk-nav-link-active" : ""}`}
      >
        <span className="bk-nav-label">{item.label}</span>
        {grouped && <ExpandMoreRounded className="bk-nav-chevron" />}
      </Box>
    );
    return grouped ? (
      <Dropdown
        key={item.path}
        open={menuOpen}
        onOpenChange={setMenuOpen}
        trigger={["hover", "click"]}
        mouseEnterDelay={0}
        placement="bottomLeft"
        autoFocus
        styles={{ root: { minWidth: tokens.layout.menuMinWidth } }}
        menu={{
          selectedKeys: selectedPath ? [selectedPath] : [],
          items: sections.map(section => ({ key: section.path, label: <NavLink to={section.path}>{section.label}</NavLink> })),
          onClick: () => setMenuOpen(false),
        }}
      >
        {button}
      </Dropdown>
    ) : button;
  };

  return (
    <Box
      sx={{
        minHeight: "var(--app-viewport-height, 100vh)",
        bgcolor: "background.default",
        color: "text.primary",
        "--layout-active-nav-height": isMobile && isImmersiveRoute
          ? "0px"
          : isMobile
            ? (hasMobileSubNav ? "100px" : "54px")
            : `${tokens.layout.navHeight}px`,
      }}
    >
      {logoutError && <Alert severity="error" onClose={() => setLogoutError("")}>{logoutError}</Alert>}
      {!(isMobile && isImmersiveRoute) && (
        <AppBar
          className="bk-top-nav"
          position="sticky"
          elevation={0}
          color="transparent"
          sx={topNavigationSurfaceSx}
        >
          <Toolbar
            component="nav"
            aria-label="全站导航"
            className="bk-top-nav-inner"
            sx={{
              position: "relative",
              minHeight: `${tokens.layout.navHeight}px !important`,
              ...pageWidthSx,
              display: { xs: "flex", sm: "grid" },
              gridTemplateColumns: { sm: "minmax(0, 1fr) max-content" },
              justifyContent: { sm: "space-between" },
              gap: { xs: 1, sm: 1.5, md: 2 },
            }}
          >
            <Stack direction="row" sx={{ alignItems: "center", gap: { xs: 1, sm: 1.5, md: 2 }, minWidth: 0, flexWrap: "wrap" }}>
              <Typography
                component={NavLink}
                to="/library"
                variant="h5"
                sx={{
                  display: "inline-flex",
                  alignItems: "center",
                  height: `${tokens.layout.iconButtonSize}px`,
                  lineHeight: 1,
                  color: "text.primary",
                  textDecoration: "none",
                  whiteSpace: "nowrap",
                  maxWidth: { xs: `${tokens.spacing[24] * 1.5}px`, sm: `${tokens.spacing[24] * 2.5}px` },
                  overflow: "hidden", textOverflow: "ellipsis",
                  fontFamily: tokens.typography.fontFamily.display,
                  fontWeight: tokens.typography.fontWeight.regular,
                  fontSize: { xs: "20px", sm: "21px" },
                }}
              >
                {site.name}
              </Typography>

              <Stack direction="row" spacing={0.5} sx={{ display: { xs: "none", sm: "flex" }, minWidth: 0, flexWrap: "wrap" }}>
                {libraryNavigation.map(linkButton)}
              </Stack>
            </Stack>

            <Stack direction="row" sx={{ position: { xs: "static", md: "relative" }, alignItems: "center", gap: { xs: 0.75, sm: 1, md: 1.5 }, flexShrink: 0, ml: { xs: "auto", sm: 0 }, justifySelf: { sm: "end" } }}>
              {searchableLibrary && (
                <Box
                  data-testid="global-navigation-search"
                  onMouseEnter={() => setSearchExpanded(true)}
                  onMouseLeave={() => setSearchExpanded(false)}
                  sx={{
                    position: { xs: "static", md: "relative" },
                    display: "flex",
                    alignItems: "center",
                    width: { xs: `${tokens.layout.iconButtonSize}px`, md: searchExpanded ? `clamp(${tokens.spacing[24] + tokens.spacing[12]}px, calc(100vw - ${tokens.spacing[24] * 9 + tokens.spacing[8]}px), ${tokens.spacing[24] * 3}px)` : `${tokens.layout.iconButtonSize}px` },
                    height: `${tokens.layout.iconButtonSize}px`,
                    flexShrink: 0,
                  }}
                >
                  <Box
                    ref={searchTriggerRef}
                    component="button"
                    type="button"
                    className="bk-top-nav-control"
                    aria-label="展开搜索"
                    aria-expanded={searchExpanded}
                    aria-controls="global-navigation-search-panel"
                    onClick={() => setSearchExpanded(true)}
                    sx={headerControlSx}
                  >
                    <SearchRounded sx={{ fontSize: 20 }} />
                  </Box>
                  <Box
                    id="global-navigation-search-panel"
                    data-testid="global-navigation-search-panel"
                    sx={(theme: UiTheme) => ({
                      position: "absolute",
                      top: 0,
                      bottom: 0,
                      right: 0,
                      left: { xs: 0, md: "auto" },
                      zIndex: 4,
                      display: "flex",
                      alignItems: "center",
                      px: { xs: `${tokens.spacing[4]}px`, sm: `${tokens.spacing[6]}px`, md: 0 },
                      bgcolor: { xs: "background.default", md: "transparent" },
                      width: { xs: "auto", md: "100%" },
                      visibility: searchExpanded ? "visible" : "hidden",
                      pointerEvents: searchExpanded ? "auto" : "none",
                      transition: theme.transitions.create("width"),
                      "@media (prefers-reduced-motion: reduce)": { transition: "none" },
                    })}
                  >
                    {searchExpanded && (
                      <TextField
                        className="bk-top-nav-search-field"
                        autoFocus
                        value={query}
                        onChange={(event: ChangeEvent<HTMLInputElement>) => updateQuery(event.target.value)}
                        onBlur={() => setSearchExpanded(false)}
                        onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
                          if (event.key === "Enter" && !event.nativeEvent?.isComposing && query.trim()) {
                            event.preventDefault();
                            navigate(`/search?q=${encodeURIComponent(query.trim())}`);
                            setSearchExpanded(false);
                          }
                          if (event.key === "Escape") {
                            setSearchExpanded(false);
                            searchTriggerRef.current?.focus();
                          }
                        }}
                        placeholder={searchLabel ?? undefined}
                        aria-label={searchLabel ?? undefined}
                        sx={{ width: "100%", "& .bk-field-control": { bgcolor: "background.default" } }}
                        slotProps={{
                          input: {
                            startAdornment: <InputAdornment position="start"><SearchRounded sx={{ fontSize: 18 }} /></InputAdornment>,
                            endAdornment: (
                              <InputAdornment position="end">
                                <Box
                                  component="button"
                                  type="button"
                                  aria-label="关闭搜索"
                                  onMouseDown={(event: MouseEvent<HTMLButtonElement>) => event.preventDefault()}
                                  onClick={(event: MouseEvent<HTMLButtonElement>) => {
                                    event.stopPropagation();
                                    setSearchExpanded(false);
                                    searchTriggerRef.current?.focus();
                                  }}
                                  sx={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    width: 24,
                                    height: 24,
                                    p: 0,
                                    border: 0,
                                    borderRadius: `${tokens.radius.md}px`,
                                    bgcolor: "transparent",
                                    color: "text.secondary",
                                    cursor: "pointer",
                                    "&:hover": { color: "text.primary", bgcolor: "action.hover" },
                                  }}
                                >
                                  <CloseRounded sx={{ fontSize: 16 }} />
                                </Box>
                              </InputAdornment>
                            ),
                          },
                        }}
                      />
                    )}
                  </Box>
                </Box>
              )}
              <SiteThemeMenu sx={headerControlSx} />
              {user ? (
                <Dropdown
                  open={accountMenuOpen}
                  onOpenChange={setAccountMenuOpen}
                  trigger={["click"]}
                  placement="bottomRight"
                  menu={{
                    items: [
                      { key: "account", label: user.displayName, disabled: true },
                      { type: "divider" },
                      { key: "/profile", label: "个人信息" },
                      ...(isMobile && hasVaultAccess && !showVaultBottomTab ? [{ key: "/vault", label: "加密书库" }] : []),
                      ...(canVisit("/settings") && !(isMobile && showSettingsBottomTab) ? [{ key: "/settings", label: "管理设置" }] : []),
                      { type: "divider" },
                      { key: "logout", label: "退出登录" },
                    ],
                    onClick: async ({ key }) => {
                      setAccountMenuOpen(false);
                      if (key === "logout") {
                        setLogoutError("");
                        try { await logout(); navigate("/login"); }
                        catch (reason) { setLogoutError(reason instanceof Error ? reason.message : "退出失败，请重试。"); }
                      } else {
                        navigate(key);
                      }
                    },
                  }}
                >
                  <Box
                    component="button"
                    type="button"
                    className="bk-account-trigger bk-top-nav-control"
                    aria-label="账户菜单"
                    aria-haspopup="menu"
                    aria-expanded={accountMenuOpen}
                    sx={headerControlSx}
                  >
                    <Avatar className="bk-account-avatar" sx={{ width: 26, height: 26, fontSize: 13, flexShrink: 0, bgcolor: "secondary.main", color: "common.white", fontFamily: tokens.typography.fontFamily.display }}>
                      {user.displayName.slice(0, 1)}
                    </Avatar>
                  </Box>
                </Dropdown>
              ) : (
                <Button color="inherit" onClick={() => navigate("/login")} sx={{ whiteSpace: "nowrap", px: 1.5, minWidth: tokens.layout.iconButtonSize, height: tokens.layout.iconButtonSize, minHeight: tokens.layout.iconButtonSize, flexShrink: 0 }}>登录</Button>
              )}
            </Stack>
          </Toolbar>

          {hasMobileSubNav && (
            <Box component="nav" aria-label="分区导航" className="bk-mobile-subnav">
              {mobileSectionTabs.map((tab) => (
                <NavLink
                  key={tab.path}
                  to={tab.path}
                  aria-current={tab.active ? "page" : undefined}
                  className={`bk-mobile-subnav__item${tab.active ? " bk-mobile-subnav__item--active" : ""}`}
                >
                  {tab.label}
                </NavLink>
              ))}
            </Box>
          )}
        </AppBar>
      )}

      <SiteMetadata />
      <Box component="main" className={isMobile && !isImmersiveRoute ? "bk-app-main bk-app-main--with-bottom-nav" : "bk-app-main"}>
        <PermissionBoundary>{children}</PermissionBoundary>
      </Box>
      <SiteFooter />
      {isMobile && !isImmersiveRoute && <MobileBottomNav items={bottomNavItems} />}
    </Box>
  );
}
