import axios from "axios";

function extractItemIdFromUrl(url: string): string | null {
  const patterns = [/\/itm\/(?:[^/]+\/)?(\d+)/, /item=(\d+)/, /\/(\d{10,13})(?:\?|$)/];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function reviseEbayListingPrice(params: {
  ebayUrl: string;
  newPrice: number;
  appId?: string | null;
  devId?: string | null;
  certId?: string | null;
  userToken?: string | null;
  oauthAccessToken?: string | null;
}): Promise<{ success: boolean; itemId?: string; message: string }> {
  const itemId = extractItemIdFromUrl(params.ebayUrl);
  if (!itemId) {
    return { success: false, message: "eBay URLからItem IDを抽出できませんでした。" };
  }

  const appId = params.appId ?? process.env.EBAY_APP_ID ?? "";
  const devId = params.devId ?? process.env.EBAY_DEV_ID ?? "";
  const certId = params.certId ?? process.env.EBAY_CERT_ID ?? "";

  if (!appId || !devId || !certId) {
    return { success: false, itemId, message: "eBayアプリケーション鍵(App/Dev/Cert)が不足しています。" };
  }

  const useOAuth = !!params.oauthAccessToken?.trim();
  const userToken = params.userToken ?? process.env.EBAY_USER_TOKEN ?? "";

  if (!useOAuth && !userToken) {
    return { success: false, itemId, message: "eBayユーザー認証(OAuthまたは従来トークン)が必要です。" };
  }

  const itemXml = `<Item><ItemID>${itemId}</ItemID><StartPrice>${params.newPrice.toFixed(2)}</StartPrice></Item>`;
  const body = useOAuth
    ? `<?xml version="1.0" encoding="utf-8"?>
<ReviseFixedPriceItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  ${itemXml}
</ReviseFixedPriceItemRequest>`
    : `<?xml version="1.0" encoding="utf-8"?>
<ReviseFixedPriceItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials>
    <eBayAuthToken>${xmlEscape(userToken)}</eBayAuthToken>
  </RequesterCredentials>
  ${itemXml}
</ReviseFixedPriceItemRequest>`;

  const headers: Record<string, string> = {
    "Content-Type": "text/xml",
    "X-EBAY-API-COMPATIBILITY-LEVEL": "967",
    "X-EBAY-API-CALL-NAME": "ReviseFixedPriceItem",
    "X-EBAY-API-SITEID": "0",
    "X-EBAY-API-APP-NAME": appId,
    "X-EBAY-API-DEV-NAME": devId,
    "X-EBAY-API-CERT-NAME": certId,
  };
  if (useOAuth) {
    headers["X-EBAY-API-IAF-TOKEN"] = params.oauthAccessToken!.trim();
  }

  const response = await axios.post("https://api.ebay.com/ws/api.dll", body, {
    timeout: 15000,
    headers,
  });

  const raw = String(response.data ?? "");
  const ack = /<Ack>([^<]+)<\/Ack>/i.exec(raw)?.[1] ?? "";
  const isSuccess = ack === "Success" || ack === "Warning";
  const err = /<LongMessage>([^<]+)<\/LongMessage>/i.exec(raw)?.[1];

  return {
    success: isSuccess,
    itemId,
    message: isSuccess ? "価格改定に成功しました。" : err ?? "価格改定に失敗しました。",
  };
}
