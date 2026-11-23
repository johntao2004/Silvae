// 按页读取登录审计结果，日志用于管理查看而不是认证判断。
// Reads login audits page by page for management review, not authentication decisions.
import { EmptyState } from "../ui/empty-state";
import { ActionToolbar } from "../components/PageHeader";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { tokens } from "../theme/tokens";
import { Alert, Chip } from "../ui/feedback";
import { RefreshButton } from "../ui/buttons";
import { DataTable, Pagination, Skeleton } from "../ui/antd";
import { Box, Stack, Typography } from "../ui/primitives";
import { MobileRecordCard, MobileRecordField, useIsMobileViewport } from "../ui/ResponsiveList";
import { paginationControlProps, tablePaginationDefaults } from "../ui/table-pagination";
import { api } from "../api/client";

type Entry = Awaited<ReturnType<typeof api.listLoginLogs>>["items"][number];

export function LoginLogsPage() {
  const isMobile = useIsMobileViewport();
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(5);
  const query = useQuery({
    queryKey: ["login-logs", page, pageSize],
    queryFn: () => api.listLoginLogs(page, pageSize),
  });
  const users = useQuery({ queryKey: ["users"], queryFn: api.listUsers });
  const resolveUserLabel = (entry: Entry) =>
    users.data?.find((user) => user.id === entry.actorId)?.username ?? entry.subjectId ?? "未知用户";
  const formatOccurredAt = (value: string) =>
    new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "medium" }).format(new Date(value));
  const handlePageChange = (p: number, size: number) => {
    setPage(size === pageSize ? p - 1 : 0);
    setPageSize(size);
  };
  const items = query.data?.items ?? [];
  const total = query.data?.total ?? 0;

  return (
    <>
      <Stack sx={{ mb: 2 }}>
        <ActionToolbar>
          <RefreshButton onClick={() => query.refetch()} disabled={query.isFetching}>
            刷新
          </RefreshButton>
        </ActionToolbar>
      </Stack>
      {query.isError ? (
        <Alert severity="error">无法读取登录日志，请重试。</Alert>
      ) : isMobile ? (
        query.isPending ? (
          <Skeleton active />
        ) : items.length === 0 ? (
          <EmptyState compact title="暂无登录日志" />
        ) : (
          <Stack spacing={2}>
            <Stack component="section" aria-label="登录日志" spacing={2}>
              {items.map((entry) => {
                const userLabel = resolveUserLabel(entry);
                return (
                  <MobileRecordCard key={entry.id} aria-label={userLabel}>
                    <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "center", gap: 1.5 }}>
                      <Typography
                        variant="subtitle1"
                        sx={{
                          fontWeight: tokens.typography.fontWeight.semibold,
                          minWidth: 0,
                          overflowWrap: "anywhere",
                        }}
                      >
                        {userLabel}
                      </Typography>
                      <Chip
                        size="small"
                        color={entry.outcome === "SUCCEEDED" ? "success" : "error"}
                        label={entry.outcome === "SUCCEEDED" ? "登录成功" : "登录失败"}
                        sx={{ flexShrink: 0 }}
                      />
                    </Stack>
                    <MobileRecordField label="来源 IP" value={entry.ip || "未记录"} />
                    <MobileRecordField label="登录时间" value={formatOccurredAt(entry.occurredAt)} />
                  </MobileRecordCard>
                );
              })}
            </Stack>
            {total > 0 && (
              <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
                <Pagination
                  {...paginationControlProps(tablePaginationDefaults)}
                  current={page + 1}
                  pageSize={pageSize}
                  total={total}
                  onChange={handlePageChange}
                />
              </Box>
            )}
          </Stack>
        )
      ) : (
        <DataTable<Entry>
          aria-label="登录日志"
          rowKey="id"
          loading={query.isPending}
          dataSource={items}
          scroll={{ x: true }}
          locale={{ emptyText: <EmptyState compact title="暂无登录日志" /> }}
          pagination={{ current: page + 1, pageSize, total, onChange: handlePageChange }}
          columns={[
            { title: "用户", key: "user", render: (_, entry) => resolveUserLabel(entry) },
            {
              title: "结果",
              key: "outcome",
              render: (_, entry) => (
                <Chip
                  size="small"
                  color={entry.outcome === "SUCCEEDED" ? "success" : "error"}
                  label={entry.outcome === "SUCCEEDED" ? "登录成功" : "登录失败"}
                />
              ),
            },
            { title: "来源 IP", dataIndex: "ip", render: (value) => value || "未记录" },
            { title: "登录时间", dataIndex: "occurredAt", render: formatOccurredAt },
          ]}
        />
      )}
    </>
  );
}
