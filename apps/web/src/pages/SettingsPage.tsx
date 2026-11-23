import { usePermissions, settingsPermissions } from "../auth/permissions";
import { AccessDeniedPage } from "./AccessDeniedPage";
import { lazy, Suspense, useEffect, useState, type KeyboardEvent, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { RequireAuth } from "../auth/AuthContext";
import { useIsMobileViewport } from "../hooks/useIsMobileViewport";
import { Skeleton } from "../ui/antd";
import {
  ArrowBackRounded,
  ArrowForwardIosRounded,
  FolderOutlined,
  GppGoodOutlined,
  PaletteOutlined,
  PeopleAltOutlined,
  PublicOutlined,
} from "../ui/icons";
import { Box, Stack } from "../ui/primitives";
import { EmbeddedSettingsContext, PageContainer, PageHeader } from "../components/PageHeader";
import { normalizeSettingsHash, settingsGroups } from "./settings-navigation";
import "./settings-page.css";

const LibraryRoots = lazy(() => import("./LibraryRootsPage").then(m => ({ default: m.LibraryRootsPage })));
const Operations = lazy(() => import("./FileOperationsPage").then(m => ({ default: m.FileOperationsPage })));
const RecycleBin = lazy(() => import("./RecycleBinPage").then(m => ({ default: m.RecycleBinPage })));
const Users = lazy(() => import("./UsersPage").then(m => ({ default: m.UsersPage })));
const Sessions = lazy(() => import("./ActiveSessionsPage").then(m => ({ default: m.ActiveSessionsPage })));
const Logins = lazy(() => import("./LoginLogsPage").then(m => ({ default: m.LoginLogsPage })));
const Security = lazy(() => import("./SecuritySettingsPage").then(m => ({ default: m.SecuritySettingsPage })));
const Fonts = lazy(() => import("./ReaderFontsPage").then(m => ({ default: m.ReaderFontsPage })));
const AiSettings = lazy(() => import("./AiSettingsPage").then(m => ({ default: m.AiSettingsPage })));
const MetadataProviders = lazy(() => import("./MetadataProviderSettingsPage").then(m => ({ default: m.MetadataProviderSettingsPage })));
const MailSettings = lazy(() => import("./MailSettingsPage").then(m => ({ default: m.MailSettingsPage })));
const Personalization = lazy(() => import("./SiteSettingsPage").then(m => ({ default: m.SiteSettingsPage })));
const Roles = lazy(() => import("./RolePermissionsPage").then(m => ({ default: m.RolePermissionsPage })));

const panels = {
  roots: LibraryRoots,
  operations: Operations,
  recycle: RecycleBin,
  users: Users,
  roles: Roles,
  security: Security,
  sessions: Sessions,
  logins: Logins,
  site: Personalization,
  fonts: Fonts,
  ai: AiSettings,
  metadata: MetadataProviders,
  mail: MailSettings,
};

const groupIcons: Record<(typeof settingsGroups)[number]["key"], ReactNode> = {
  catalog: <FolderOutlined />,
  users: <PeopleAltOutlined />,
  security: <GppGoodOutlined />,
  website: <PaletteOutlined />,
  services: <PublicOutlined />,
};

const groups = settingsGroups.map(group => ({
  ...group,
  sections: group.sections.map(section => ({ ...section, component: panels[section.panel] })),
}));

function nextWrappedIndex(current: number, delta: number, length: number) {
  return (current + delta + length) % length;
}

export function SettingsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const isMobile = useIsMobileViewport();
  const [showIndex, setShowIndex] = useState(() => !location.hash);
  const { can } = usePermissions();
  const available = groups
    .map(group => ({ ...group, sections: group.sections.filter(section => can(settingsPermissions[section.hash])) }))
    .filter(group => group.sections.length > 0);
  const canManage = available.length > 0;
  const requestedHash = normalizeSettingsHash(location.hash);
  const requestedAllowed = !settingsPermissions[requestedHash] || can(settingsPermissions[requestedHash]);
  const activeGroup = available.find(group => group.sections.some(section => section.hash === requestedHash))
    ?? available.find(group => requestedHash === `#${group.key}` || requestedHash.startsWith(`#${group.key}/`))
    ?? available[0];
  const active = activeGroup?.sections.find(section => section.hash === requestedHash) ?? activeGroup?.sections[0];
  const activeHash = active?.hash;

  useEffect(() => {
    setShowIndex(!location.hash);
  }, [location.hash]);

  useEffect(() => {
    if (location.hash === "#recovery-email") { navigate("/profile", { replace: true }); return; }
    if (location.hash === "#display-books") { navigate({ pathname: "/library", search: location.search }, { replace: true }); return; }
    if ((!isMobile || Boolean(location.hash)) && activeHash && location.hash !== activeHash && requestedAllowed) {
      navigate({ pathname: "/settings", search: location.search, hash: activeHash }, { replace: true });
    }
  }, [activeHash, isMobile, location.hash, location.search, navigate, requestedAllowed]);

  // Never mount administrative data while redirecting a member or a legacy account link.
  if (location.hash === "#recovery-email" || location.hash === "#display-books") return null;
  if ((settingsPermissions[requestedHash] && !can(settingsPermissions[requestedHash])) || !canManage || !active || !activeGroup) {
    return <AccessDeniedPage reason="INSUFFICIENT_ROLE" returnTo={`/settings${location.hash}`} />;
  }

  const navigateToSection = (hash: string) => navigate({ pathname: "/settings", search: location.search, hash });
  const Panel = active.component;
  const panel = (
    <Box component="section" aria-label={active.label} className="bk-settings-panel">
      <EmbeddedSettingsContext.Provider value>
        <RequireAuth roles={active.ownerOnly ? ["OWNER"] : ["OWNER", "ADMIN"]}>
          <Suspense fallback={<Skeleton active paragraph={{ rows: 6 }} />}><Panel /></Suspense>
        </RequireAuth>
      </EmbeddedSettingsContext.Provider>
    </Box>
  );

  const handleGroupKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const target = available[nextWrappedIndex(index, event.key === "ArrowDown" ? 1 : -1, available.length)];
    if (!target) return;
    navigateToSection(target.sections[0].hash);
    const siblings = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    siblings?.[nextWrappedIndex(index, event.key === "ArrowDown" ? 1 : -1, available.length)]?.focus();
  };

  const handleSubTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const sections = activeGroup.sections;
    const nextIndex = nextWrappedIndex(index, event.key === "ArrowRight" ? 1 : -1, sections.length);
    const target = sections[nextIndex];
    if (!target) return;
    navigateToSection(target.hash);
    const siblings = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    siblings?.[nextIndex]?.focus();
  };

  return (
    <PageContainer>
      {!(isMobile && !showIndex) && <PageHeader title="管理设置" />}
      <Box role="region" aria-label="设置分区" sx={{ minWidth: 0 }}>
        {isMobile ? (
          showIndex ? (
            <Stack component="nav" aria-label="移动端设置导航" spacing={2.5}>
              {available.map(group => (
                <section key={group.key} className="bk-settings-index-group">
                  <h2 className="bk-settings-index-heading">{group.label}</h2>
                  <div className="bk-settings-index-card">
                    {group.sections.map(section => {
                      const isCurrent = Boolean(location.hash) && section.hash === active.hash;
                      return (
                        <button
                          key={section.hash}
                          type="button"
                          aria-current={isCurrent ? "page" : undefined}
                          className={`bk-settings-index-row${isCurrent ? " bk-settings-index-row--active" : ""}`}
                          onClick={() => {
                            setShowIndex(false);
                            navigateToSection(section.hash);
                          }}
                        >
                          <span>{section.label}</span>
                          <ArrowForwardIosRounded className="bk-settings-index-chevron" aria-hidden="true" />
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))}
            </Stack>
          ) : (
            <Box component="section" aria-label={activeGroup.label} sx={{ minWidth: 0 }}>
              <div className="bk-settings-mobile-bar">
                <button
                  type="button"
                  className="bk-settings-mobile-back"
                  aria-label="全部设置"
                  onClick={() => setShowIndex(true)}
                >
                  <ArrowBackRounded aria-hidden="true" />
                </button>
                <h1 className="bk-settings-mobile-title">{activeGroup.label}</h1>
              </div>
              {activeGroup.sections.length > 1 && (
                <nav aria-label={`${activeGroup.label}子分区`} className="bk-settings-mobile-subnav">
                  {activeGroup.sections.map(section => {
                    const isSectionActive = section.hash === active.hash;
                    return (
                      <button
                        key={section.hash}
                        type="button"
                        aria-current={isSectionActive ? "page" : undefined}
                        className={`bk-settings-mobile-pill${isSectionActive ? " bk-settings-mobile-pill--active" : ""}`}
                        onClick={() => navigateToSection(section.hash)}
                      >
                        {section.label}
                      </button>
                    );
                  })}
                </nav>
              )}
              {panel}
            </Box>
          )
        ) : (
          <div className="bk-settings-shell">
            <nav className="bk-settings-sidebar" aria-label="设置分组">
              <div role="tablist" aria-orientation="vertical" className="bk-settings-group-list">
                {available.map((group, index) => {
                  const isGroupActive = group.key === activeGroup.key;
                  return (
                    <button
                      key={group.key}
                      type="button"
                      role="tab"
                      aria-selected={isGroupActive}
                      tabIndex={isGroupActive ? 0 : -1}
                      className={`bk-settings-group-tab${isGroupActive ? " bk-settings-group-tab--active" : ""}`}
                      onClick={() => navigateToSection(group.sections[0].hash)}
                      onKeyDown={(event) => handleGroupKeyDown(event, index)}
                    >
                      <span className="bk-settings-group-tab__icon" aria-hidden="true">{groupIcons[group.key]}</span>
                      <span>{group.label}</span>
                    </button>
                  );
                })}
              </div>
            </nav>

            <Box component="section" aria-label={activeGroup.label} className="bk-settings-workspace">
              <div role="tablist" aria-label={`${activeGroup.label}子分区`} className="bk-settings-subtabs">
                {activeGroup.sections.map((section, index) => {
                  const isSectionActive = section.hash === active.hash;
                  return (
                    <button
                      key={section.hash}
                      type="button"
                      role="tab"
                      aria-selected={isSectionActive}
                      tabIndex={isSectionActive ? 0 : -1}
                      className={`bk-settings-subtab${isSectionActive ? " bk-settings-subtab--active" : ""}`}
                      onClick={() => navigateToSection(section.hash)}
                      onKeyDown={(event) => handleSubTabKeyDown(event, index)}
                    >
                      {section.label}
                    </button>
                  );
                })}
              </div>
              {panel}
            </Box>
          </div>
        )}
      </Box>
    </PageContainer>
  );
}
