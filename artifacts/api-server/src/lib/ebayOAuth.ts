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
    config.ebayCertId ??
    process.env.EBAY_OAUTH_CLIENT_SECRET ??
    process.env.EBAY_CERT_ID ??
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

/** Try several scopes — some keysets reject combined Buy scopes until enabled in Developer Console. */
const BUY_CLIENT_CRED_SCOPE_CANDIDATES = [
  "https://api.ebay.com/oauth/api_scope/buy.item.read https://api.ebay.com/oauth/api_scope/buy.marketplace.read",
  "https://api.ebay.com/oauth/api_scope/buy.item.read",
  "https://api.ebay.com/oauth/api_scope/buy.marketplace.read",
  "https://api.ebay.com/oauth/api_scope",
];

function summarizeOAuthIdentityError(data: unknown): string {
  if (data == null) return "";
  if (typeof data === "string") return data.trim().slice(0, 400);
  if (typeof data === "object" && data !== null) {
    const d = data as Record<string, unknown>;
    const err = typeof d.error === "string" ? d.error : "";
    const desc = typeof d.error_description === "string" ? d.error_description : "";
    if (err || desc) return `${err}${err && desc ? " — " : ""}${desc}`.trim().slice(0, 400);
  }
  try {
    return JSON.stringify(data).slice(0, 400);
  } catch {
    return "";
  }
}

async function fetchApplicationAccessTokenBestEffort(params: {
  clientId: string;
  clientSecret: string;
}): Promise<
  | { ok: true; access_token: string; expires_in: number }
  | { ok: false; httpStatus: number; errorSummary: string }
> {
  const basic = Buffer.from(`${params.clientId}:${params.clientSecret}`).toString("base64");
  let lastStatus = 0;
  let lastSummary = "";

  for (const scope of BUY_CLIENT_CRED_SCOPE_CANDIDATES) {
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      scope,
    });
    const resp = await axios.post("https://api.ebay.com/identity/v1/oauth2/token", body.toString(), {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${basic}`,
      },
      timeout: 15000,
      validateStatus: () => true,
    });
    lastStatus = resp.status;
    if (resp.status === 200 && resp.data?.access_token) {
      return {
        ok: true,
        access_token: resp.data.access_token,
        expires_in: Number(resp.data.expires_in) || 7200,
      };
    }
    const msg = summarizeOAuthIdentityError(resp.data);
    lastSummary = msg || `HTTP ${resp.status}`;
    logger.warn({ status: resp.status, scope, data: resp.data }, "eBay OAuth client_credentials attempt failed");
  }

  return { ok: false, httpStatus: lastStatus, errorSummary: lastSummary || "client_credentials failed" };
}

export type EbayBuyAuthMethod = "oauth_user_refresh" | "client_credentials" | null;

export type BuyApiClientCredentialsAttempt = {
  attempted: boolean;
  httpStatus: number | null;
  errorJa: string | null;
};

/**
 * Token for Buy Browse API: prefer user refresh token when present, else App ID + OAuth Client Secret (client credentials).
 * Matches how the separate inventory app stores `ebay_client_id` / `ebay_client_secret`.
 */
export async function getBuyApiAccessTokenFromDb(): Promise<{
  token: string | null;
  authMethod: EbayBuyAuthMethod;
  clientCredentialsAttempt: BuyApiClientCredentialsAttempt;
}> {
  const noneAttempt: BuyApiClientCredentialsAttempt = {
    attempted: false,
    httpStatus: null,
    errorJa: null,
  };

  const userTok = await getValidEbayUserAccessTokenFromDb();
  if (userTok) {
    return { token: userTok, authMethod: "oauth_user_refresh", clientCredentialsAttempt: noneAttempt };
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
    return { token: null, authMethod: null, clientCredentialsAttempt: noneAttempt };
  }

  const appTok = await fetchApplicationAccessTokenBestEffort({ clientId, clientSecret });
  if (appTok.ok) {
    return {
      token: appTok.access_token,
      authMethod: "client_credentials",
      clientCredentialsAttempt: {
        attempted: true,
        httpStatus: 200,
        errorJa: null,
      },
    };
  }

  return {
    token: null,
    authMethod: null,
    clientCredentialsAttempt: {
      attempted: true,
      httpStatus: appTok.httpStatus,
      errorJa: appTok.errorSummary,
    },
  };
}
