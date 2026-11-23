import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Box } from "@/ui/primitives";

export interface MobileBottomNavItem {
  label: string;
  path: string;
  icon: ReactNode;
  active: boolean;
}

export function MobileBottomNav({ items }: { items: MobileBottomNavItem[] }) {
  if (items.length === 0) return null;
  return (
    <Box component="nav" aria-label="底部导航" className="bk-mobile-bottom-nav">
      {items.map((item) => (
        <Link
          key={item.path}
          to={item.path}
          aria-current={item.active ? "page" : undefined}
          className={`bk-mobile-bottom-nav__item${item.active ? " bk-mobile-bottom-nav__item--active" : ""}`}
        >
          <span className="bk-mobile-bottom-nav__icon" aria-hidden="true">{item.icon}</span>
          <span className="bk-mobile-bottom-nav__label">{item.label}</span>
        </Link>
      ))}
    </Box>
  );
}
