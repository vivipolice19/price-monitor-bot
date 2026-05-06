import axios from "axios";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { spreadsheetConfigTable } from "@workspace/db/schema";
import { logger } from "./logger";

const DEFAULT_SCOPES = "https://api.ebay.com/oauth/api_scope";

export function buildEbayAuthorizeUrl(params: {
  clientId: string;
  redirectUri: string;
  state?: string;
  scopes?: string;
}): string {
  const u = new URL("https://auth.ebay.com/oauth2/authorize");
  u.searchParams.set("client_id", params.clientId);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("redirect_uri", params.redirectUri);
  u.searchParams.set("scope", params.scopes ?? DEFAULT_SCOPES);
  if (params.state) u.searchParams.set("state", params.state);
  return u.toString();
}

export async function exchangeEbayAuthCode(params: {
  code: string;
  redirectUri: string;
  clientId: string;
  clientSecret: string;
}): Promise<{ access_token: string; refresh_token: string; expires_in: number }> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: params.code,
    redirect_uri: params.redirectUri,
  });

  const basic = Buffer.from(`${params.clientId}:${params.clientSecret}`).toString("base64");

  const resp = await axios.post("https://api.ebay.com/identity/v1/oauth2/token", body.toString(), {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basic}`,
    },
    timeout: 15000,
    validateStatus: () => true,
  });

  if (resp.status !== 200) {
    throw new Error(`eBay token exchange failed: HTTP ${resp.status}`);
  }

  return resp.data as { access_token: string; refresh_token: string; expires_in: number };
}

export async function refreshEbayUserAccessToken(params: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
}): Promise<{ access_token: string; expires_in: number }> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: params.refreshToken,
    scope: DEFAULT_SCOPES,
  });

  const basic = Buffer.from(`${params.clientId}:${params.clientSecret}`).toString("base64");

  const resp = await axios.post("https://api.ebay.com/identity/v1/oauth2/token", body.toString(), {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basic}`,
    },
    timeout: 15000,
    validateStatus: () => true,
  });

  if (resp.status !== 200) {
    throw new Error(`eBay token refresh failed: HTTP ${resp.status}`);
  }

  return resp.data as { access_token: string; expires_in: number };
}

export async function getValidEbayUserAccessTokenFromDb(): Promise<string | null> {
  const [config] = await db.select().from(spreadsheetConfigTable).limit(1);
  if (!config) return null;

  const clientId = config.ebayAppId ?? process.env.EBAY_OAUTH_CLIENT_ID ?? "";
  const clientSecret =
    config.ebayOAuthClientSecret ??
    process.env.EBAY_OAUTH_CLIENT_SECRET ??
    "";

  if (!clientId || !clientSecret || !config.ebayOAuthRefreshToken) {
    return null;
  }

  const now = Date.now();
  const expiresAt = config.ebayOAuthAccessExpiresAt?.getTime() ?? 0;
  if (config.ebayOAuthAccessToken && expiresAt > now + 60_000) {
    return config.ebayOAuthAccessToken;
  }

  try {
    const refreshed = await refreshEbayUserAccessToken({
      refreshToken: config.ebayOAuthRefreshToken,
      clientId,
      clientSecret,
    });

    const expiresInMs = (refreshed.expires_in ?? 7200) * 1000;
    const newExpires = new Date(now + expiresInMs);

    await db
      .update(spreadsheetConfigTable)
      .set({
        ebayOAuthAccessToken: refreshed.access_token,
        ebayOAuthAccessExpiresAt: newExpires,
      })
      .where(eq(spreadsheetConfigTable.id, config.id));

    return refreshed.access_token;
  } catch (err) {
    logger.error({ err }, "Failed to refresh eBay OAuth access token");
    return null;
  }
}

/** Scopes for Browse/Buy read APIs with application (client_credentials) tokens — same pattern as the inventory app. */
const BUY_APPLICATION_SCOPE =
  "https://api.ebay.com/oauth/api_scope/buy.item.read https://api.ebay.com/oauth/api_scope/buy.marketplace.read";

export async function fetchApplicationAccessToken(params: {
  clientId: string;
  clientSecret: string;
}): Promise<{ access_token: string; expires_in: number } | null> {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    scope: BUY_APPLICATION_SCOPE,
  });

  const basic = Buffer.from(`${params.clientId}:${params.clientSecret}`).toString("base64");

  const resp = await axios.post("https://api.ebay.com/identity/v1/oauth2/token", body.toString(), {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basic}`,
    },
    timeout: 15000,
    validateStatus: () => true,
  });

  if (resp.status !== 200) {
    logger.warn(
      { status: resp.status, data: resp.data },
      "eBay OAuth client_credentials (Browse/Buy) failed",
    );
    return null;
  }

  return resp.data as { access_token: string; expires_in: number };
}

export type EbayBuyAuthMethod = "oauth_user_refresh" | "client_credentials" | null;

/**
 * Token for Buy Browse API: prefer user refresh token when present, else App ID + OAuth Client Secret (client credentials).
 * Matches how the separate inventory app stores `ebay_client_id` / `ebay_client_secret`.
 */
export async function getBuyApiAccessTokenFromDb(): Promise<{
  token: string | null;
  authMethod: EbayBuyAuthMethod;
}> {
  const userTok = await getValidEbayUserAccessTokenFromDb();
  if (userTok) {
    return { token: userTok, authMethod: "oauth_user_refresh" };
  }

  const [config] = await db.select().from(spreadsheetConfigTable).limit(1);
  const clientId =
    config?.ebayAppId?.trim() ??
    process.env.EBAY_OAUTH_CLIENT_ID?.trim() ??
    process.env.EBAY_APP_ID?.trim() ??
    "";
  const clientSecret =
    config?.ebayOAuthClientSecret?.trim() ??
    config?.ebayCertId?.trim() ??
    process.env.EBAY_OAUTH_CLIENT_SECRET?.trim() ??
    process.env.EBAY_CERT_ID?.trim() ??
    "";

  if (!clientId || !clientSecret) {
    return { token: null, authMethod: null };
  }

  const appTok = await fetchApplicationAccessToken({ clientId, clientSecret });
  if (appTok?.access_token) {
    return { token: appTok.access_token, authMethod: "client_credentials" };
  }

  return { token: null, authMethod: null };
}
