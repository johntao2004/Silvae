import { useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { matchPath, useLocation, useNavigate } from "react-router-dom";
import { statusTitle } from "../ui/status-title";
import { ApiRequestError } from "../api/errors";
import { setupStatusQueryKey } from "../auth/setup-status";
import { useAuth } from "../auth/use-auth";
import { pageWidthSx } from "../components/PageHeader";
import { Button } from "../ui/buttons";
import { Stack, Typography } from "../ui/primitives";
import { tokens } from "../theme/tokens";
import './http-error-page.css';

export interface PageFailure { status?: number; code: string; reason: string; traceId?: string }
export function pageFailure(error: unknown): PageFailure {
  if (error instanceof ApiRequestError) return { status: error.status, code: error.code ?? `HTTP_${error.status}`, reason: error.message, traceId: error.traceId };
  return { code: "CONNECTION_ERROR", reason: error instanceof Error ? error.message : "暂时无法连接书库服务，请稍后重试。" };
}
const statusLabels: Record<number, string> = { 400: "请求有误", 401: "需要登录", 403: "权限受限", 404: "页面不存在", 405: "请求方式不支持", 408: "请求超时", 409: "内容已变化", 413: "文件过大", 415: "格式不支持", 422: "内容无法处理", 429: "请求过于频繁", 500: "服务器异常", 502: "服务连接异常", 503: "服务暂不可用", 504: "服务响应超时" };

/** Page-level failures retain their diagnostics until recovery. */
export function HttpErrorPage({ failure, title, actions, recovery, back, fullHeight = false, onReturnToLogin }: {
  failure: PageFailure; title?: string; actions?: ReactNode; recovery?: string; back?: ReactNode; fullHeight?: boolean;
  onReturnToLogin?: () => void;
}) {
  const requiresLogin = failure.code === "PASSWORD_CHANGE_REQUIRED";
  const label = requiresLogin ? "需要重新登录" : failure.status
    ? statusLabels[failure.status] ?? (failure.status >= 500 ? "服务器异常" : "请求无法完成")
    : "连接异常";
  const heading = statusTitle(title ?? label);
  return <Stack component="section" aria-label="错误页面" role="alert" sx={{ ...pageWidthSx,
    minHeight: fullHeight ? "100dvh" : `calc(100dvh - ${tokens.layout.navHeight}px)`,
    py: `${tokens.spacing[10]}px`, alignItems: "center", textAlign: "center", bgcolor: "background.default", color: "text.primary" }}>
    {back && <Stack sx={{ width: "100%", alignItems: "flex-start" }}>{back}</Stack>}
    <Stack sx={{ flex: 1, justifyContent: "center", width: "100%", maxWidth: tokens.layout.readingMax, alignItems: "center", gap: `${tokens.spacing[4]}px`, overflowWrap: "anywhere" }}>
      <Typography
        component="h1"
        className={failure.status ? "http-error-status" : "http-error-heading"}
        color={failure.status ? "primary.main" : undefined}
      >
        {failure.status ?? heading}
      </Typography>
      {failure.status && <Typography component="h2" className="http-error-label">{label}</Typography>}
      {failure.status && title && heading !== label && (
        <Typography className="http-error-subtitle" color="text.secondary">{heading}</Typography>
      )}
      <Typography className="http-error-reason">原因：{failure.reason}</Typography>
      <Stack className="http-error-diagnostics" spacing={1}>
        <Typography className="http-error-code">错误代码：{failure.code}</Typography>
        {failure.traceId && <Typography className="http-error-code">请求标识：{failure.traceId}</Typography>}
      </Stack>
      {recovery && <Typography color="text.secondary">{recovery}</Typography>}
      {requiresLogin ? <ReturnToLogin onReturned={onReturnToLogin} /> : actions && (
        <Stack direction={{ xs: "column", sm: "row" }} sx={{ width: { xs: "100%", sm: "auto" }, gap: `${tokens.spacing[3]}px` }}>{actions}</Stack>
      )}
    </Stack>
  </Stack>;
}

function ReturnToLogin({ onReturned }: { onReturned?: () => void }) {
  const { logout } = useAuth();
  const { pathname, search, hash, state } = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const returnToLogin = async () => {
    setPending(true);
    setError("");
    try {
      await logout();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "退出当前会话失败，请重试。");
      setPending(false);
      return;
    }

    const authPage = matchPath("/login", pathname) || matchPath("/change-password", pathname);
    const from = authPage ? (state as { from?: string } | null)?.from : `${pathname}${search}${hash}`;
    navigate("/login", { replace: true, state: { from } });
    if (queryClient.getQueryState(setupStatusQueryKey)?.status === "error") {
      void queryClient.resetQueries({ queryKey: setupStatusQueryKey, exact: true });
    }
    onReturned?.();
  };

  return <Stack spacing={2} sx={{ alignItems: "center" }}>
    {error && <Typography role="alert" color="error.main">{error}</Typography>}
    <Button variant="contained" onClick={() => void returnToLogin()} disabled={pending}>
      {pending ? "正在返回登录…" : "返回登录"}
    </Button>
  </Stack>;
}

export function RequestErrorPage({ error, onRetry, retrying = false, recovery, back }: { error: unknown; onRetry: () => void; retrying?: boolean; recovery?: string; back?: ReactNode }) {
  return <HttpErrorPage failure={pageFailure(error)} recovery={recovery} back={back}
    actions={<Button disabled={retrying} onClick={onRetry}>{retrying ? "正在重试…" : "重试"}</Button>} />;
}
