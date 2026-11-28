// SPDX-License-Identifier: MulanPSL-2.0
import { useState } from "react";
import type { PaginationProps, PrimaryTableCol, TableRowData, TableSort } from "tdesign-react";

const pageSizeOptions = [20, 50, 100, 200];

export function useTablePagination(total: number): PaginationProps {
  const [page, setPage] = useState({ current: 1, pageSize: 50 });
  return {
    current: Math.min(page.current, Math.max(1, Math.ceil(total / page.pageSize))),
    pageSize: page.pageSize,
    pageSizeOptions,
    total,
    onChange: ({ current, pageSize }) => setPage({ current, pageSize }),
  };
}

export function useTableSort<T extends TableRowData>(
  data: T[],
  columns: PrimaryTableCol<T>[],
  initial: TableSort = [],
) {
  const [sort, setSort] = useState<TableSort>(initial);
  const sorts = Array.isArray(sort) ? sort : sort ? [sort] : [];
  const sorted = sorts.length
    ? [...data].sort((left, right) => {
        for (const item of sorts) {
          const compare = columns.find((column) => column.colKey === item.sortBy)?.sorter;
          if (typeof compare === "function") {
            const result = item.descending ? compare(right, left) : compare(left, right);
            if (result) return result;
          }
        }
        return 0;
      })
    : data;
  return { data: sorted, sort, onSortChange: setSort };
}
