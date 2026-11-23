import { useState, type ReactNode } from "react";
import { Button } from "@/ui/buttons";
import { TuneRounded } from "@/ui/icons";
import { Drawer } from "@/ui/overlays";
import { Box, FormControl, MenuItem, Stack } from "@/ui/primitives";
import { Select } from "@/ui/forms";
import { useIsMobileViewport } from "../hooks/useIsMobileViewport";
import { tokens } from "../theme/tokens";

interface CatalogSelect {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}

/** Collections share the same filter, sort and responsive action layout. */
export function CatalogFilters({ actions, filter, sort, extraTools, extraFilterCount }: {
  actions?: ReactNode;
  extraTools?: ReactNode;
  filter?: CatalogSelect;
  sort?: CatalogSelect;
  extraFilterCount?: number;
}) {
  const isMobile = useIsMobileViewport();
  const [sheetOpen, setSheetOpen] = useState(false);
  const controls = [filter, sort].filter((control): control is CatalogSelect => Boolean(control));
  const controlBadgeCount = controls.filter((control) => control.options[0] !== undefined && control.value !== control.options[0].value).length;
  const badgeCount = controlBadgeCount + (extraFilterCount ?? 0);
  const hasFilterSheet = controls.length > 0 || Boolean(extraTools);

  if (isMobile) {
    if (!actions && !hasFilterSheet) return null;
    return (
      <Stack direction="row" sx={{ width: "100%", gap: `${tokens.spacing[2]}px`, alignItems: "center" }}>
        {actions && <Box sx={{ flex: 1, minWidth: 0, "& > button, & > a": { width: "100%" } }}>{actions}</Box>}
        {hasFilterSheet && (
          <>
            <Button
              variant="outlined"
              startIcon={<TuneRounded fontSize="small" />}
              onClick={() => setSheetOpen(true)}
              sx={{ minHeight: `${tokens.layout.touchTarget}px`, flexShrink: actions ? 0 : 1, width: actions ? "auto" : "100%" }}
            >
              {badgeCount > 0 ? `筛选 (${badgeCount})` : "筛选"}
            </Button>
            <Drawer
              anchor="bottom"
              open={sheetOpen}
              onClose={() => setSheetOpen(false)}
              title="筛选与排序"
              slotProps={{ paper: { sx: { height: "auto", maxHeight: "80dvh", borderRadius: "16px 16px 0 0" } } }}
            >
              <Stack spacing={3} sx={{ p: `${tokens.spacing[4]}px` }}>
                {controls.map((control) => (
                  <FormControl key={control.label} fullWidth sx={{ minWidth: 0 }}>
                    <Select
                      label={control.label}
                      value={control.value}
                      sx={{ width: "100%" }}
                      onChange={(event: { target: { value: string } }) => control.onChange(event.target.value)}
                    >
                      {control.options.map((option) => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)}
                    </Select>
                  </FormControl>
                ))}
                {extraTools}
                <Button
                  variant="contained"
                  fullWidth
                  onClick={() => setSheetOpen(false)}
                  sx={{ minHeight: `${tokens.layout.touchTarget}px` }}
                >
                  完成
                </Button>
              </Stack>
            </Drawer>
          </>
        )}
      </Stack>
    );
  }

  return <Stack direction="row" sx={{
    width: { xs: "100%", sm: "auto" },
    justifyContent: { xs: "flex-start", sm: "flex-end" },
    alignItems: "center", flexWrap: "wrap", gap: `${tokens.spacing[3]}px`,
  }}>
    {actions && <Stack direction="row" sx={{ width: { xs: "100%", sm: "auto" }, gap: `${tokens.spacing[3]}px`, "& > button": { flex: { xs: 1, sm: "0 0 auto" } } }}>{actions}</Stack>}
    {controls.map((control) => <FormControl key={control.label} sx={{ minWidth: 0, width: tokens.spacing[20] * 2, flex: { xs: "1 1 0", sm: "0 0 auto" } }}>
      <Select label={control.label} value={control.value} onChange={(event: { target: { value: string } }) => control.onChange(event.target.value)}>
        {control.options.map(option => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)}
      </Select>
    </FormControl>)}
    {extraTools && <Stack sx={{ width: { xs: "100%", sm: "auto" }, "& > button": { width: { xs: "100%", sm: "auto" } } }}>{extraTools}</Stack>}
  </Stack>;
}
