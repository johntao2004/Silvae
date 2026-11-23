import type { ElementType, ReactNode } from "react";
import { tokens } from "../theme/tokens";
import { Box, Stack, Typography } from "./primitives";

export { useIsMobileViewport } from "../hooks/useIsMobileViewport";

/** Surface card used on mobile viewports as a responsive alternative to dense table rows. */
export function MobileRecordCard({
  children,
  component = "article",
  "aria-label": ariaLabel,
}: {
  children: ReactNode;
  component?: ElementType;
  "aria-label"?: string;
}) {
  return (
    <Box
      component={component}
      aria-label={ariaLabel}
      sx={{
        display: "flex",
        flexDirection: "column",
        gap: `${tokens.spacing[3]}px`,
        minWidth: 0,
        p: `${tokens.spacing[4]}px`,
        bgcolor: "background.paper",
        border: 1,
        borderColor: "divider",
        borderRadius: `${tokens.radius.xl}px`,
      }}
    >
      {children}
    </Box>
  );
}

/** Label/value metadata row inside a MobileRecordCard with wrapping-safe alignment. */
export function MobileRecordField({ label, value }: { label: string; value: ReactNode }) {
  return (
    <Stack
      direction="row"
      sx={{
        justifyContent: "space-between",
        alignItems: "flex-start",
        gap: 2,
        minWidth: 0,
      }}
    >
      <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
        {label}
      </Typography>
      <Typography
        component="div"
        variant="body2"
        sx={{ textAlign: "right", overflowWrap: "anywhere", minWidth: 0 }}
      >
        {value}
      </Typography>
    </Stack>
  );
}
