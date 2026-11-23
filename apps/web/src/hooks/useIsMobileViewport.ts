import { useMediaQuery } from "@/ui/primitives";
import { tokens } from "../theme/tokens";

export const MOBILE_VIEWPORT_MEDIA_QUERY = `(max-width: ${tokens.layout.breakpointMobile - 0.05}px)`;
export const DESKTOP_VIEWPORT_MEDIA_QUERY = `(min-width: ${tokens.layout.breakpointMobile}px)`;

/** Matches viewports narrower than the mobile breakpoint (`< 768px`). */
export function useIsMobileViewport(): boolean {
  return useMediaQuery(MOBILE_VIEWPORT_MEDIA_QUERY);
}

/** Matches desktop/tablet viewports (`>= 768px`, `true` only when `min-width` matches). */
export function useDesktopViewport(): boolean {
  return useMediaQuery(DESKTOP_VIEWPORT_MEDIA_QUERY);
}
