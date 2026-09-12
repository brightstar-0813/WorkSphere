import { webOrigin, googleConfigured, outlookConfigured } from "./integrations/oauthConfig.js";
import { sendMailViaGmail, sendMailViaOutlook } from "./integrations/calendarProviders.js";
import { prisma } from "./prisma.js";

export type InviteEmailFailReason =
  | "oauth_not_configured"
  | "no_connected_mailbox"
  | "needs_reconnect"
  | "send_failed"
  | "smtp_unreachable"
  | "none";

export type InviteEmailResult = {
  sent: boolean;
  method: "smtp" | "gmail" | "outlook" | "adc" | "none";
  inviteUrl: string;
  from?: string;
  failReason?: InviteEmailFailReason;
};

function smtpConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

export function shareInviteUrl(token: string) {
  return `${webOrigin()}/share/${token}`;
}

export async function sendCalendarShareInvite(input: {
  to: string;
  requesterName: string;
  requesterEmail: string;
  inviteToken: string;
  /** When set, try connected Gmail/Outlook if SMTP is unavailable. */
  fromUserId?: string;
}): Promise<InviteEmailResult> {
  const inviteUrl = shareInviteUrl(input.inviteToken);
  const subject = `${input.requesterName} wants to view your calendar on WorkSphere`;
  const text = [
    `${input.requesterName} (${input.requesterEmail}) asked to view your calendar in WorkSphere.`,
    ``,
    `Accept (connect Gmail or Outlook so they can see your events):`,
    inviteUrl,
    ``,
    `If you did not expect this, ignore this email.`,
  ].join("\n");
  const html = `
    <p><strong>${escapeHtml(input.requesterName)}</strong> (${escapeHtml(input.requesterEmail)})
    asked to view your calendar in WorkSphere.</p>
    <p><a href="${inviteUrl}">Accept &amp; connect your calendar</a></p>
    <p style="color:#666;font-size:12px">If you did not expect this, ignore this email.</p>
  `;

  const payload = { to: input.to, subject, text, html };

  // 1) Server SMTP (optional) — often blocked on local/ISP networks
  let smtpFailed = false;
  if (smtpConfigured()) {
    const smtp = await trySmtp(payload);
    if (smtp) return { sent: true, method: "smtp", inviteUrl, from: smtp.from };
    smtpFailed = true;
  }

  // 2) Requester's connected Gmail / Outlook (HTTPS — preferred when SMTP is blocked)
  if (input.fromUserId) {
    try {
      const gmail = await sendMailViaGmail(input.fromUserId, payload);
      if (gmail) return { sent: true, method: "gmail", inviteUrl, from: gmail.from };
    } catch (err) {
      console.error("[share-invite] Gmail path failed", err);
    }

    try {
      const outlook = await sendMailViaOutlook(input.fromUserId, payload);
      if (outlook) return { sent: true, method: "outlook", inviteUrl, from: outlook.from };
    } catch (err) {
      console.error("[share-invite] Outlook path failed", err);
    }
  }

  // 3) Local ADC / gcloud user with gmail.send (dev: after `gcloud auth application-default login --scopes=...gmail.send`)
  try {
    const adc = await tryAdcGmail(payload);
    if (adc) return { sent: true, method: "adc", inviteUrl, from: adc.from };
  } catch (err) {
    console.error("[share-invite] ADC Gmail path failed", err);
  }

  const failReason = await diagnoseFailReason(input.fromUserId, smtpFailed);
  console.info(`[share-invite] No mail transport (${failReason}). Invite for ${input.to}: ${inviteUrl}`);
  return { sent: false, method: "none", inviteUrl, failReason };
}

async function diagnoseFailReason(
  userId?: string,
  smtpFailed = false
): Promise<InviteEmailFailReason> {
  const oauthReady = googleConfigured() || outlookConfigured();

  // SMTP was set but unreachable — tell the user to use Gmail API send instead
  if (smtpFailed && !oauthReady) return "smtp_unreachable";

  if (!oauthReady) return "oauth_not_configured";
  if (!userId) return "no_connected_mailbox";

  const conns = await prisma.calendarConnection.findMany({
    where: { userId, provider: { in: ["GOOGLE", "OUTLOOK"] } },
    select: { provider: true, scope: true },
  });
  if (conns.length === 0) return "no_connected_mailbox";

  const canSend = conns.some((c) => {
    const scope = (c.scope || "").toLowerCase();
    if (!scope) return true;
    return c.provider === "GOOGLE"
      ? scope.includes("gmail.send")
      : scope.includes("mail.send");
  });
  if (!canSend) return "needs_reconnect";
  return smtpFailed ? "smtp_unreachable" : "send_failed";
}

/** Send via Application Default Credentials (gcloud user) when gmail.send was granted. */
async function tryAdcGmail(input: {
  to: string;
  subject: string;
  text: string;
  html: string;
}): Promise<{ from: string } | null> {
  if (process.env.GMAIL_ADC_SEND === "0") return null;
  try {
    const { GoogleAuth } = await import("google-auth-library");
    const auth = new GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/gmail.send", "https://www.googleapis.com/auth/userinfo.email"],
    });
    const client = await auth.getClient();
    const accessToken = await client.getAccessToken();
    const token = typeof accessToken === "string" ? accessToken : accessToken?.token;
    if (!token) return null;

    let from =
      process.env.SMTP_USER ||
      process.env.GMAIL_ADC_FROM ||
      "";
    if (!from) {
      const meRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (meRes.ok) {
        const me = (await meRes.json()) as { email?: string };
        from = me.email || "";
      }
    }
    if (!from) return null;

    const raw = [
      `From: ${from}`,
      `To: ${input.to}`,
      `Subject: ${input.subject}`,
      "MIME-Version: 1.0",
      "Content-Type: text/html; charset=utf-8",
      "",
      input.html,
    ].join("\r\n");
    const encoded = Buffer.from(raw)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw: encoded }),
    });
    if (!res.ok) {
      const body = await res.text();
      // Missing scope / not authorized — silent skip so other fail reasons stay accurate
      if (res.status === 401 || res.status === 403) {
        console.info("[share-invite] ADC Gmail not authorized for gmail.send yet");
        return null;
      }
      console.error(`[share-invite] ADC Gmail send failed: ${body}`);
      return null;
    }
    return { from };
  } catch (err) {
    console.info("[share-invite] ADC Gmail unavailable", err instanceof Error ? err.message : err);
    return null;
  }
}

async function trySmtp(input: {
  to: string;
  subject: string;
  text: string;
  html: string;
}): Promise<{ from: string } | null> {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;

  try {
    const nodemailer = await import("nodemailer");
    const port = Number(process.env.SMTP_PORT || 587);
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      requireTLS: port === 587,
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      auth: { user, pass },
      tls: { minVersion: "TLSv1.2", servername: host },
    });
    const from = process.env.SMTP_FROM || user;
    await transporter.sendMail({
      from,
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
    });
    return { from };
  } catch (err) {
    console.error("[share-invite] SMTP send failed", err);
    return null;
  }
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
