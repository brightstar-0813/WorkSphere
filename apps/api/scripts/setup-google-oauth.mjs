/**
 * One-shot helper: opens Google Cloud Console to the OAuth client form and
 * watches Downloads for client_secret*.json, then writes apps/api/.env.
 *
 * Usage: node apps/api/scripts/setup-google-oauth.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exec } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(__dirname, "..");
const envPath = path.join(apiRoot, ".env");
const projectId = process.env.GCLOUD_PROJECT || "worksphere-cal-659275";
const redirectUri =
  process.env.GOOGLE_REDIRECT_URI ||
  "http://localhost:4000/api/v1/integrations/google/callback";
const downloads =
  process.env.USERPROFILE
    ? path.join(process.env.USERPROFILE, "Downloads")
    : path.join(process.env.HOME || "", "Downloads");

const consentUrl = `https://console.cloud.google.com/auth/overview?project=${projectId}`;
const createClientUrl = `https://console.cloud.google.com/auth/clients/create?project=${projectId}`;

function openUrl(url) {
  const cmd =
    process.platform === "win32"
      ? `start "" "${url}"`
      : process.platform === "darwin"
        ? `open "${url}"`
        : `xdg-open "${url}"`;
  exec(cmd);
}

function upsertEnv(key, value) {
  let text = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
  const line = `${key}="${value}"`;
  const re = new RegExp(`^#?\\s*${key}=.*$`, "m");
  if (re.test(text)) text = text.replace(re, line);
  else text = `${text.trimEnd()}\n${line}\n`;
  fs.writeFileSync(envPath, text);
}

function readClientJson(filePath) {
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const web = raw.web || raw.installed || raw;
  return {
    clientId: web.client_id,
    clientSecret: web.client_secret,
  };
}

console.log(`Project: ${projectId}`);
console.log(`Redirect URI to paste: ${redirectUri}`);
console.log("");
console.log("1) Configure consent screen (External / Testing) if prompted");
console.log("2) Create client → Web application");
console.log(`3) Add authorized redirect URI: ${redirectUri}`);
console.log("4) Create → Download JSON (or copy Client ID + Secret)");
console.log("");
console.log(`Watching ${downloads} for client_secret*.json ...`);

openUrl(consentUrl);
setTimeout(() => openUrl(createClientUrl), 1500);

const seen = new Set(fs.existsSync(downloads) ? fs.readdirSync(downloads) : []);
const started = Date.now();
const timer = setInterval(() => {
  if (!fs.existsSync(downloads)) return;
  const files = fs
    .readdirSync(downloads)
    .filter((f) => /^client_secret.*\.json$/i.test(f) || /^client_secret_.*\.apps\.googleusercontent\.com\.json$/i.test(f));
  for (const f of files) {
    if (seen.has(f)) continue;
    const full = path.join(downloads, f);
    try {
      const { clientId, clientSecret } = readClientJson(full);
      if (!clientId || !clientSecret) continue;
      upsertEnv("GOOGLE_CLIENT_ID", clientId);
      upsertEnv("GOOGLE_CLIENT_SECRET", clientSecret);
      upsertEnv("GOOGLE_REDIRECT_URI", redirectUri);
      console.log(`Wrote GOOGLE_CLIENT_* to ${envPath} from ${f}`);
      console.log("Restart the API, connect Gmail under Calendar → Accounts, then Resend the invite.");
      clearInterval(timer);
      process.exit(0);
    } catch (err) {
      console.error("Could not parse", f, err.message);
    }
  }
  if (Date.now() - started > 10 * 60 * 1000) {
    console.error("Timed out waiting for client_secret JSON in Downloads.");
    clearInterval(timer);
    process.exit(1);
  }
}, 2000);
