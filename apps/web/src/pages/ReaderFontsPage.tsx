import { usePermissions } from "../auth/permissions";
// 协调字体登记、文件上传及启用状态，上传完成前不把条目视作可用字体。
// Coordinates font registration, binary upload and enablement without treating incomplete uploads as usable fonts.
import { EmptyState } from "../ui/empty-state";
import { PageContainer, SectionHeader } from "../components/PageHeader";
import { Alert } from "@/ui/feedback";
import { Button } from "@/ui/buttons";
import { CircularProgress } from "@/ui/feedback";
import { FormControl } from "@/ui/primitives";
import { InputLabel } from "@/ui/primitives";
import { MenuItem } from "@/ui/primitives";
import { Select } from "@/ui/forms";
import { Snackbar } from "@/ui/primitives";
import { Stack } from "@/ui/primitives";
import { Switch } from "@/ui/forms";
import { TextField } from "@/ui/forms";
import { Typography } from "@/ui/primitives";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type ChangeEvent } from "react";
import { api } from "../api/client";
import { readerFontFamily } from "../components/readers/reader-fonts";
import type { ReaderFont } from "../domain/types";
import "./settings-page.css";

const allowedExtensions = new Set(["woff2", "woff", "ttf", "otf"]);
const cssFormatMap: Record<NonNullable<ReaderFont["format"]>, string> = {
  WOFF2: "woff2",
  WOFF: "woff",
  TTF: "truetype",
  OTF: "opentype",
};

function sanitizeCssValue(value: string): string {
  return value.replace(/["'\\{}();\r\n]/gu, "");
}

export function ReaderFontsPage() {
  const { can } = usePermissions();
  const queryClient = useQueryClient();
  const fontsQuery = useQuery({ queryKey: ["reader-fonts", "admin"], queryFn: api.listReaderFontsForAdmin });
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [kind, setKind] = useState<ReaderFont["kind"]>("SERIF");
  const [licenseNote, setLicenseNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const fonts = fontsQuery.data ?? [];
  const upload = async (file: File) => {
    const extension = file.name.split(".").at(-1)?.toLowerCase() ?? "";
    if (!allowedExtensions.has(extension)) {
      setError("只支持 WOFF2、WOFF、TTF 和 OTF 字体文件。");
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      setError("字体文件不能超过 25 MB。");
      return;
    }
    setBusy(true);
    setUploadProgress(0);
    try {
      const created = await api.createReaderFont({
        displayName: displayName.trim() || file.name.replace(/\.[^.]+$/u, ""),
        kind,
        filename: file.name,
        sizeBytes: file.size,
        licenseNote: licenseNote.trim() || undefined,
      });
      await api.uploadReaderFontContent(created.id, file, setUploadProgress);
      await queryClient.invalidateQueries({ queryKey: ["reader-fonts", "admin"] });
      await queryClient.invalidateQueries({ queryKey: ["reader-fonts"] });
      setDisplayName("");
      setLicenseNote("");
      if (inputRef.current) inputRef.current.value = "";
      setNotice("字体已上传并启用，阅读器可以立即选择。");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "字体上传失败");
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (font: ReaderFont) => {
    try {
      await api.setReaderFontStatus(font.id, font.status === "ENABLED" ? "DISABLED" : "ENABLED");
      await queryClient.invalidateQueries({ queryKey: ["reader-fonts", "admin"] });
      await queryClient.invalidateQueries({ queryKey: ["reader-fonts"] });
      setNotice(font.status === "ENABLED" ? "字体已停用；已有阅读设置会自动回退。" : "字体已启用。");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "字体状态更新失败");
    }
  };

  return (
    <PageContainer>
      {fonts
        .filter((font) => font.source === "CUSTOM" && font.contentUrl)
        .map((font) => (
          <style key={font.id}>
            {`@font-face { font-family: "${sanitizeCssValue(font.familyName)}"; src: url("${sanitizeCssValue(font.contentUrl ?? "")}") format("${font.format ? cssFormatMap[font.format] : "woff2"}"); font-display: swap; }`}
          </style>
        ))}

      <Stack className="bk-settings-stack">
        <Stack className="bk-settings-card" spacing={2}>
          <SectionHeader
            title="上传自定义字体"
            action={
              <>
                <input
                  ref={inputRef}
                  hidden
                  type="file"
                  accept=".woff2,.woff,.ttf,.otf"
                  onChange={(event: ChangeEvent<HTMLInputElement>) => {
                    const file = event.target.files?.[0];
                    if (file) void upload(file);
                  }}
                />
                <Button
                  variant="contained"
                  startIcon={busy ? <CircularProgress size={18} color="inherit" /> : undefined}
                  disabled={busy || !can("settings.fonts.edit")}
                  onClick={() => inputRef.current?.click()}
                >
                  {busy ? `上传中 ${uploadProgress}%` : "选择字体文件"}
                </Button>
              </>
            }
          />
          <div className="bk-settings-field-grid">
            <TextField
              label="展示名称（可选）"
              value={displayName}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setDisplayName(event.target.value)}
              fullWidth
            />
            <FormControl fullWidth>
              <InputLabel id="reader-font-kind-label">字体类型</InputLabel>
              <Select
                labelId="reader-font-kind-label"
                label="字体类型"
                value={kind}
                onChange={(event: { target: { value: string } }) => setKind(event.target.value as ReaderFont["kind"])}
              >
                <MenuItem value="SERIF">衬线字体</MenuItem>
                <MenuItem value="SANS">无衬线字体</MenuItem>
              </Select>
            </FormControl>
            <TextField
              className="bk-settings-field-full"
              label="来源 / 许可说明（可选）"
              value={licenseNote}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setLicenseNote(event.target.value)}
              fullWidth
            />
          </div>
          <Typography component="p" variant="caption" color="text.secondary">
            WOFF2 / WOFF / TTF / OTF · ≤ 25 MB
          </Typography>
        </Stack>

        <Stack className="bk-settings-card" spacing={2}>
          <SectionHeader title="已安装字体" />
          {fontsQuery.isError && <Alert severity="error">无法读取字体列表，请刷新后重试。</Alert>}
          {fontsQuery.isSuccess && fonts.length === 0 && <EmptyState title="暂无阅读字体" />}
          {fonts.length > 0 && (
            <div className="bk-settings-toggle-list">
              {fonts.map((font) => (
                <Stack
                  key={font.id}
                  data-testid={`reader-font-card-${font.id}`}
                  direction="row"
                  spacing={2}
                  className="bk-settings-toggle-row"
                  sx={{
                    alignItems: "center",
                    justifyContent: "space-between",
                    minWidth: 0,
                    opacity: font.status === "ENABLED" ? 1 : 0.62,
                  }}
                >
                  <Typography variant="h5" sx={{ fontFamily: readerFontFamily(font), minWidth: 0, overflowWrap: "anywhere" }}>
                    {font.displayName}
                  </Typography>
                  <Switch
                    checked={font.status === "ENABLED"}
                    onChange={() => void toggle(font)}
                    disabled={font.source === "PRESET" || !can("settings.fonts.edit")}
                    sx={{ flexShrink: 0 }}
                    slotProps={{
                      input: {
                        "aria-label": font.source === "PRESET"
                          ? `${font.displayName}为预设字体，已启用`
                          : `${font.status === "ENABLED" ? "停用" : "启用"}${font.displayName}`,
                      },
                    }}
                  />
                </Stack>
              ))}
            </div>
          )}
        </Stack>
      </Stack>
      <Snackbar open={Boolean(error)} autoHideDuration={5000} onClose={() => setError("")}><Alert severity="error" onClose={() => setError("")}>{error}</Alert></Snackbar>
      <Snackbar open={Boolean(notice)} autoHideDuration={3500} onClose={() => setNotice("")} message={notice} />
    </PageContainer>
  );
}