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

export function sheetStatusLooksApplied(status: string): boolean {
  return /^\s*applied\b/i.test(String(status || "").trim());
}

export function formatApplicationDate(date = new Date()): string {
  return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
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

export async function fetchSheetJobRows(config: SheetConfig): Promise<SheetJobRow[]> {
  const spreadsheetId = extractSpreadsheetId(config.spreadsheetUrl);
  if (!spreadsheetId) throw new Error("Invalid Google Spreadsheet link.");

  const parsed = await postSheetWebApp(config.sheetsWebAppUrl, sheetPayload(config, {
    action: "listRows",
    spreadsheetId,
  }));

  // Fallback for older Apps Script deployments without listRows
  if (!Array.isArray(parsed.rows)) {
    const legacy = await postSheetWebApp(config.sheetsWebAppUrl, sheetPayload(config, {
      action: "listLinks",
      spreadsheetId,
    }));
    const linkStatuses = Array.isArray(legacy.linkStatuses)
      ? (legacy.linkStatuses as Array<{ link?: string; status?: string }>)
      : [];
    const companyRows = Array.isArray(legacy.companyRows)
      ? (legacy.companyRows as Array<{ company?: string; link?: string }>)
      : [];
    const companyByLink = new Map(
      companyRows.map((r) => [normalizeJobLink(String(r.link || "")), String(r.company || "")])
    );
    return linkStatuses
      .map((row) => {
        const link = String(row.link || "").trim();
        return {
          title: "",
          company: companyByLink.get(normalizeJobLink(link)) || "",
          link,
          salary: "",
          status: String(row.status || "").trim(),
        };
      })
      .filter((r) => r.link);
  }

  return (parsed.rows as SheetJobRow[])
    .map((row) => ({
      row: row.row,
      jobNo: String(row.jobNo || "").trim(),
      date: String(row.date || "").trim(),
      title: String(row.title || "").trim(),
      company: String(row.company || "").trim(),
      link: String(row.link || "").trim(),
      salary: String(row.salary || "").trim(),
      status: String(row.status || "").trim(),
    }))
    .filter((r) => r.link || r.title || r.company);
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
