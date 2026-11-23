import { overviewContentSpacing } from "./overviewCardLayout";
import { statusTitle } from "../ui/status-title";
// 概览卡空态保留共享高度与标题对齐，文案由具体业务模块提供。
// Overview empty states preserve shared sizing/alignment while business modules supply their copy.
import { EmptyStateIllustration } from "../ui/empty-state";
import { Box } from "@/ui/primitives";
import { Stack } from "@/ui/primitives";
import { Typography } from "@/ui/primitives";
import type { ReactNode } from "react";
import { tokens } from "../theme/tokens";

export function OverviewEmptyState({
  title,
  description,
  titleId,
  inverse = false,
}: {
  title: ReactNode;
  description?: ReactNode;
  titleId?: string;
  inverse?: boolean;
}) {
  return (
    <Stack
      sx={{
        gap: `${tokens.spacing[2]}px`,
        minHeight: `${tokens.spacing[16]}px`,
        alignItems: "center",
        textAlign: "center",
        justifyContent: "center",
        flex: 1,
        mt: overviewContentSpacing,
      }}
    >
      <Box sx={{ lineHeight: 0, ...(inverse ? { opacity: 0.88 } : {}) }}>
        <EmptyStateIllustration compact />
      </Box>
      <Box sx={{ maxWidth: "22ch" }}>
        <Typography
          id={titleId}
          variant="h4"
          sx={{
            fontSize: `${tokens.typography.fontSize.titleSm}px`,
            lineHeight: tokens.typography.lineHeight.ui,
            fontWeight: tokens.typography.fontWeight.medium,
          }}
        >
          {statusTitle(title)}
        </Typography>
        {description != null ? (
          <Typography
            variant="caption"
            color={inverse ? "inherit" : "text.secondary"}
            sx={{
              display: "block",
              mt: `${tokens.spacing[1]}px`,
              lineHeight: tokens.typography.lineHeight.caption,
              ...(inverse ? { opacity: 0.76 } : {}),
            }}
          >
            {description}
          </Typography>
        ) : null}
      </Box>
    </Stack>
  );
}
