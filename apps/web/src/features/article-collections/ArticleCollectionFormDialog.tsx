import { Alert } from "@/ui/feedback";
import { Button } from "@/ui/buttons";
import { Dialog, DialogActions, DialogContent, DialogTitle } from "@/ui/overlays";
import { FormControl, InputLabel, MenuItem, Stack, Typography } from "@/ui/primitives";
import { Select, TextField } from "@/ui/forms";
import { useEffect, useState, type ChangeEvent } from "react";
import {
  articleCollectionError,
  articleCollections,
  isArticleCollectionRevisionConflict,
  type ArticleCollectionDetail,
  type ArticleCollectionDraft,
  type ArticleCollectionVisibility,
} from "./api";
import { tokens } from "../../theme/tokens";

export function ArticleCollectionFormDialog({ open, initial, hasPrivateArticles = false, onClose, onSaved, onDeleted, onConflictLatest }: {
  open: boolean;
  initial?: ArticleCollectionDetail | null;
  hasPrivateArticles?: boolean;
  onClose: () => void;
  onSaved: (collection: ArticleCollectionDetail, message: string) => void;
  onDeleted?: (message: string) => void;
  onConflictLatest?: (collection: ArticleCollectionDetail) => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<ArticleCollectionVisibility>("PRIVATE");
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(initial?.title ?? "");
    setDescription(initial?.description ?? "");
    setVisibility(initial?.visibility ?? "PRIVATE");
    setRevision(initial?.revision ?? 0);
    setError("");
    setConfirmDelete(false);
  }, [open, initial?.id]);

  const refreshConflict = async () => {
    if (!initial) return;
    const latest = await articleCollections.get(initial.id);
    setRevision(latest.revision);
    onConflictLatest?.(latest);
  };

  const save = async () => {
    const cleanTitle = title.trim();
    if (!cleanTitle || cleanTitle.length > 240 || description.length > 4000 || (visibility === "MEMBERS" && hasPrivateArticles)) return;
    setBusy(true);
    setError("");
    const draft: ArticleCollectionDraft = { title: cleanTitle, description: description.trim(), visibility };
    try {
      const result = initial
        ? await articleCollections.update(initial.id, draft, revision)
        : await articleCollections.create(draft);
      onSaved(result, initial ? "合集修改已保存" : "合集已创建");
    } catch (reason) {
      if (isArticleCollectionRevisionConflict(reason)) {
        try {
          await refreshConflict();
          setError("已加载合集的最新版本。你的草稿已保留，请核对后再次保存。");
        } catch (refreshError) {
          setError(`${articleCollectionError(reason)} 无法加载最新版本。 ${articleCollectionError(refreshError)}`);
        }
      } else {
        setError(articleCollectionError(reason, "保存合集失败，请重试。"));
      }
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!initial || !onDeleted) return;
    setBusy(true);
    setError("");
    try {
      await articleCollections.remove(initial.id, revision);
      onDeleted("合集已删除，文章和阅读记录已保留");
    } catch (reason) {
      if (isArticleCollectionRevisionConflict(reason)) {
        try {
          await refreshConflict();
          setError("已加载合集的最新版本并保留你的草稿。请核对后再决定是否删除。");
        } catch (refreshError) {
          setError(`${articleCollectionError(reason)} 无法加载最新版本。 ${articleCollectionError(refreshError)}`);
        }
      } else {
        setError(articleCollectionError(reason, "删除合集失败，请重试。"));
      }
      setConfirmDelete(false);
    } finally {
      setBusy(false);
    }
  };

  const titleError = title.trim().length === 0 || title.trim().length > 240;
  const descriptionError = description.length > 4000;
  const lockedSharedVisibility = visibility === "MEMBERS" && hasPrivateArticles;

  return <>
    <Dialog open={open && !confirmDelete} onClose={busy ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>{initial ? "编辑合集" : "新建合集"}</DialogTitle>
      <DialogContent>
        <Stack sx={{ gap: `${tokens.spacing[5]}px`, pt: `${tokens.spacing[2]}px` }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField autoFocus label="合集名称" value={title} onChange={(event: ChangeEvent<HTMLInputElement>) => setTitle(event.target.value)} helperText={`${title.trim().length}/240`} slotProps={{ htmlInput: { maxLength: 240 } }} />
          <TextField label="合集说明" value={description} onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setDescription(event.target.value)} multiline minRows={4} helperText={`${description.length}/4000`} slotProps={{ htmlInput: { maxLength: 4000 } }} />
          <FormControl>
            <InputLabel id="article-collection-visibility-label">谁可以看</InputLabel>
            <Select labelId="article-collection-visibility-label" label="谁可以看" value={visibility} onChange={(event: { target: { value: string } }) => setVisibility(event.target.value as ArticleCollectionVisibility)}>
              <MenuItem value="PRIVATE">仅自己可见</MenuItem>
              <MenuItem value="MEMBERS">书库成员可见</MenuItem>
            </Select>
          </FormControl>
          {visibility === "MEMBERS" && <Alert severity={lockedSharedVisibility ? "warning" : "info"}>{lockedSharedVisibility ? "请先从合集移出私密文章，再向书库成员共享。" : "共享合集只能包含书库成员可以阅读的文章。"}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        {initial && onDeleted && <Button color="error" disabled={busy} onClick={() => setConfirmDelete(true)} sx={{ mr: "auto" }}>删除合集</Button>}
        <Button onClick={onClose} disabled={busy}>取消</Button>
        <Button variant="contained" onClick={() => void save()} disabled={busy || titleError || descriptionError || lockedSharedVisibility}>{initial ? "保存" : "创建合集"}</Button>
      </DialogActions>
    </Dialog>

    <Dialog open={open && confirmDelete} onClose={busy ? undefined : () => setConfirmDelete(false)} fullWidth maxWidth="xs">
      <DialogTitle>删除“{initial?.title}”？</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: `${tokens.spacing[4]}px` }}>{error}</Alert>}
        <Typography>删除合集会清除其中的文章排序。文章、阅读记录和笔记会保留。</Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => setConfirmDelete(false)} disabled={busy}>取消</Button>
        <Button color="error" variant="contained" onClick={() => void remove()} disabled={busy}>删除合集</Button>
      </DialogActions>
    </Dialog>
  </>;
}
