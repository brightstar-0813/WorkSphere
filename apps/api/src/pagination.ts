export type ListMeta = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export function parsePagination(
  query: Record<string, unknown>,
  opts: { defaultPageSize?: number; maxPageSize?: number } = {},
) {
  const defaultPageSize = opts.defaultPageSize ?? 10;
  const maxPageSize = opts.maxPageSize ?? 100;
  const rawPage = typeof query.page === "string" ? Number.parseInt(query.page, 10) : NaN;
  const rawSize =
    typeof query.pageSize === "string" ? Number.parseInt(query.pageSize, 10) : NaN;
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
  const pageSize = Number.isFinite(rawSize)
    ? Math.min(maxPageSize, Math.max(1, rawSize))
    : defaultPageSize;
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

export function listMeta(total: number, page: number, pageSize: number): ListMeta {
  return {
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize) || 1),
  };
}
