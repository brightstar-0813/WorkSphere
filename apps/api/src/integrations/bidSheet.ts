/** Bid-bot compatible Google Sheet helpers (Apps Script web app). */

export type SheetJobRow = {
  row?: number;
  jobNo?: string;
  date?: string;
  title: string;
  company: string;
  link: string;
  salary: string;
  status: string;
};

export function extractSpreadsheetId(urlOrId: string): string {
  const raw = String(urlOrId || "").trim();
  if (!raw) return "";
  const fromUrl = raw.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (fromUrl) return fromUrl[1]!;
  if (/^[a-zA-Z0-9-_]+$/.test(raw)) return raw;
  return "";
}

export function normalizeJobLink(url: string): string {
  const raw = String(url || "").trim();
  if (!raw) return "";
  try {
    const u = new URL(raw);
    u.hash = "";
    for (const key of [...u.searchParams.keys()]) {
      const k = key.toLowerCase();
      if (
        k.startsWith("utm_") ||
        k === "fbclid" ||
        k === "gclid" ||
        k === "ref" ||
        k === "source"
      ) {
        u.searchParams.delete(key);
      }
    }
    u.hostname = u.hostname.toLowerCase();
    let path = u.pathname.replace(/\/+$/, "");
    if (!path) path = "/";
    const search = u.searchParams.toString();
    return `${u.protocol}//${u.hostname}${path}${search ? `?${search}` : ""}`.toLowerCase();
  } catch {
    return raw.replace(/\/+$/, "").toLowerCase();
  }
}

export function mapSheetStatusToBidStatus(
  status: string
): "DRAFT" | "SENT" | "SHORTLISTED" | "REJECTED" | "WITHDRAWN" | "WON" {
  const s = String(status || "").trim().toLowerCase();
  if (!s || /^ready\b/.test(s) || /^saved\b/.test(s)) return "DRAFT";
  if (/^applied\b/.test(s) || /^sent\b/.test(s)) return "SENT";
  if (/shortlist|interview|offer/.test(s)) return "SHORTLISTED";
  if (/reject|declin/.test(s)) return "REJECTED";
  if (/withdraw/.test(s)) return "WITHDRAWN";
  if (/\bwon\b|\bhired\b/.test(s)) return "WON";
  return "SENT";
}

export function sheetStatusLooksReady(status: string): boolean {
  const s = String(status || "").trim().toLowerCase();
  return !s || /^ready\b/.test(s) || /^saved\b/.test(s) || /^new\b/.test(s);
}

/**
 * Real job rows need a title, company, or link.
 * JD / listing link is optional — many recruiter-direct roles have none.
 * Status-only placeholders (blank rows pre-filled with "Ready") must not sync.
 */
export function isMeaningfulSheetJobRow(
  row: Pick<SheetJobRow, "title" | "company" | "link" | "salary" | "status">,
): boolean {
  const title = String(row.title || "").trim();
  const company = String(row.company || "").trim();
  const link = String(row.link || "").trim();
  const salary = String(row.salary || "").trim();

  if (normalizeJobLink(link)) return true;

  // Status / salary alone (empty job identity) — ignore Ready placeholders.
  if (!title && !company) return false;

  // Mis-mapped status text in the title column is not a job.
  if (!company && /^(ready|saved|new|applied)$/i.test(title)) return false;

  // Title and/or company are enough even with an empty Link / JD column.
  if (title && !/^(untitled role|untitled)$/i.test(title)) return true;
  if (company && !/^unknown$/i.test(company)) return true;
  if (salary && (title || company)) return true;
  return false;
}

export function sheetStatusLooksApplied(status: string): boolean {
  return /^\s*applied\b/i.test(String(status || "").trim());
}

export function formatApplicationDate(date = new Date()): string {
  return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
}

/** Parse sheet "Created Date" (M/D/YYYY, D/M/YYYY, YYYY-MM-DD, etc.) as local midnight. */
export function parseSheetDate(raw?: string | null): Date | null {
  const s = String(raw || "").trim();
  if (!s) return null;
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) {
    const y = Number(iso[1]);
    const m = Number(iso[2]);
    const d = Number(iso[3]);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return new Date(y, m - 1, d, 0, 0, 0, 0);
    }
  }
  const slash = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/);
  if (slash) {
    let a = Number(slash[1]);
    let b = Number(slash[2]);
    let y = Number(slash[3]);
    if (y < 100) y += 2000;
    // Prefer M/D/Y (US sheet convention); if first part > 12 treat as D/M/Y.
    let month = a;
    let day = b;
    if (a > 12 && b <= 12) {
      day = a;
      month = b;
    }
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return new Date(y, month - 1, day, 0, 0, 0, 0);
    }
  }
  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) {
    return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate(), 0, 0, 0, 0);
  }
  return null;
}

type SheetConfig = {
  spreadsheetUrl: string;
  sheetsWebAppUrl: string;
  /** Spreadsheet tab / sheet name for this hunting profile */
  sheetTabName?: string;
};

function sheetPayload(config: SheetConfig, extra: Record<string, unknown> = {}) {
  const sheetName = String(config.sheetTabName || "").trim();
  return {
    ...extra,
    ...(sheetName ? { sheetName } : {}),
  };
}

async function postSheetWebApp(webAppUrl: string, payload: Record<string, unknown>) {
  const endpoint = String(webAppUrl || "").trim();
  if (!endpoint || !/^https:\/\/script\.google\.com\//i.test(endpoint)) {
    throw new Error(
      "Paste the Apps Script Web App URL (Deploy → Web app). Spreadsheet share link alone cannot be written from the API."
    );
  }

  const response = await fetch(endpoint, {
    method: "POST",
    redirect: "follow",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    parsed = null;
  }

  if (!response.ok) {
    throw new Error(String(parsed?.error || `Sheet request failed (HTTP ${response.status}).`));
  }
  if (parsed && parsed.ok === false) {
    throw new Error(String(parsed.error || "Sheet request failed."));
  }

  return parsed || { ok: true };
}

/** Older Apps Script treated unknown actions as append and returned these flags (no rows). */
function isAppendShapedResponse(parsed: Record<string, unknown>): boolean {
  return (
    !Array.isArray(parsed.rows) &&
    (parsed.duplicate === true ||
      parsed.duplicate === false ||
      parsed.appended === true ||
      parsed.updated === true)
  );
}

function hasListPayload(parsed: Record<string, unknown>): boolean {
  return (
    Array.isArray(parsed.rows) ||
    Array.isArray(parsed.linkStatuses) ||
    Array.isArray(parsed.links) ||
    Array.isArray(parsed.companyRows)
  );
}

function advertisesListRows(parsed: Record<string, unknown>): boolean {
  if (parsed.supportsListRows === true) return true;
  const caps = parsed.capabilities;
  if (Array.isArray(caps) && caps.some((c) => String(c).toLowerCase() === "listrows")) {
    return true;
  }
  // Some deployments return full rows from listLinks itself.
  return Array.isArray(parsed.rows);
}

/** Normalize partial sheet rows — missing title/company/link/salary/date are fine. */
export function normalizeSheetJobRows(rows: unknown[]): SheetJobRow[] {
  return rows
    .map((raw) => {
      const row = (raw && typeof raw === "object" ? raw : {}) as Partial<SheetJobRow> &
        Record<string, unknown>;
      const rowNum = row.row;
      return {
        row: typeof rowNum === "number" && Number.isFinite(rowNum) ? rowNum : undefined,
        jobNo: String(row.jobNo ?? row.no ?? "").trim(),
        date: String(row.date ?? row.createdDate ?? row.applicationDate ?? "").trim(),
        title: String(row.title ?? row.jobTitle ?? row.role ?? "").trim(),
        company: String(row.company ?? row.companyName ?? "").trim(),
        link: String(row.link ?? row.jobLink ?? row.url ?? "").trim(),
        salary: String(row.salary ?? row.pay ?? row.compensation ?? "").trim(),
        status: String(row.status ?? row.applyStatus ?? "").trim(),
      };
    })
    .filter((r) => isMeaningfulSheetJobRow(r));
}

function rowsFromListLinksPayload(legacy: Record<string, unknown>): SheetJobRow[] {
  if (Array.isArray(legacy.rows)) {
    return normalizeSheetJobRows(legacy.rows);
  }

  type LinkStatusRow = {
    link?: string;
    status?: string;
    title?: string;
    company?: string;
    salary?: string;
    date?: string;
    row?: number;
  };
  const linkStatuses: LinkStatusRow[] = Array.isArray(legacy.linkStatuses)
    ? (legacy.linkStatuses as LinkStatusRow[])
    : Array.isArray(legacy.links)
      ? (legacy.links as unknown[]).map((item) =>
          typeof item === "string" ? { link: item, status: "" } : (item as LinkStatusRow)
        )
      : [];
  const companyRows = Array.isArray(legacy.companyRows)
    ? (legacy.companyRows as Array<{ company?: string; link?: string; title?: string }>)
    : [];
  const companyByLink = new Map(
    companyRows.map((r) => [normalizeJobLink(String(r.link || "")), String(r.company || "").trim()])
  );
  const titleByLink = new Map(
    companyRows.map((r) => [normalizeJobLink(String(r.link || "")), String(r.title || "").trim()])
  );

  return normalizeSheetJobRows(
    linkStatuses.map((row) => {
      const link = String(row.link || "").trim();
      const key = normalizeJobLink(link);
      return {
        row: row.row,
        title: String(row.title || titleByLink.get(key) || "").trim(),
        company: String(row.company || companyByLink.get(key) || "").trim(),
        link,
        salary: String(row.salary || "").trim(),
        date: String(row.date || "").trim(),
        status: String(row.status || "").trim(),
      };
    })
  );
}

/**
 * Fetch job rows from the bid-bot Apps Script web app.
 * Uses listLinks first (safe on older deployments). Calls listRows only when the
 * web app advertises support — avoids unknown-action → blank Ready appends.
 * Missing columns/fields are tolerated; only empty placeholder rows are dropped.
 */
export async function fetchSheetJobRows(config: SheetConfig): Promise<SheetJobRow[]> {
  const spreadsheetId = extractSpreadsheetId(config.spreadsheetUrl);
  if (!spreadsheetId) throw new Error("Invalid Google Spreadsheet link.");

  // 1) Safe read — Brightstar bid-bot scripts have long supported listLinks.
  const legacy = await postSheetWebApp(
    config.sheetsWebAppUrl,
    sheetPayload(config, { action: "listLinks", spreadsheetId })
  );

  if (isAppendShapedResponse(legacy) && !hasListPayload(legacy)) {
    throw new Error(
      "Apps Script web app cannot list sheet rows (unknown actions fall through to append). Redeploy apps-script/Code.gs, then sync again."
    );
  }

  // Prefer full rows already returned by listLinks (newer Code.gs).
  if (Array.isArray(legacy.rows)) {
    return normalizeSheetJobRows(legacy.rows);
  }

  // Call listRows only when advertised but rows were not included in listLinks.
  if (advertisesListRows(legacy)) {
    try {
      const parsed = await postSheetWebApp(
        config.sheetsWebAppUrl,
        sheetPayload(config, { action: "listRows", spreadsheetId })
      );
      if (Array.isArray(parsed.rows)) {
        return normalizeSheetJobRows(parsed.rows);
      }
      // Advertised but empty/malformed — fall through to listLinks payload.
    } catch {
      // Keep listLinks data so sync still succeeds with partial fields.
    }
  }

  // Partial-field sync from listLinks (link/status/company; title/salary/date may be blank).
  const fromLinks = rowsFromListLinksPayload(legacy);
  if (fromLinks.length > 0 || hasListPayload(legacy)) {
    return fromLinks;
  }

  // Empty sheet is a valid sync result.
  return [];
}

export async function appendJobToSpreadsheet(
  config: SheetConfig,
  job: {
    jobTitle: string;
    companyName: string;
    jdLink?: string;
    salary?: string;
    status?: string;
  }
) {
  const spreadsheetId = extractSpreadsheetId(config.spreadsheetUrl);
  if (!spreadsheetId) throw new Error("Invalid Google Spreadsheet link.");

  return postSheetWebApp(config.sheetsWebAppUrl, sheetPayload(config, {
    action: "append",
    spreadsheetId,
    jobNo: "",
    applicationDate: formatApplicationDate(),
    jobTitle: job.jobTitle || "",
    companyName: job.companyName || "",
    jobLink: job.jdLink || "",
    salary: job.salary || "",
    status: job.status || "Ready",
  }));
}

export async function markJobAppliedOnSpreadsheet(
  config: SheetConfig,
  job: {
    jobTitle: string;
    companyName: string;
    jdLink?: string;
    salary?: string;
    status?: string;
  }
) {
  const spreadsheetId = extractSpreadsheetId(config.spreadsheetUrl);
  if (!spreadsheetId) throw new Error("Invalid Google Spreadsheet link.");

  return postSheetWebApp(config.sheetsWebAppUrl, sheetPayload(config, {
    action: "markApplied",
    spreadsheetId,
    jobNo: "",
    applicationDate: formatApplicationDate(),
    jobTitle: job.jobTitle || "",
    companyName: job.companyName || "",
    jobLink: job.jdLink || "",
    salary: job.salary || "",
    status: job.status || `Applied ${formatApplicationDate()}`,
  }));
}
