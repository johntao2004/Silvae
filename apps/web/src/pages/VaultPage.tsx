// 访问由会话绑定的 2FA 授权；内容密钥仅在当前已验证页面的内存中使用。
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { _AntAlert as Alert, Skeleton } from "../ui/antd";
import { Button } from "../ui/buttons";
import { useConfirmation } from "../ui/confirmations";
import { Box } from "@/ui/primitives";
import { BookCardPresentation } from "../components/BookCardPresentation";
import { bookGridSx } from "../components/bookGrid";
import { BookCatalogEmptyState } from "../components/BookCatalogEmptyState";
import { CatalogSection } from "../components/CatalogSection";
import { CatalogFilters } from "../components/CatalogFilters";
import { PageContainer, PageHeader } from "../components/PageHeader";
import { vaultApi } from "../features/vault/api";
import { ApiRequestError } from "../api/client";
import { b64, unb64 } from "../features/vault/crypto";
import { importVaultFile, unlockObjects, type UnlockedObject } from "../features/vault/files";
import { VaultAccessGate } from "../features/vault/VaultAccessGate";
import { useAuth } from "../auth/AuthContext";
import { usePermissions } from "../auth/permissions";
import { deviceKeys } from "../features/vault/device-keys";
import "../features/content/content.css";

const VaultReader = lazy(() => import("../features/vault/VaultReader").then((module) => ({ default: module.VaultReader })));

export function VaultPage() {
  return <VaultAccessGate><VaultContent /></VaultAccessGate>;
}
function VaultContent() {
  const modal = useConfirmation();
  const { user } = useAuth();
  const { can } = usePermissions();
  const canRead = can("vault.read");
  const canUpload = can("vault.upload");
  const canDelete = can("vault.delete");
  const permissions = useRef({ read: canRead, upload: canUpload, delete: canDelete });
  permissions.current = { read: canRead, upload: canUpload, delete: canDelete };
  const userId = user?.id;
  const [opening, setOpening] = useState(true), [openingError, setOpeningError] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [master, setMaster] = useState<Uint8Array | null>(null);
  const [items, setItems] = useState<UnlockedObject[]>([]);
  const uploadInput = useRef<HTMLInputElement>(null);
  const key = useRef<Uint8Array | null>(null), epoch = useRef(0);
  const operation = useRef<AbortController | null>(null);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0), [selected, setSelected] = useState<string | null>(null);
  const lock = useCallback(() => {
    epoch.current++;
    operation.current?.abort(); operation.current = null;
    setSelected(null); setMaster(null);
    key.current?.fill(0); key.current = null;
    setItems([]); setBusy(false);
    window.dispatchEvent(new Event("humite:vault-lock"));
  }, []);
  useEffect(() => {
    window.addEventListener("humite:session-expired", lock);
    window.addEventListener("pagehide", lock);
    return () => {
      window.removeEventListener("humite:session-expired", lock);
      window.removeEventListener("pagehide", lock);
    };
  }, [lock]);
  const run = async (fn: (revision: number) => Promise<void>) => {
    const revision = epoch.current;
    setBusy(true); setError("");
    try { await fn(revision); }
    catch (reason) { if (revision === epoch.current) setError(reason instanceof Error ? reason.message : "操作失败"); }
    finally { if (revision === epoch.current) setBusy(false); }
  };
  useEffect(() => {
    if (!canUpload) {
      operation.current?.abort();
      if (!canRead) { key.current?.fill(0); key.current = null; setMaster(null); }
    }
  }, [canRead, canUpload]);
  useEffect(() => {
    const controller = new AbortController(), revision = epoch.current;
    if (!canRead) {
      setOpening(false); setOpeningError(""); setSelected(null); setItems([]);
      key.current?.fill(0); key.current = null; setMaster(null);
      return () => {
        epoch.current++; controller.abort(); operation.current?.abort();
        key.current?.fill(0); key.current = null;
      };
    }
    setOpening(true); setOpeningError("");
    void (async () => {
      if (!userId) throw new Error("请重新登录后进入加密书库。");
      if (!window.isSecureContext || !crypto.subtle) throw new Error("请通过 HTTPS 或本机 localhost 打开加密书库。");
      let access: Awaited<ReturnType<typeof vaultApi.open>>;
      try { access = await vaultApi.open(); }
      catch (reason) {
        if (!(reason instanceof ApiRequestError) || reason.code !== "VAULT_LEGACY_KEY_REQUIRED") throw reason;
        const config = await vaultApi.config();
        controller.signal.throwIfAborted();
        const remembered = await deviceKeys.restore(userId, config.envelope, controller.signal);
        if (!remembered) throw reason;
        try {
          controller.signal.throwIfAborted();
          // A previous browser can migrate its actual content key without asking for a password.
          await unlockObjects(remembered.master);
          controller.signal.throwIfAborted();
          access = await vaultApi.migrateKey(b64(remembered.master), config.revision);
        } finally { remembered.master.fill(0); }
      }
      const bytes = unb64(access.key);
      try {
        controller.signal.throwIfAborted();
        if (bytes.length !== 32) throw new Error("无法解锁书库，请联系站点所有者检查加密配置。");
        const list = await unlockObjects(bytes);
        if (revision !== epoch.current || controller.signal.aborted) return;
        key.current?.fill(0); key.current = bytes;
        setItems(list); setMaster(bytes);
      } finally { if (key.current !== bytes) bytes.fill(0); }
    })().catch(reason => {
      if (revision === epoch.current && !controller.signal.aborted) setOpeningError(reason instanceof Error ? reason.message : "无法打开加密书库，请重试。");
    }).finally(() => { if (revision === epoch.current && !controller.signal.aborted) setOpening(false); });
    return () => {
      epoch.current++; controller.abort(); operation.current?.abort();
      key.current?.fill(0); key.current = null;
    };
  }, [canRead, loadAttempt, userId]);
  const current = items.find(item => item.id === selected);
  return <PageContainer>
    <PageHeader title={current ? current.metadata.title : "加密书库"} action={<Button onClick={lock}>锁定书库</Button>} />
    <div className="bk-content-stack">
      {error && <Alert type="error" title={error} closable onClose={() => setError("")} />}
      {opening ? <Skeleton active /> : openingError ? <Alert type="error" title={openingError} action={<Button onClick={() => setLoadAttempt(value => value + 1)}>重试</Button>} />
        : current && master && canRead ? <Suspense fallback={<Skeleton active />}><VaultReader key={current.id} item={current} master={master} onClose={() => setSelected(null)}
          onState={(reading, revision) => { if (key.current === master) setItems(previous => previous.map(item => item.id === current.id ? { ...item, reading, revision } : item)); }} /></Suspense>
          : <>
            <CatalogSection title="加密书籍" tools={<CatalogFilters
              actions={canUpload ? <Button variant="contained" disabled={busy} onClick={() => { if (canUpload) uploadInput.current?.click(); }} sx={{ whiteSpace: "nowrap" }}>上传书籍</Button> : undefined}
            />}>
              <input ref={uploadInput} hidden disabled={busy || !canUpload} type="file" accept=".epub,.pdf" onChange={event => {
                const file = event.target.files?.[0]; event.target.value = ""; if (!file || !canUpload) return;
                void run(async revision => {
                  const controller = new AbortController(); operation.current = controller;
                  let activeMaster = key.current;
                  if (!permissions.current.upload) return;
                  if (!activeMaster) {
                    const access = await vaultApi.open();
                    activeMaster = unb64(access.key);
                    if (activeMaster.length !== 32) { activeMaster.fill(0); throw new Error("无法解锁书库，请联系站点所有者检查加密配置。"); }
                    if (revision !== epoch.current || !permissions.current.upload) { activeMaster.fill(0); return; }
                    key.current = activeMaster; setMaster(activeMaster);
                  }
                  if (!permissions.current.upload) return;
                  await importVaultFile(file, activeMaster, setProgress, controller.signal);
                  const list = permissions.current.read ? await unlockObjects(activeMaster) : null;
                  if (revision === epoch.current && permissions.current.read && list) setItems(list);
                });
              }} />
              {busy && <p role="status">正在加密导入 {Math.round(progress * 100)}%</p>}
              {!canRead ? <BookCatalogEmptyState title={canUpload ? "你可以上传书籍，浏览和阅读需要额外权限" : "当前账号没有浏览和阅读权限"} />
                : !items.length ? <BookCatalogEmptyState title="还没有加密书籍" />
                  : <Box sx={bookGridSx}>{items.map(item => <BookCardPresentation key={item.id}
                    book={{ id: item.id, title: item.metadata.title, author: `${item.metadata.format} · 已读 ${Math.round(item.reading.progress * 100)}%` }}
                    onOpen={() => { if (permissions.current.read) setSelected(item.id); }} onRead={() => { if (permissions.current.read) setSelected(item.id); }} actions={canDelete ? [{ label: "永久删除", danger: true, onClick: () => {
                      if (!permissions.current.delete) return;
                      modal.confirm({
                      title: "永久删除此加密书籍及其阅读记录？", okText: "永久删除", cancelText: "取消", okButtonProps: { danger: true },
                      onOk: () => {
                        if (!permissions.current.delete) return;
                        return run(async () => { if (!permissions.current.delete) return; await vaultApi.remove(item.id); setItems(previous => previous.filter(value => value.id !== item.id)); });
                      },
                    });
                    } }] : []} />)}</Box>}
            </CatalogSection>
          </>}
    </div>
  </PageContainer>;
}
