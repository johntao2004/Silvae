import { usePermissions } from "../auth/permissions";
// 管理会话列表从服务端获取到期状态，界面显示不替代会话失效执行。
// Session management reads server expiry state; presentation does not perform server-side expiration.
import { EmptyState } from "../ui/empty-state";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type ActiveSession } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { RevokeSessionsDialog } from "../components/RevokeSessionsDialog";
import { ActionToolbar } from "../components/PageHeader";
import { tokens } from "../theme/tokens";
import { DataTable, Pagination, Skeleton } from "../ui/antd";
import { Button, RefreshButton } from "../ui/buttons";
import { Alert, Chip } from "../ui/feedback";
import { Box, Stack, Typography } from "../ui/primitives";
import { MobileRecordCard, MobileRecordField, useIsMobileViewport } from "../ui/ResponsiveList";
import { paginationControlProps, useTablePagination } from "../ui/table-pagination";

const date = (value: string) => new Date(value).toLocaleString("zh-CN", { hour12: false });

export function ActiveSessionsPage() {
  const { can } = usePermissions();
  const { user } = useAuth();
  const client = useQueryClient();
  const isMobile = useIsMobileViewport();
  const query = useQuery({
    queryKey: ["active-sessions"],
    queryFn: api.activeSessions,
    refetchInterval: 10000,
  });
  const [target, setTarget] = useState<{ id: string; displayName: string } | null>(null);
  const canRevoke = (session: ActiveSession) =>
    can("settings.sessions.revoke")
    && session.userId !== user?.id
    && session.role !== "OWNER"
    && (user?.role === "OWNER" || session.role === "MEMBER");
  const sessions = query.data ?? [];
  const { pagination, offset, pageSize } = useTablePagination(sessions.length);
  const mobilePagination = paginationControlProps(pagination);

  return (
    <>
      <Stack sx={{ mb: 2 }}>
        <ActionToolbar>
          <RefreshButton onClick={() => void query.refetch()} disabled={query.isFetching}>
            刷新
          </RefreshButton>
        </ActionToolbar>
      </Stack>
      {query.isError ? (
        <Alert severity="error">无法读取登录会话，请刷新重试。</Alert>
      ) : isMobile ? (
        query.isPending ? (
          <Skeleton active />
        ) : sessions.length === 0 ? (
          <EmptyState compact title="没有有效的登录会话" />
        ) : (
          <Stack spacing={2}>
            <Stack component="section" aria-label="登录会话" spacing={2}>
              {sessions.slice(offset, offset + pageSize).map((s) => (
                <MobileRecordCard key={s.id} aria-label={`${s.displayName}（${s.username}）`}>
                  <Stack
                    direction="row"
                    sx={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 1 }}
                  >
                    <Typography
                      variant="subtitle1"
                      sx={{
                        fontWeight: tokens.typography.fontWeight.semibold,
                        overflowWrap: "anywhere",
                        minWidth: 0,
                      }}
                    >
                      {s.displayName}（{s.username}）
                    </Typography>
                    {s.current && <Chip label="当前会话" size="small" />}
                  </Stack>
                  <MobileRecordField label="登录时间" value={date(s.createdAt)} />
                  <MobileRecordField label="最近活动" value={date(s.lastAccessAt)} />
                  <MobileRecordField label="到期时间" value={date(s.expiresAt)} />
                  <MobileRecordField label="状态" value={s.ending ? "正在保存并退出" : "已登录"} />
                  {canRevoke(s) && (
                    <Button
                      fullWidth
                      disabled={s.ending}
                      onClick={() => setTarget({ id: s.userId, displayName: s.displayName })}
                      sx={{ minHeight: `${tokens.layout.touchTarget}px` }}
                    >
                      让此用户退出登录
                    </Button>
                  )}
                </MobileRecordCard>
              ))}
            </Stack>
            <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
              <Pagination {...mobilePagination} />
            </Box>
          </Stack>
        )
      ) : (
        <DataTable<ActiveSession>
          aria-label="登录会话"
          rowKey="id"
          loading={query.isPending}
          pagination={pagination}
          dataSource={sessions}
          scroll={{ x: true }}
          locale={{ emptyText: <EmptyState compact title="没有有效的登录会话" /> }}
          columns={[
            {
              title: "用户",
              key: "user",
              render: (_, s) => (
                <>
                  {s.displayName}（{s.username}）{s.current && <Chip label="当前会话" size="small" />}
                </>
              ),
            },
            { title: "登录时间", dataIndex: "createdAt", render: date },
            { title: "最近活动", dataIndex: "lastAccessAt", render: date },
            { title: "到期时间", dataIndex: "expiresAt", render: date },
            { title: "状态", key: "status", render: (_, s) => (s.ending ? "正在保存并退出" : "已登录") },
            {
              title: "操作",
              key: "action",
              render: (_, s) =>
                canRevoke(s) ? (
                  <Button
                    variant="outlined"
                    disabled={s.ending}
                    onClick={() => setTarget({ id: s.userId, displayName: s.displayName })}
                  >
                    让此用户退出登录
                  </Button>
                ) : (
                  "—"
                ),
            },
          ]}
        />
      )}
      <RevokeSessionsDialog
        target={target}
        onClose={() => setTarget(null)}
        onRevoked={() => void client.invalidateQueries({ queryKey: ["active-sessions"] })}
      />
    </>
  );
}
