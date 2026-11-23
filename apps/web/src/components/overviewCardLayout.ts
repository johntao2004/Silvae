import type { SxObject } from "@/ui/primitives";
import { tokens } from "../theme/tokens";

// One inset and content rhythm across populated, empty and loading overview cards.
export const overviewCardSx: SxObject = {
  minWidth: 0,
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
  p: { xs: `${tokens.spacing[4]}px`, lg: `${tokens.spacing[5]}px` },
  bgcolor: "background.paper",
  border: 1,
  borderColor: "divider",
  borderRadius: `${tokens.radius.xl}px`,
  overflow: "hidden",
};

export const overviewContentSpacing = `${tokens.spacing[3]}px`;
