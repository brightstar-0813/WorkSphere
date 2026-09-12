/**
 * Headed helper: create Google Auth Platform web client for WorkSphere.
 * Run: node apps/api/scripts/create-google-oauth-client.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, "../.env");
const projectId = process.env.GCLOUD_PROJECT || "worksphere-cal-659275";
const redirectUri =
  "http://localhost:4000/api/v1/integrations/google/callback";

function upsertEnv(key, value) {
  let text = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
  const line = `${key}="${value}"`;
  const re = new RegExp(`^#?\\s*${key}=.*$`, "m");
  if (re.test(text)) text = text.replace(re, line);
  else text = `${text.trimEnd()}\n${line}\n`;
  fs.writeFileSync(envPath, text);
}

const browser = await chromium.launch({
  headless: false,
  channel: "chrome",
  args: ["--disable-blink-features=AutomationControlled"],
});
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();

console.log("Opening Google Auth Platform… log in as louis.michael9523@gmail.com if asked.");
await page.goto(
  `https://console.cloud.google.com/auth/clients/create?project=${projectId}`,
  { waitUntil: "domcontentloaded", timeout: 120_000 }
);

// Wait until create form is usable (user may need to finish login / branding)
console.log("Waiting for Create client form (up to 5 minutes)…");
await page.waitForTimeout(3000);

// Try to complete branding / consent if wizard appears
for (let i = 0; i < 60; i++) {
  const url = page.url();
  console.log(`[${i}] ${url}`);

  // Branding / audience / data-access wizards: click through defaults when possible
  const getStarted = page.getByRole("button", { name: /get started|开始|開始/i });
  if (await getStarted.count()) {
    await getStarted.first().click().catch(() => undefined);
  }

  const external = page.getByText(/external|外部/i).first();
  if (await external.count()) {
    await external.click().catch(() => undefined);
  }

  const createApp = page.getByRole("button", { name: /create|创建|建立/i }).first();
  // Application type: Web application
  const webApp = page.getByText(/^Web application$|网页应用|網頁應用/i).first();
  if (await webApp.count()) {
    await webApp.click().catch(() => undefined);
  }

  const nameInput = page.locator('input[aria-label*="Name" i], input[formcontrolname="displayName"], input[name="displayName"]').first();
  if (await nameInput.count()) {
    await nameInput.fill("WorkSphere Local").catch(() => undefined);
  }

  // Authorized redirect URIs
  const addUri = page.getByRole("button", { name: /add uri|添加 uri|新增 uri|add/i });
  const redirectInputs = page.locator('input[placeholder*="https://" i], input[aria-label*="redirect" i]');
  if ((await redirectInputs.count()) === 0 && (await addUri.count())) {
    await addUri.first().click().catch(() => undefined);
  }
  const redirectField = page.locator('input[placeholder*="https://" i], input[aria-label*="Redirect" i]').last();
  if (await redirectField.count()) {
    await redirectField.fill(redirectUri).catch(() => undefined);
  }

  // Final Create
  const createBtn = page.getByRole("button", { name: /^Create$|^创建$|^建立$/i });
  if (await createBtn.count()) {
    const enabled = await createBtn.first().isEnabled().catch(() => false);
    if (enabled) {
      await createBtn.first().click();
      console.log("Clicked Create");
      break;
    }
  }

  // Already on clients list with a client?
  if (/auth\/clients(?!\/create)/.test(url) && !url.includes("/create")) {
    console.log("On clients list page");
    break;
  }

  await page.waitForTimeout(5000);
}

// After create, Google shows client ID + secret once
await page.waitForTimeout(5000);
const bodyText = await page.locator("body").innerText();
console.log("--- page text snippet ---");
console.log(bodyText.slice(0, 2500));

const idMatch = bodyText.match(/(\d+-[a-z0-9]+\.apps\.googleusercontent\.com)/i);
const secretMatch =
  bodyText.match(/Client secret\s*([A-Za-z0-9_-]{10,})/i) ||
  bodyText.match(/客户端密钥\s*([A-Za-z0-9_-]{10,})/i) ||
  bodyText.match(/GOCSPX-[A-Za-z0-9_-]+/);

if (idMatch && secretMatch) {
  const clientId = idMatch[1];
  const clientSecret = secretMatch[0].startsWith("GOCSPX")
    ? secretMatch[0]
    : secretMatch[1];
  upsertEnv("GOOGLE_CLIENT_ID", clientId);
  upsertEnv("GOOGLE_CLIENT_SECRET", clientSecret);
  upsertEnv("GOOGLE_REDIRECT_URI", redirectUri);
  console.log("Wrote GOOGLE_CLIENT_* to", envPath);
} else {
  console.log("Could not auto-extract client ID/secret from page.");
  console.log("If the dialog shows them, copy into apps/api/.env, or download JSON to Downloads.");
  // Keep browser open for manual copy
  await page.waitForTimeout(120_000);
}

await browser.close();
