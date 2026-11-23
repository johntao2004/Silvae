import { BookCover } from "./BookCover";
// 分类和书单发现卡片共用封面拼图与可见性展示，不自行授予书籍访问权。
// Discovery cards share cover mosaics and visibility presentation without granting book access themselves.
import { BookCardPresentation } from "./BookCardPresentation";
import { BookCatalogEmptyState } from "./BookCatalogEmptyState";
import { CatalogSection } from "./CatalogSection";
import { collectionGridSx } from "./bookGrid";
import { AutoStoriesOutlined } from "@/ui/icons";
import { LockOutlined } from "@/ui/icons";
import { PeopleAltOutlined } from "@/ui/icons";
import { PublicOutlined } from "@/ui/icons";
import { Box } from "@/ui/primitives";
import { Card } from "@/ui/cards";
import { CardActionArea } from "@/ui/primitives";
import { Chip } from "@/ui/feedback";
import { Stack } from "@/ui/primitives";
import { Typography } from "@/ui/primitives";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { BooklistSummary, BooklistVisibility, BrowseBook } from "../domain/types";
import { ArticleCollectionPreview } from "../features/article-collections/ArticleCollectionPreview";
import type { ArticleCollectionSummary } from "../features/article-collections/api";
import { tokens } from "../theme/tokens";

export function CoverMosaic({ books, label }: { books: BrowseBook[]; label: string; compact?: boolean }) {
  const visible = books.slice(0, 4);
  const count = visible.length;
  const columns = count === 4 ? 2 : count;
  const rows = count === 4 ? 2 : count ? 1 : 0;
  const layout = count === 0 ? "empty" : count === 1 ? "single" : count === 2 ? "pair" : count === 3 ? "row" : "quad";
  const gap = tokens.spacing[1];
  const coverWidthByHeight = rows ? 75 * columns / rows : 100;
  const gapWidthByHeight = rows
    ? gap * (columns - 1 - (0.75 * columns * (rows - 1)) / rows)
    : 0;
  const heightLimitedWidth = rows
    ? `calc(${coverWidthByHeight}cqh + ${gapWidthByHeight}px)`
    : "100cqw";
  return (
    <Box
      role="img"
      aria-label={label}
      data-mosaic-layout={layout}
      data-mosaic-columns={columns}
      sx={{
        display: "grid",
        placeItems: "center",
        aspectRatio: "1 / 1",
        minHeight: 0,
        bgcolor: "background.paper",
        border: 1,
        borderColor: "divider",
        borderRadius: `${tokens.radius.xl}px`,
        overflow: "hidden",
        containerType: "size",
      }}
    >
      {count ? (
        <Box
          data-mosaic-content=""
          sx={{
            display: "grid",
            gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
            gap: `${gap}px`,
            width: `min(100cqw, ${heightLimitedWidth})`,
            minWidth: 0,
            alignContent: "center",
          }}
        >
          {visible.map((book) => <BookCover key={book.id} src={book.coverUrl} alt="" sx={{ width: "100%" }} />)}
        </Box>
      ) : (
        <Stack sx={{ width: "100%", height: "100%", minHeight: 0, alignItems: "center", justifyContent: "center", color: "text.disabled" }}>
          <AutoStoriesOutlined sx={{ fontSize: 48 }} />
        </Stack>
      )}
    </Box>
  );
}

export function VisibilityChip({ visibility, size = "small" }: { visibility: BooklistVisibility; size?: "small" | "medium" }) {
  const config = {
    PRIVATE: { label: "仅自己", icon: <LockOutlined /> },
    MEMBERS: { label: "家庭成员", icon: <PeopleAltOutlined /> },
    PUBLIC: { label: "公开", icon: <PublicOutlined /> },
  }[visibility];
  return <Chip size={size} variant="outlined" icon={config.icon} label={config.label} />;
}

export function BooklistCard({ booklist }: { booklist: BooklistSummary }) {
  return (
    <Card variant="borderless" className="bk-discovery-card" sx={{ "&.ant-card": { boxShadow: "none" }, width: "100%", maxWidth: "none", bgcolor: "transparent", overflow: "visible" }}>
      <CardActionArea
        component={Link}
        to={`/booklists/${booklist.id}`}
        sx={{ display: "block", borderRadius: `${tokens.radius.xl}px`, textAlign: "left", "&:hover": { opacity: 1 } }}
      >
        <CoverMosaic books={booklist.previewBooks} label={`${booklist.title}书单封面`} />
        <Stack sx={{ pt: { xs: `${tokens.spacing[2]}px`, sm: `${tokens.spacing[4]}px` }, gap: `${tokens.spacing[1]}px`, minWidth: 0 }}>
          <Typography variant="h5" component="h3" noWrap title={booklist.title} className="bk-discovery-card__title">{booklist.title}</Typography>
          <Typography
            color="text.secondary"
            noWrap
            title={booklist.description || undefined}
            sx={{ fontSize: { xs: "12px", sm: `${tokens.typography.fontSize.body}px` }, color: { xs: "text.muted", sm: "text.secondary" } }}
          >
            {booklist.description || "创建者还没有写下这份书单的说明。"}
          </Typography>
          <Typography
            variant="caption"
            color="text.secondary"
            noWrap
            sx={{ fontSize: { xs: "11px", sm: `${tokens.typography.fontSize.caption}px` }, color: { xs: "text.muted", sm: "text.secondary" } }}
          >
            {booklist.ownerDisplayName ? `由 ${booklist.ownerDisplayName} 创建` : "共享书单"} · {booklist.bookCount} 本
          </Typography>
        </Stack>
      </CardActionArea>
    </Card>
  );
}

export function BooklistSection({ title, description, items, action, emptyTitle }: {
  title: string;
  description?: string;
  items: BooklistSummary[];
  action?: ReactNode;
  emptyTitle: string;
}) {
  return (
    <Box component="section" aria-label={title} sx={{ minWidth: 0 }}>
      <CatalogSection title={title} summary={description ? <Typography color="text.secondary">{description}</Typography> : undefined} tools={action}>
        {items.length ? (
          <Box sx={collectionGridSx}>
            {items.map((booklist) => <BooklistCard key={booklist.id} booklist={booklist} />)}
          </Box>
        ) : (
          <BookCatalogEmptyState title={emptyTitle} />
        )}
      </CatalogSection>
    </Box>
  );
}

export function ArticleCollectionGrid({ items, returnTo }: { items: ArticleCollectionSummary[]; returnTo: string }) {
  return (
    <Box component="section" aria-label="合集列表" sx={collectionGridSx}>
      {items.map((collection) => <ArticleCollectionCard key={collection.id} collection={collection} returnTo={returnTo} />)}
    </Box>
  );
}

export function ArticleCollectionCard({ collection, returnTo }: { collection: ArticleCollectionSummary; returnTo: string }) {
  const from = new URLSearchParams({ from: returnTo });
  return (
    <Card variant="borderless" className="bk-discovery-card" sx={{ minWidth: 0, bgcolor: "transparent", overflow: "visible", "&.ant-card": { boxShadow: "none" } }}>
      <CardActionArea
        component={Link}
        to={`/article-collections/${encodeURIComponent(collection.id)}?${from.toString()}`}
        state={{ returnTo }}
        sx={{ display: "block", textAlign: "left", borderRadius: `${tokens.radius.lg}px`, overflow: "hidden", "&:hover": { opacity: 1 } }}
      >
        <ArticleCollectionPreview
          articles={collection.previewArticles.filter((article) => collection.ownedByViewer || collection.visibility !== "MEMBERS" || article.visibility !== "PRIVATE")}
          title={collection.title}
        />
        <Stack sx={{ minWidth: 0, gap: `${tokens.spacing[1]}px`, pt: { xs: `${tokens.spacing[2]}px`, sm: `${tokens.spacing[3]}px` } }}>
          <Typography variant="h5" component="h3" noWrap title={collection.title} className="bk-discovery-card__title" sx={{ fontWeight: tokens.typography.fontWeight.medium }}>
            {collection.title}
          </Typography>
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{
              fontSize: { xs: "12px", sm: `${tokens.typography.fontSize.bodySm}px` },
              lineHeight: { xs: 1.4, sm: tokens.typography.lineHeight.body },
              display: "-webkit-box",
              WebkitLineClamp: { xs: 1, sm: 2 },
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
              overflowWrap: "anywhere",
            }}
          >
            {collection.description || "还没有合集说明。"}
          </Typography>
          {collection.ownerDisplayName ? (
            <Typography
              variant="caption"
              color="text.secondary"
              noWrap
              sx={{
                fontSize: { xs: "11px", sm: `${tokens.typography.fontSize.caption}px` },
                pt: { xs: 0, sm: `${tokens.spacing[1]}px` },
              }}
            >
              {collection.ownerDisplayName}
            </Typography>
          ) : null}
        </Stack>
      </CardActionArea>
    </Card>
  );
}

export function BrowseBookCard({ book, onAdd, onRemove }: {
  book: BrowseBook;
  onAdd?: (book: BrowseBook) => void;
  onRemove?: (book: BrowseBook) => void;
}) {
  return <BookCardPresentation book={book} actions={[
    ...(onAdd ? [{ label: "加入书单", onClick: () => onAdd(book) }] : []),
    ...(onRemove ? [{ label: "移出", danger: true, onClick: () => onRemove(book) }] : []),
  ]} />;
}
