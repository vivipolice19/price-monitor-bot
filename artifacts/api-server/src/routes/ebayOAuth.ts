import { Router } from "express";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { spreadsheetConfigTable } from "@workspace/db/schema";
import { buildEbayAuthorizeUrl, exchangeEbayAuthCode } from "../lib/ebayOAuth";

const router = Router();

router.get("/ebay/oauth/authorize-url", async (req, res) => {
  try {
    const [config] = await db.select().from(spreadsheetConfigTable).limit(1);
    if (!config?.ebayAppId || !config.ebayOAuthRedirectUri) {
      res.status(400).json({
        error: "oauth_not_configured",
        message: "eBay App ID と OAuth リダイレクトURIを設定してください。",
      });
      return;
    }
    const authorizeUrl = buildEbayAuthorizeUrl({
      clientId: config.ebayAppId,
      redirectUri: config.ebayOAuthRedirectUri,
    });
    res.json({ authorizeUrl });
  } catch {
    res.status(500).json({ error: "internal_error" });
  }
});

router.get("/ebay/oauth/callback", async (req, res) => {
  const code = typeof req.query.code === "string" ? req.query.code : "";
  if (!code) {
    res.status(400).send("Missing code");
    return;
  }

  try {
    const [config] = await db.select().from(spreadsheetConfigTable).limit(1);
    if (!config?.ebayAppId || !config.ebayOAuthClientSecret || !config.ebayOAuthRedirectUri) {
      res.status(400).send("OAuth client not fully configured");
      return;
    }

    const tokens = await exchangeEbayAuthCode({
      code,
      redirectUri: config.ebayOAuthRedirectUri,
      clientId: config.ebayAppId,
      clientSecret: config.ebayOAuthClientSecret,
    });

    const expiresAt = new Date(Date.now() + (tokens.expires_in ?? 7200) * 1000);

    await db
      .update(spreadsheetConfigTable)
      .set({
        ebayOAuthRefreshToken: tokens.refresh_token,
        ebayOAuthAccessToken: tokens.access_token,
        ebayOAuthAccessExpiresAt: expiresAt,
      })
      .where(eq(spreadsheetConfigTable.id, config.id));

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(
      "<!DOCTYPE html><html><head><meta charset='utf-8'><title>eBay OAuth</title></head><body><p>eBay連携が完了しました。このウィンドウを閉じて設定画面に戻ってください。</p></body></html>",
    );
  } catch (err: any) {
    res.status(500).send(`OAuth error: ${err?.message ?? err}`);
  }
});

export default router;
