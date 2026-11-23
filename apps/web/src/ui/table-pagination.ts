import { useEffect, useState } from "react";
import type { TablePaginationConfig } from "antd/es/table";

/** Shared native Ant Design pager for tables and their mobile card presentations. */
export const tablePaginationDefaults: TablePaginationConfig = {
  defaultPageSize: 5,
  pageSizeOptions: [5, 10, 20, 50],
  showSizeChanger: true,
  showQuickJumper: true,
  showLessItems: true,
  hideOnSinglePage: false,
  responsive: true,
  placement: ["bottomEnd"],
  showTotal: (total) => `共 ${total} 条`,
};

export function paginationControlProps({ placement: _placement, position: _position, ...props }: TablePaginationConfig) { return props; }

export function useTablePagination(total: number, initialPageSize = 5) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const current = Math.min(page, Math.max(1, Math.ceil(total / pageSize)));
  useEffect(() => { if (page !== current) setPage(current); }, [current, page]);
  const pagination: TablePaginationConfig = { ...tablePaginationDefaults, current, pageSize, total,
    onChange: (next, size) => { setPage(size === pageSize ? next : 1); setPageSize(size); } };
  return { pagination, offset: (current - 1) * pageSize, pageSize };
}
