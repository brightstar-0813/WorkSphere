import { prisma } from "../prisma.js";
import { decryptSecret, encryptSecret } from "../cryptoSecrets.js";
import {
  googleConfigured,
  googleRedirectUri,
  outlookConfigured,
  outlookRedirectUri,
  microsoftTenant,
} from "./oauthConfig.js";
import type { CalendarConnection, CalendarProvider } from "@prisma/client";

export type ExternalEvent = {
  externalId: string;
  title: string;
  startsAt: Date;
  endsAt: Date | null;
  allDay: boolean;
  description: string;
  attendees: string[];
  htmlLink?: string | null;
  connectionId?: string;
};

/** Parse Graph dateTime when Prefer: outlook.timezone="UTC" (no offset, often 7-digit ms). */
function parseGraphDateTime(dateTime?: string): Date {
  if (!dateTime) return new Date(NaN);
  let normalized = dateTime.trim().replace(/(\.\d{3})\d+/, "$1");
  if (!/([zZ]|[+-]\d{2}:?\d{2})$/.test(normalized)) {
    normalized = `${normalized}Z`;
  }
  return new Date(normalized);
}

async function getConnections(userId: string, provider: CalendarProvider) {
  return prisma.calendarConnection.findMany({
    where: { userId, provider },
    orderBy: { createdAt: "asc" },
  });
}

async function getConnectionById(userId: string, connectionId: string) {
  return prisma.calendarConnection.findFirst({
    where: { id: connectionId, userId },
  });
}

/** Prefer oldest connection for invites when none specified */
async function getPrimaryConnection(userId: string, provider: CalendarProvider) {
  const rows = await getConnections(userId, provider);
  return rows[0] ?? null;
}

async function saveTokens(
  conn: CalendarConnection,
  accessToken: string,
  refreshToken: string | undefined,
  expiresIn?: number
) {
  return prisma.calendarConnection.update({
    where: { id: conn.id },
    data: {
      accessTokenEnc: encryptSecret(accessToken),
      refreshTokenEnc:
        refreshToken !== undefined
          ? encryptSecret(refreshToken)
          : undefined,
      expiresAt: expiresIn
        ? new Date(Date.now() + expiresIn * 1000)
        : conn.expiresAt,
    },
  });
}

async function accessTokenFor(conn: CalendarConnection): Promise<string> {
  const access = decryptSecret(conn.accessTokenEnc);
  if (conn.expiresAt && conn.expiresAt.getTime() > Date.now() + 60_000) {
    return access;
  }
  const refresh = decryptSecret(conn.refreshTokenEnc);
  if (!refresh) return access;

  if (conn.provider === "GOOGLE") {
    const body = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: refresh,
      grant_type: "refresh_token",
    });
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) throw new Error(`Google token refresh failed: ${await res.text()}`);
    const json = (await res.json()) as {
      access_token: string;
      expires_in?: number;
      refresh_token?: string;
    };
    await saveTokens(conn, json.access_token, json.refresh_token, json.expires_in);
    return json.access_token;
  }

  const tenant = microsoftTenant();
  const body = new URLSearchParams({
    client_id: process.env.MICROSOFT_CLIENT_ID!,
    client_secret: process.env.MICROSOFT_CLIENT_SECRET!,
    refresh_token: refresh,
    grant_type: "refresh_token",
    scope: "offline_access User.Read Calendars.ReadWrite Mail.Send",
  });
  const res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`Outlook token refresh failed: ${await res.text()}`);
  const json = (await res.json()) as {
    access_token: string;
    expires_in?: number;
    refresh_token?: string;
  };
  await saveTokens(conn, json.access_token, json.refresh_token, json.expires_in);
  return json.access_token;
}

export function googleAuthUrl(state: string) {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: googleRedirectUri(),
    response_type: "code",
    access_type: "offline",
    prompt: "consent select_account",
    scope: [
      "openid",
      "email",
      "profile",
      "https://www.googleapis.com/auth/calendar.events",
      "https://www.googleapis.com/auth/calendar.readonly",
      "https://www.googleapis.com/auth/gmail.send",
    ].join(" "),
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export function outlookAuthUrl(state: string) {
  const tenant = microsoftTenant();
  const params = new URLSearchParams({
    client_id: process.env.MICROSOFT_CLIENT_ID!,
    redirect_uri: outlookRedirectUri(),
    response_type: "code",
    response_mode: "query",
    scope: "offline_access User.Read Calendars.ReadWrite Mail.Send",
    prompt: "select_account",
    state,
  });
  return `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize?${params}`;
}

export async function exchangeGoogleCode(code: string) {
  if (!googleConfigured()) throw new Error("Google OAuth is not configured");
  const body = new URLSearchParams({
    code,
    client_id: process.env.GOOGLE_CLIENT_ID!,
    client_secret: process.env.GOOGLE_CLIENT_SECRET!,
    redirect_uri: googleRedirectUri(),
    grant_type: "authorization_code",
  });
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!tokenRes.ok) throw new Error(`Google token exchange failed: ${await tokenRes.text()}`);
  const tokens = (await tokenRes.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };

  const meRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!meRes.ok) throw new Error(`Google profile failed: ${await meRes.text()}`);
  const me = (await meRes.json()) as { email?: string };

  return {
    accountEmail: me.email || "unknown@gmail.com",
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token || "",
    expiresIn: tokens.expires_in,
    scope: tokens.scope || "",
  };
}

export async function exchangeOutlookCode(code: string) {
  if (!outlookConfigured()) throw new Error("Outlook OAuth is not configured");
  const tenant = microsoftTenant();
  const body = new URLSearchParams({
    code,
    client_id: process.env.MICROSOFT_CLIENT_ID!,
    client_secret: process.env.MICROSOFT_CLIENT_SECRET!,
    redirect_uri: outlookRedirectUri(),
    grant_type: "authorization_code",
    scope: "offline_access User.Read Calendars.ReadWrite Mail.Send",
  });
  const tokenRes = await fetch(
    `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    }
  );
  if (!tokenRes.ok) throw new Error(`Outlook token exchange failed: ${await tokenRes.text()}`);
  const tokens = (await tokenRes.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };

  const meRes = await fetch("https://graph.microsoft.com/v1.0/me", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!meRes.ok) throw new Error(`Outlook profile failed: ${await meRes.text()}`);
  const me = (await meRes.json()) as { mail?: string; userPrincipalName?: string };

  return {
    accountEmail: me.mail || me.userPrincipalName || "unknown@outlook.com",
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token || "",
    expiresIn: tokens.expires_in,
    scope: tokens.scope || "",
  };
}

export async function upsertConnection(
  userId: string,
  provider: CalendarProvider,
  data: {
    accountEmail: string;
    accessToken: string;
    refreshToken: string;
    expiresIn?: number;
    scope?: string;
  }
) {
  const accountEmail = data.accountEmail.trim().toLowerCase();
  return prisma.calendarConnection.upsert({
    where: {
      userId_provider_accountEmail: { userId, provider, accountEmail },
    },
    create: {
      userId,
      provider,
      accountEmail,
      accessTokenEnc: encryptSecret(data.accessToken),
      refreshTokenEnc: encryptSecret(data.refreshToken),
      expiresAt: data.expiresIn
        ? new Date(Date.now() + data.expiresIn * 1000)
        : null,
      scope: data.scope || "",
      externalCalendarId: provider === "GOOGLE" ? "primary" : "",
    },
    update: {
      accessTokenEnc: encryptSecret(data.accessToken),
      refreshTokenEnc: data.refreshToken
        ? encryptSecret(data.refreshToken)
        : undefined,
      expiresAt: data.expiresIn
        ? new Date(Date.now() + data.expiresIn * 1000)
        : undefined,
      scope: data.scope || undefined,
    },
  });
}

async function listGoogleEventsForConn(
  conn: CalendarConnection,
  from: Date,
  to: Date
): Promise<ExternalEvent[]> {
  const token = await accessTokenFor(conn);
  const calendarId = encodeURIComponent(conn.externalCalendarId || "primary");
  const params = new URLSearchParams({
    timeMin: from.toISOString(),
    timeMax: to.toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "250",
  });
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events?${params}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(`Google list events failed: ${await res.text()}`);
  const json = (await res.json()) as {
    items?: Array<{
      id?: string;
      summary?: string;
      description?: string;
      htmlLink?: string;
      start?: { dateTime?: string; date?: string };
      end?: { dateTime?: string; date?: string };
      attendees?: Array<{ email?: string }>;
    }>;
  };

  return (json.items || [])
    .filter((ev) => ev.id)
    .map((ev) => {
      const allDay = Boolean(ev.start?.date && !ev.start?.dateTime);
      const startsAt = new Date(ev.start?.dateTime || `${ev.start?.date}T00:00:00`);
      const endsAt = ev.end
        ? new Date(ev.end.dateTime || `${ev.end.date}T00:00:00`)
        : null;
      return {
        externalId: `${conn.id}:${ev.id!}`,
        title: ev.summary || "(No title)",
        startsAt,
        endsAt,
        allDay,
        description: ev.description || "",
        attendees: (ev.attendees || []).map((a) => a.email!).filter(Boolean),
        htmlLink: ev.htmlLink,
        connectionId: conn.id,
      };
    });
}

export async function listGoogleEvents(
  userId: string,
  from: Date,
  to: Date,
  connectionId?: string
): Promise<ExternalEvent[]> {
  const conns = connectionId
    ? ([await getConnectionById(userId, connectionId)].filter(Boolean) as CalendarConnection[])
    : await getConnections(userId, "GOOGLE");
  const all: ExternalEvent[] = [];
  for (const conn of conns) {
    if (conn.provider !== "GOOGLE") continue;
    all.push(...(await listGoogleEventsForConn(conn, from, to)));
  }
  return all;
}

async function listOutlookEventsForConn(
  conn: CalendarConnection,
  from: Date,
  to: Date
): Promise<ExternalEvent[]> {
  const token = await accessTokenFor(conn);
  const params = new URLSearchParams({
    startDateTime: from.toISOString(),
    endDateTime: to.toISOString(),
    $orderby: "start/dateTime",
    $top: "250",
  });
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/me/calendarView?${params}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Prefer: 'outlook.timezone="UTC"',
      },
    }
  );
  if (!res.ok) throw new Error(`Outlook list events failed: ${await res.text()}`);
  const json = (await res.json()) as {
    value?: Array<{
      id?: string;
      subject?: string;
      bodyPreview?: string;
      webLink?: string;
      isAllDay?: boolean;
      start?: { dateTime?: string };
      end?: { dateTime?: string };
      attendees?: Array<{ emailAddress?: { address?: string } }>;
    }>;
  };

  return (json.value || [])
    .filter((ev) => ev.id)
    .map((ev) => ({
      externalId: `${conn.id}:${ev.id!}`,
      title: ev.subject || "(No title)",
      startsAt: parseGraphDateTime(ev.start?.dateTime),
      endsAt: ev.end?.dateTime ? parseGraphDateTime(ev.end.dateTime) : null,
      allDay: Boolean(ev.isAllDay),
      description: ev.bodyPreview || "",
      attendees: (ev.attendees || [])
        .map((a) => a.emailAddress?.address)
        .filter((x): x is string => Boolean(x)),
      htmlLink: ev.webLink,
      connectionId: conn.id,
    }));
}

export async function listOutlookEvents(
  userId: string,
  from: Date,
  to: Date,
  connectionId?: string
): Promise<ExternalEvent[]> {
  const conns = connectionId
    ? ([await getConnectionById(userId, connectionId)].filter(Boolean) as CalendarConnection[])
    : await getConnections(userId, "OUTLOOK");
  const all: ExternalEvent[] = [];
  for (const conn of conns) {
    if (conn.provider !== "OUTLOOK") continue;
    all.push(...(await listOutlookEventsForConn(conn, from, to)));
  }
  return all;
}

export async function createGoogleEvent(
  userId: string,
  input: {
    title: string;
    description?: string;
    startsAt: Date;
    endsAt: Date | null;
    allDay?: boolean;
    attendees?: string[];
    connectionId?: string;
  }
) {
  const conn = input.connectionId
    ? await getConnectionById(userId, input.connectionId)
    : await getPrimaryConnection(userId, "GOOGLE");
  if (!conn || conn.provider !== "GOOGLE") return null;
  const token = await accessTokenFor(conn);
  const calendarId = encodeURIComponent(conn.externalCalendarId || "primary");
  const body: Record<string, unknown> = {
    summary: input.title,
    description: input.description || "",
    attendees: (input.attendees || []).map((email) => ({ email })),
  };
  if (input.allDay) {
    const day = input.startsAt.toISOString().slice(0, 10);
    const endDay = (input.endsAt || input.startsAt).toISOString().slice(0, 10);
    body.start = { date: day };
    body.end = { date: endDay };
  } else {
    body.start = { dateTime: input.startsAt.toISOString() };
    body.end = {
      dateTime: (input.endsAt || new Date(input.startsAt.getTime() + 3600000)).toISOString(),
    };
  }

  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events?sendUpdates=all`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );
  if (!res.ok) throw new Error(`Google create event failed: ${await res.text()}`);
  const json = (await res.json()) as { id?: string; htmlLink?: string };
  return {
    externalId: `${conn.id}:${json.id!}`,
    htmlLink: json.htmlLink || null,
    connectionId: conn.id,
  };
}

export async function createOutlookEvent(
  userId: string,
  input: {
    title: string;
    description?: string;
    startsAt: Date;
    endsAt: Date | null;
    allDay?: boolean;
    attendees?: string[];
    connectionId?: string;
  }
) {
  const conn = input.connectionId
    ? await getConnectionById(userId, input.connectionId)
    : await getPrimaryConnection(userId, "OUTLOOK");
  if (!conn || conn.provider !== "OUTLOOK") return null;
  const token = await accessTokenFor(conn);
  const endsAt = input.endsAt || new Date(input.startsAt.getTime() + 3600000);
  const body = {
    subject: input.title,
    body: {
      contentType: "Text",
      content: input.description || "",
    },
    start: {
      dateTime: input.startsAt.toISOString().replace(/\.\d{3}Z$/, ""),
      timeZone: "UTC",
    },
    end: {
      dateTime: endsAt.toISOString().replace(/\.\d{3}Z$/, ""),
      timeZone: "UTC",
    },
    isAllDay: Boolean(input.allDay),
    attendees: (input.attendees || []).map((address) => ({
      emailAddress: { address },
      type: "required",
    })),
  };

  const res = await fetch("https://graph.microsoft.com/v1.0/me/events", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Outlook create event failed: ${await res.text()}`);
  const json = (await res.json()) as { id?: string; webLink?: string };
  return {
    externalId: `${conn.id}:${json.id!}`,
    htmlLink: json.webLink || null,
    connectionId: conn.id,
  };
}

function toBase64Url(value: string) {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function encodeSubject(subject: string) {
  if (/^[\x20-\x7E]*$/.test(subject)) return subject;
  return `=?UTF-8?B?${Buffer.from(subject, "utf8").toString("base64")}?=`;
}

function buildGmailRawMessage(input: {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
}) {
  const boundary = `worksphere_${Date.now().toString(36)}`;
  const raw = [
    `From: ${input.from}`,
    `To: ${input.to}`,
    `Subject: ${encodeSubject(input.subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 7bit",
    "",
    input.text,
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: 7bit",
    "",
    input.html,
    `--${boundary}--`,
  ].join("\r\n");
  return toBase64Url(raw);
}

function connectionHasScope(conn: CalendarConnection, needle: string) {
  const scope = (conn.scope || "").toLowerCase();
  if (!scope) return true; // older rows may omit scope; try and let API fail
  return scope.includes(needle.toLowerCase());
}

/** Send email using the user's connected Gmail account (requires gmail.send scope). */
export async function sendMailViaGmail(
  userId: string,
  input: { to: string; subject: string; text: string; html: string; connectionId?: string }
): Promise<{ sent: true; from: string } | null> {
  const conn = input.connectionId
    ? await getConnectionById(userId, input.connectionId)
    : await getPrimaryConnection(userId, "GOOGLE");
  if (!conn || conn.provider !== "GOOGLE") return null;
  if (!connectionHasScope(conn, "gmail.send")) return null;

  const token = await accessTokenFor(conn);
  const raw = buildGmailRawMessage({
    from: conn.accountEmail,
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.html,
  });
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw }),
  });
  if (!res.ok) {
    console.error(`[share-invite] Gmail send failed: ${await res.text()}`);
    return null;
  }
  return { sent: true, from: conn.accountEmail };
}

/** Send email using the user's connected Outlook account (requires Mail.Send). */
export async function sendMailViaOutlook(
  userId: string,
  input: { to: string; subject: string; text: string; html: string; connectionId?: string }
): Promise<{ sent: true; from: string } | null> {
  const conn = input.connectionId
    ? await getConnectionById(userId, input.connectionId)
    : await getPrimaryConnection(userId, "OUTLOOK");
  if (!conn || conn.provider !== "OUTLOOK") return null;
  if (conn.scope && !connectionHasScope(conn, "Mail.Send") && !connectionHasScope(conn, "mail.send")) {
    return null;
  }

  const token = await accessTokenFor(conn);
  const res = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: {
        subject: input.subject,
        body: { contentType: "HTML", content: input.html },
        toRecipients: [{ emailAddress: { address: input.to } }],
      },
      saveToSentItems: true,
    }),
  });
  if (!res.ok) {
    console.error(`[share-invite] Outlook send failed: ${await res.text()}`);
    return null;
  }
  return { sent: true, from: conn.accountEmail };
}
