// 轮询显示后台文件任务阶段与结果，排队或执行中状态不当作完成。
// Polls background file-operation stages/results without treating queued or running work as complete.
import { EmptyState } from "../ui/empty-state";
import { Alert, Chip } from "../ui/feedback";
import { RefreshButton } from "../ui/buttons";
import { Box, Stack, Typography } from "../ui/primitives";
import { DataTable, Pagination, Skeleton } from "../ui/antd";
import { MobileRecordCard, MobileRecordField, useIsMobileViewport } from "../ui/ResponsiveList";
import { paginationControlProps, tablePaginationDefaults } from "../ui/table-pagination";
import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { ActionToolbar, PageContainer } from "../components/PageHeader";
import type { FileTaskHistoryItem, FileTaskHistoryStatus, FileOperationType } from "../domain/types";
import { tokens } from "../theme/tokens";

const operationLabels: Record<FileOperationType, string> = {
  RENAME: "重命名",
  MOVE: "移动",
  TRASH: "移入回收站",
  RESTORE: "恢复",
  WRITE_METADATA: "将书目信息写入文件",
  PURGE: "永久清理",
};

const statusMeta: Record<FileTaskHistoryStatus, { label: string; color: "default" | "success" | "warning" | "error" }> = {
  PLANNED: { label: "等待执行", color: "default" },
  RUNNING: { label: "执行中", color: "warning" },
  SUCCEEDED: { label: "已完成", color: "success" },
  FAILED: { label: "失败", color: "error" },
  ROLLED_BACK: { label: "已撤销更改", color: "warning" },
  RECEIVING: { label: "接收中", color: "warning" },
  INSPECTING: { label: "检查中", color: "warning" },
  ENRICHING: { label: "补全中", color: "warning" },
  READY_FOR_REVIEW: { label: "待确认", color: "default" },
  COMMITTING: { label: "入库中", color: "warning" },
  DUPLICATE: { label: "重复文件", color: "default" },
  CANCELLED: { label: "已取消", color: "default" },
  EXPIRED: { label: "已过期", color: "default" },
};

const runningStageLabels: Record<string, string> = {
  ATOMIC_MOVE: "正在移动",
  CHECKING_SPACE: "检查空间",
  COPYING: "正在复制",
  VERIFYING_SHA256: "校验文件",
  FINALIZING_TARGET: "正在保存到目标位置",
  TRASHING_SOURCE: "清理源文件",
  ATOMIC_TRASH: "移入回收站",
  PREPARING_OVERWRITE: "准备写回",
};

const formatCreatedAt = (createdAt: string) => new Intl.DateTimeFormat("zh-CN", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
}).format(new Date(createdAt));

export function FileOperationsPage() {
  const isMobile = useIsMobileViewport();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(5);
  const query = useQuery({ queryKey: ["file-task-history", page, pageSize], queryFn: () => api.listFileTaskHistoryPage(page - 1, pageSize), placeholderData: keepPreviousData, refetchInterval: 5000 });
  useEffect(() => {
    if (query.data && !query.isPlaceholderData) {
      const last = Math.max(1, Math.ceil(query.data.total / pageSize));
      if (page > last) setPage(last);
    }
  }, [page, pageSize, query.data, query.isPlaceholderData]);
  const items = query.data?.items ?? [];
  const total = query.data?.total ?? 0;
  const getTaskLabel = (operation: FileTaskHistoryItem) =>
    operation.type === "BOOK_UPLOAD" ? "上传书籍" : operation.action ? operationLabels[operation.action] : "文件操作";
  const renderStatus = (operation: FileTaskHistoryItem, align: "flex-start" | "flex-end") => (
    <Stack spacing={1} sx={{ alignItems: align }}>
      <Chip size="small" variant="outlined" color={statusMeta[operation.status].color} label={statusMeta[operation.status].label} />
      {operation.status === "RUNNING" && operation.stage && (
        <Typography variant="caption" color="text.secondary">{runningStageLabels[operation.stage] ?? "正在处理"}</Typography>
      )}
    </Stack>
  );
  const handlePageChange = (next: number, size: number) => {
    setPage(size === pageSize ? next : 1);
    setPageSize(size);
  };
  return <PageContainer>
    <Stack sx={{ mb: 2 }}><ActionToolbar><RefreshButton onClick={() => query.refetch()} disabled={query.isFetching}>刷新</RefreshButton></ActionToolbar></Stack>
    {query.isError ? <Alert severity="error">无法加载文件操作记录，请刷新重试。</Alert> : isMobile ? (
      items.length === 0 && query.isPending ? <Skeleton active /> : items.length === 0 ? (
        <Stack spacing={1}>
          <EmptyState title="暂无文件操作记录" padded={false} />
          <Typography color="text.secondary" sx={{ textAlign: "center" }}>书籍操作与上传任务会显示在这里。</Typography>
        </Stack>
      ) : (
        <Stack spacing={2}>
          <Stack component="section" aria-label="文件操作记录" spacing={2}>
            {items.map((operation) => (
              <MobileRecordCard key={`${operation.type}:${operation.id}`} aria-label={`${getTaskLabel(operation)} ${operation.title}`}>
                <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "flex-start", gap: 1.5 }}>
                  <Typography sx={{ fontWeight: tokens.typography.fontWeight.semibold, minWidth: 0, overflowWrap: "anywhere" }}>
                    {getTaskLabel(operation)}
                  </Typography>
                  <Box sx={{ flexShrink: 0 }}>{renderStatus(operation, "flex-end")}</Box>
                </Stack>
                <MobileRecordField label="书籍" value={operation.title} />
                <MobileRecordField label="时间" value={formatCreatedAt(operation.createdAt)} />
              </MobileRecordCard>
            ))}
          </Stack>
          {total > 0 && (
            <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
              <Pagination
                {...paginationControlProps(tablePaginationDefaults)}
                current={page}
                pageSize={pageSize}
                total={total}
                disabled={query.isFetching}
                onChange={handlePageChange}
              />
            </Box>
          )}
        </Stack>
      )
    ) : <DataTable<FileTaskHistoryItem>
      aria-label="文件操作记录" rowKey={(record) => `${record.type}:${record.id}`} loading={query.isFetching} dataSource={items}
      scroll={{ x: tokens.layout.touchTarget * 16 }}
      locale={{ emptyText: <Stack spacing={1}><EmptyState title="暂无文件操作记录" padded={false} /><Typography color="text.secondary">书籍操作与上传任务会显示在这里。</Typography></Stack> }}
      pagination={{ current: page, pageSize, total, disabled: query.isFetching, onChange: handlePageChange }}
      columns={[
        { title: "任务", key: "type", render: (_, operation) => <Typography sx={{ fontWeight: tokens.typography.fontWeight.semibold }}>{getTaskLabel(operation)}</Typography> },
        { title: "书籍", key: "book", render: (_, operation) => <Typography variant="body2" sx={{ overflowWrap: "anywhere" }}>{operation.title}</Typography> },
        { title: "状态", key: "status", render: (_, operation) => renderStatus(operation, "flex-start") },
        { title: "时间", key: "time", align: "right", render: (_, operation) => <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: "nowrap" }}>{formatCreatedAt(operation.createdAt)}</Typography> },
      ]} />}
  </PageContainer>;
}
