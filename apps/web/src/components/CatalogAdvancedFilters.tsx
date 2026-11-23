import { lazy, Suspense } from "react";
const ThemaSubjectField = lazy(() => import("./ThemaSubjectField").then(module => ({ default: module.ThemaSubjectField })));
import { Skeleton } from "@/ui/antd";
import { Button } from "@/ui/buttons";
import { Box, Stack } from "@/ui/primitives";
import { useCatalogFilterParams } from "../hooks/useCatalogFilterParams";
import { tokens } from "../theme/tokens";

export function CatalogAdvancedFilterToggle() {
  const { expanded, updateParam } = useCatalogFilterParams();
  return (
    <Button
      variant="outlined"
      aria-expanded={expanded}
      aria-controls="catalog-advanced-filters"
      onClick={() => updateParam("advanced", expanded ? "0" : "1")}
    >
      高级筛选
    </Button>
  );
}

export function CatalogAdvancedFilters() {
  const { subjectCode, expanded, updateParam, clearFilters, activeCount } = useCatalogFilterParams();
  return (
    <Box id="catalog-advanced-filters" component="section" aria-label="高级筛选" hidden={!expanded} sx={{ mb: `${tokens.spacing[4]}px` }}>
      {expanded && (
        <Box sx={{ border: 1, borderColor: "divider", borderRadius: `${tokens.radius.lg}px`, bgcolor: "background.paper", p: `${tokens.spacing[4]}px` }}>
          <Stack direction={{ xs: "column", sm: "row" }} sx={{ alignItems: { xs: "stretch", sm: "flex-end" }, justifyContent: "space-between", gap: `${tokens.spacing[4]}px` }}>
            <Box sx={{ flex: 1, minWidth: 0, maxWidth: { sm: 420 } }}>
              <Suspense fallback={<Skeleton active title={false} paragraph={{ rows: 1 }} />}>
                <ThemaSubjectField filter value={subjectCode ? [subjectCode] : []} onChange={codes => updateParam("subject", codes[0] ?? "")} />
              </Suspense>
            </Box>
            <Button disabled={!activeCount} onClick={clearFilters} sx={{ alignSelf: { xs: "flex-start", sm: "flex-end" } }}>重置</Button>
          </Stack>
        </Box>
      )}
    </Box>
  );
}
