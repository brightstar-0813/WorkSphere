import jwt from "jsonwebtoken";
import type { CalendarProvider } from "@prisma/client";

export type OAuthState = {
  provider: CalendarProvider;
  /** Default: connect calendar for logged-in user */
  purpose?: "connect" | "share_accept";
  userId?: string;
  /** CalendarShare.inviteToken when purpose=share_accept */
  shareToken?: string;
};

export function googleConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function outlookConfigured() {
  return Boolean(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET);
}

export function webOrigin() {
  return process.env.WEB_ORIGIN || "http://localhost:5173";
}

export function apiPublicUrl() {
  return process.env.API_PUBLIC_URL || `http://localhost:${process.env.PORT ?? 4000}`;
}

export function signOAuthState(payload: OAuthState) {
  return jwt.sign(payload, process.env.JWT_SECRET || "worksphere-dev-secret", {
    expiresIn: "30m",
  });
}

export function verifyOAuthState(token: string): OAuthState | null {
  try {
    return jwt.verify(token, process.env.JWT_SECRET || "worksphere-dev-secret") as OAuthState;
  } catch {
    return null;
  }
}

export function googleRedirectUri() {
  return (
    process.env.GOOGLE_REDIRECT_URI ||
    `${apiPublicUrl()}/api/v1/integrations/google/callback`
  );
}

export function outlookRedirectUri() {
  return (
    process.env.MICROSOFT_REDIRECT_URI ||
    `${apiPublicUrl()}/api/v1/integrations/outlook/callback`
  );
}

export function microsoftTenant() {
  return process.env.MICROSOFT_TENANT_ID || "common";
}
