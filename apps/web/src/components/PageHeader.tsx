import { Box, flattenSx, headingTypographySx, mergeClassNames, Stack, Typography, useTheme } from "@/ui/primitives";
import type { SxProps, Theme } from "@/ui/primitives";
import { createContext, useContext, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowBackRounded } from "../ui/icons";

export const EmbeddedSettingsContext = createContext(false);
import { tokens } from "../theme/tokens";

export const pageWidthSx = {
  width: "100%",
  maxWidth: "none",
  mx: "auto",
  px: { xs: `${tokens.spacing[4]}px`, sm: `${tokens.spacing[6]}px` },
};

// 阅读器导航与正文共用准确页面框架，避免平板和小型笔记本上上下导航栏错位。
// Reader chrome and document surfaces share the exact page frame at every
// viewport width. A narrower intermediate reader frame makes the two stacked
// navigation bars visibly drift apart on tablets and small laptops.
export const readerWidthSx = pageWidthSx;

export const topNavigationSurfaceSx = {
  bgcolor: "background.default",
  color: "text.primary",
  borderBottom: 0,
  boxShadow: "none",
};

export function PageContainer({ children, sx }: { children: ReactNode; sx?: SxProps<Theme> }) {
  const embedded = useContext(EmbeddedSettingsContext);
  const theme = useTheme();
  if (embedded) return <Box sx={sx}>{children}</Box>;
  return (
    <Box sx={{
      ...pageWidthSx,
      pb: { xs: 4, md: 8 },
      ...flattenSx(sx, theme),
      width: pageWidthSx.width,
      maxWidth: pageWidthSx.maxWidth,
      mx: pageWidthSx.mx,
      px: pageWidthSx.px,
      pt: { xs: `${tokens.spacing[3]}px`, sm: `${tokens.spacing[6]}px` },
    }}>{children}</Box>
  );
}

export function PageTitle({
  children,
  color,
  className,
  id,
}: {
  children: ReactNode;
  color?: string;
  className?: string;
  id?: string;
}) {
  return (
    <Box
      id={id}
      component="h1"
      className={mergeClassNames("bk-typography", "bk-typography-h3", className)}
      sx={{
        margin: 0,
        ...headingTypographySx("h1"),
        ...(color ? { color } : {}),
        fontSize: { xs: 26, sm: 32 },
        lineHeight: { xs: "32px", sm: "36px" },
        overflowWrap: "anywhere",
      }}
    >
      {children}
    </Box>
  );
}

export function PageBackAction({ children, to, onClick, inline = false }: {
  children: ReactNode;
  to?: string;
  onClick?: () => void;
  inline?: boolean;
}) {
  const label = typeof children === "string" || typeof children === "number" ? String(children) : "返回";
  const control = to
    ? <Link to={to} className="bk-back-button" aria-label={label} title={label}><ArrowBackRounded aria-hidden="true" /></Link>
    : <button type="button" className="bk-back-button" aria-label={label} title={label} onClick={onClick}><ArrowBackRounded aria-hidden="true" /></button>;
  if (inline) return control;
  return <Box className="bk-page-back" sx={{ display: "flex", justifyContent: "flex-start", mb: `${tokens.spacing[3]}px` }}>
    {control}
  </Box>;
}

export function PageHeader({
  eyebrow,
  title,
  back,
  embeddedDescription,
  action,
}: {
  eyebrow?: string;
  title: string;
  back?: ReactNode;
  // 仅嵌入式设置标题支持说明文案，标准页头不显示描述。
  /** Supporting copy for embedded settings headings; standard page headers omit descriptions. */
  embeddedDescription?: string;
  action?: ReactNode;
}) {
  const embedded = useContext(EmbeddedSettingsContext);
  return (
    <Stack sx={{ mb: embedded ? 0 : { xs: `${tokens.spacing[3]}px`, sm: `${tokens.spacing[6]}px` } }}>
      {!embedded && eyebrow && <Typography variant="overline" color="text.secondary" sx={{ fontWeight: tokens.typography.fontWeight.medium, display: { xs: "none", sm: "block" } }}>{eyebrow}</Typography>}
      <Stack
        direction="row"
        sx={{
          minWidth: 0,
          alignItems: "center",
          flexWrap: "wrap",
          justifyContent: "space-between",
          gap: embedded ? 2 : { xs: 1.5, sm: 3 },
        }}
      >
        <Stack direction="row" sx={{ minWidth: 0, alignItems: "center", gap: "12px" }}>
          {back}
          <Box sx={{ minWidth: 0 }}>
            {embedded
              ? <Typography variant="h5" component="h2">{title}</Typography>
              : <PageTitle>{title}</PageTitle>}
          </Box>
        </Stack>
        {action && <ActionToolbar compactMobile>{action}</ActionToolbar>}
      </Stack>
      {embedded && embeddedDescription && <Typography color="text.secondary" sx={{ mt: 1.5, maxWidth: 720 }}>{embeddedDescription}</Typography>}
    </Stack>
  );
}

export function ActionToolbar({ children, compactMobile = false }: { children: ReactNode; compactMobile?: boolean }) {
  return <Stack className="bk-action-toolbar" direction="row" sx={{ minWidth: 0, maxWidth: "100%", width: compactMobile ? "auto" : { xs: "100%", sm: "auto" }, ml: "auto", justifyContent: "flex-end", alignItems: "center", flexWrap: "wrap", gap: 1.5 }}>{children}</Stack>;
}

/** Align section actions with the shared page toolbar, above the section fields. */
export function SectionHeader({ title, action, description }: { title: string; action?: ReactNode; description?: string }) {
  return <Stack spacing={1}>
    <Stack direction="row" sx={{ minWidth: 0, alignItems: "center", flexWrap: "wrap", justifyContent: "space-between", gap: 2 }}>
      <Typography component="h3" variant="h5" sx={{ minWidth: 0, overflowWrap: "anywhere" }}>{title}</Typography>
      {action && <ActionToolbar>{action}</ActionToolbar>}
    </Stack>
    {description && <Typography color="text.secondary">{description}</Typography>}
  </Stack>;
}

export function FormActions({ children }: { children: ReactNode }) {
  return <Stack direction="row" sx={{ width: "100%", justifyContent: "flex-end" }}>{children}</Stack>;
}
