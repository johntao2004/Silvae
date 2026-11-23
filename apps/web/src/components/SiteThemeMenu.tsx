import { useState } from "react";
import { Dropdown } from "@/ui/antd";
import { IconButton } from "@/ui/buttons";
import { DarkModeOutlined, SettingsBrightnessOutlined, SystemThemeOutlined } from "@/ui/icons";
import { Box, type SxProps } from "@/ui/primitives";
import { useHumiteTheme } from "../theme/HumiteThemeProvider";
import { humiteThemeOptions } from "../theme/theme";
import { tokens } from "../theme/tokens";
import type { ReaderTheme } from "./readers/reader-fonts";

const swatchSx = {
  width: tokens.spacing[5],
  height: tokens.spacing[5],
  borderRadius: `${tokens.radius.pill}px`,
  border: 1,
  borderColor: "divider",
};

const triggerSx = {
  width: 36,
  minWidth: 36,
  height: 36,
  minHeight: 36,
};

export function SiteThemeMenu({ sx = triggerSx }: { sx?: SxProps }) {
  const { mode, isAuto, setMode, followSystem } = useHumiteTheme();
  const [open, setOpen] = useState(false);
  const CurrentIcon = mode === "NIGHT" ? DarkModeOutlined : SettingsBrightnessOutlined;
  const currentLabel = humiteThemeOptions[mode].label;

  return <Dropdown open={open} onOpenChange={setOpen} trigger={["hover", "click"]} placement="bottomRight" menu={{
    selectable: true,
    selectedKeys: [isAuto ? "AUTO" : mode],
    items: [
      { key: "AUTO", label: "跟随系统", icon: <SystemThemeOutlined /> },
      { type: "divider" },
      ...(Object.keys(humiteThemeOptions) as ReaderTheme[]).map(theme => ({
        key: theme,
        label: humiteThemeOptions[theme].label,
        icon: <Box sx={{ ...swatchSx, bgcolor: humiteThemeOptions[theme].reader.background }} />,
      })),
    ],
    onClick: ({ key }) => {
      if (key === "AUTO") followSystem();
      else setMode(key as ReaderTheme);
      setOpen(false);
    },
  }}>
    <IconButton type="button" aria-label="切换全站主题" aria-haspopup="menu" aria-expanded={open}
      title={isAuto ? `跟随系统 · ${currentLabel}` : currentLabel} sx={sx}>
      <CurrentIcon sx={{ fontSize: 20 }} />
    </IconButton>
  </Dropdown>;
}
