/** Parse sf-job-capture style CSV / job payloads into WorkSphere fetch rows. */

export type CaptureJobInput = {
  externalId: string;
  title: string;
  company: string;
  sourceUrl: string | null;
  salary: string;
  description: string;
  platform: string;
  payloadJson: string;
};

function parseCsv(text: string): string[][] {
  const input = String(text || "").replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i]!;
    const next = input[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || (ch === "\r" && next === "\n")) {
      row.push(field);
      field = "";
      if (row.some((c) => c !== "")) rows.push(row);
      row = [];
      if (ch === "\r") i += 1;
    } else if (ch === "\r") {
      row.push(field);
      field = "";
      if (row.some((c) => c !== "")) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  row.push(field);
  if (row.some((c) => c !== "")) rows.push(row);
  return rows;
}

function formatSalary(row: Record<string, string>): string {
  const min = String(row.salary_min || "").trim();
  const max = String(row.salary_max || "").trim();
  const currency = String(row.salary_currency || "USD").trim();
  const unit = String(row.salary_unit || "").trim();
  if (!min && !max) return "";
  const range = min && max && min !== max ? `${min}–${max}` : min || max;
  return [range, currency, unit].filter(Boolean).join(" ");
}

export function normalizeCaptureBotUrl(url: string): string {
  return String(url || "")
    .trim()
    .replace(/\/+$/, "");
}

export function mapCaptureRecord(raw: Record<string, unknown>): CaptureJobInput | null {
  const title = String(raw.title || "").trim();
  const company = String(raw.organization || raw.company || "").trim();
  const url = String(raw.url || raw.sourceUrl || raw.link || "").trim();
  const id = String(raw.id || "").trim();
  if (!title && !company && !url) return null;

  const externalId =
    id ||
    (url
      ? `url:${url.toLowerCase().replace(/\/+$/, "")}`
      : `fp:${title.toLowerCase()}||${company.toLowerCase()}`);

  const salary =
    typeof raw.salary === "string" && raw.salary
      ? String(raw.salary)
      : formatSalary(raw as Record<string, string>);

  const description = String(raw.jd || raw.description || raw.job_description || "").trim();

  return {
    externalId,
    title: title || "Untitled role",
    company: company || "Unknown",
    sourceUrl: url || null,
    salary,
    description,
    platform: String(raw.source || raw.platform || "csv").trim() || "csv",
    payloadJson: JSON.stringify(raw),
  };
}

function csvEscape(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/** Export jobs as CSV with columns: title, company, link, salary, jd */
export function serializeCaptureCsv(
  jobs: Array<{
    title: string;
    company: string;
    sourceUrl?: string | null;
    salary: string;
    description: string;
  }>,
): string {
  const header = ["title", "company", "link", "salary", "jd"];
  const lines = [header.join(",")];
  for (const job of jobs) {
    lines.push(
      [
        csvEscape(job.title ?? ""),
        csvEscape(job.company ?? ""),
        csvEscape(job.sourceUrl ?? ""),
        csvEscape(job.salary ?? ""),
        csvEscape(job.description ?? ""),
      ].join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}

export function parseCaptureCsv(text: string): CaptureJobInput[] {
  const table = parseCsv(text);
  if (table.length < 2) return [];
  const headers = table[0]!.map((h) => h.trim().toLowerCase());
  const out: CaptureJobInput[] = [];
  for (let i = 1; i < table.length; i += 1) {
    const cells = table[i]!;
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = cells[idx] ?? "";
    });
    const mapped = mapCaptureRecord(row);
    if (mapped) out.push(mapped);
  }
  return out;
}

export async function fetchJobsFromCaptureBot(
  baseUrl: string,
  opts?: { status?: string; limit?: number }
): Promise<CaptureJobInput[]> {
  const root = normalizeCaptureBotUrl(baseUrl);
  if (!root) throw new Error("Capture bot URL is required.");
  if (!/^https?:\/\//i.test(root)) {
    throw new Error("Capture bot URL must start with http:// or https://");
  }

  const params = new URLSearchParams();
  if (opts?.status) params.set("status", opts.status);
  params.set("limit", String(opts?.limit ?? 500));
  const url = `${root}/api/jobs?${params}`;
  const res = await fetch(url, { method: "GET" });
  if (!res.ok) {
    throw new Error(`Capture bot request failed (HTTP ${res.status}). Is sf-job-capture running?`);
  }
  const body = (await res.json()) as { ok?: boolean; jobs?: unknown[]; error?: string };
  if (body.ok === false) {
    throw new Error(body.error || "Capture bot returned an error.");
  }
  const jobs = Array.isArray(body.jobs) ? body.jobs : [];
  return jobs
    .map((j) => mapCaptureRecord((j && typeof j === "object" ? j : {}) as Record<string, unknown>))
    .filter((j): j is CaptureJobInput => Boolean(j));
}
