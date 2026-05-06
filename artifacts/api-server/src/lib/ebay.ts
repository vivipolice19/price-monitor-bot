import axios from "axios";
import * as cheerio from "cheerio";
import { logger } from "./logger";
import { getBuyApiAccessTokenFromDb } from "./ebayOAuth";

/** API ごとの成否（画面・ログ用。リサーチは実行しているが eBay 側エラーの切り分けに使う） */
export type EbayResearchDiagnostics = {
  itemId: string | null;
  buyApiAuth: "oauth_user_refresh" | "client_credentials" | "none";
  browseGetItemHttpStatus: number | null;
  shoppingHadPositivePrice: boolean;
  tradingAck: string | null;
  tradingErrorJa: string | null;
  findingItemLookupHttpStatus: number | null;
  browseSearchHttpStatus: number | null;
  findingSearchHttpStatus: number | null;
  competitorBrowseCount: number;
  competitorFindingCount: number;
  hintsJa: string[];
};

export interface ProductIdentifiers {
  upc: string[];
  ean: string[];
  isbn: string[];
  mpn?: string;
  brand?: string;
  epid?: string;
}

export interface EbayItem {
  itemId: string;
  title: string;
  price: number;
  currency: string;
  condition: string;
  conditionId?: string;
  seller?: string;
  url: string;
  shippingCost?: number;
  totalPrice: number;
  imageUrl?: string;
  location?: string;
  identifiers?: ProductIdentifiers;
}

type TradingCreds = {
  appId?: string | null;
  devId?: string | null;
  certId?: string | null;
  userToken?: string | null;
};

function isUsableEbayItem(item: EbayItem | null | undefined): boolean {
  return Boolean(item && (item.totalPrice ?? 0) > 0);
}

function pickBetterItem(a: EbayItem | null, b: EbayItem | null): EbayItem | null {
  if (isUsableEbayItem(b) && !isUsableEbayItem(a)) return b;
  if (isUsableEbayItem(a) && !isUsableEbayItem(b)) return a;
  if (!a) return b;
  if (!b) return a;
  return (b.totalPrice ?? 0) > (a.totalPrice ?? 0) ? b : a;
}

function normalizeConditionFromBrowse(value: string | undefined): string {
  const v = (value ?? "").toUpperCase();
  if (v === "NEW") return "New";
  if (v === "USED_EXCELLENT" || v === "USED_VERY_GOOD" || v === "USED_GOOD" || v === "USED_ACCEPTABLE") {
    return "Used";
  }
  if (v === "CERTIFIED_REFURBISHED" || v === "REFURBISHED") return "Refurbished";
  return value?.trim() || "Unknown";
}

function toEbayItemFromBrowse(raw: any): EbayItem | null {
  const itemId =
    extractItemIdFromUrl(String(raw?.itemWebUrl ?? "")) ||
    String(raw?.legacyItemId ?? "").trim();
  if (!itemId) return null;
  const price = parseFirstNumber(raw?.price?.value) ?? 0;
  const shipping = parseFirstNumber(raw?.shippingOptions?.[0]?.shippingCost?.value) ?? 0;
  return {
    itemId,
    title: String(raw?.title ?? "").trim(),
    price,
    currency: String(raw?.price?.currency ?? "USD"),
    condition: normalizeConditionFromBrowse(raw?.condition),
    conditionId: undefined,
    seller: String(raw?.seller?.username ?? "").trim() || undefined,
    url: String(raw?.itemWebUrl ?? `https://www.ebay.com/itm/${itemId}`),
    shippingCost: shipping,
    totalPrice: price + shipping,
    imageUrl: raw?.image?.imageUrl || raw?.thumbnailImages?.[0]?.imageUrl,
    location: String(raw?.itemLocation?.country ?? "").trim() || undefined,
  };
}

async function browseGetItemByLegacyId(
  itemId: string,
  accessToken: string,
): Promise<{ item: EbayItem | null; httpStatus: number }> {
  try {
    const resp = await axios.get("https://api.ebay.com/buy/browse/v1/item/get_item_by_legacy_id", {
      params: { legacy_item_id: itemId },
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      timeout: 12000,
      validateStatus: () => true,
    });
    if (resp.status !== 200) {
      logger.warn({ itemId, status: resp.status, data: resp.data }, "Browse API get_item_by_legacy_id failed");
      return { item: null, httpStatus: resp.status };
    }
    return { item: toEbayItemFromBrowse(resp.data), httpStatus: resp.status };
  } catch (err) {
    logger.warn({ err, itemId }, "Browse API item fetch failed");
    return { item: null, httpStatus: 0 };
  }
}

async function fetchEbayItemByBrowseApi(itemId: string, accessToken: string): Promise<EbayItem | null> {
  const { item } = await browseGetItemByLegacyId(itemId, accessToken);
  return item;
}

async function searchItemsByTitleBrowseWithMeta(
  originalItem: EbayItem,
  accessToken: string,
): Promise<{ items: EbayItem[]; httpStatus: number }> {
  try {
    const keywords = originalItem.title.split(" ").slice(0, 8).join(" ").trim();
    if (!keywords) return { items: [], httpStatus: 0 };
    const resp = await axios.get("https://api.ebay.com/buy/browse/v1/item_summary/search", {
      params: {
        q: keywords,
        limit: 50,
        sort: "price",
      },
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      timeout: 12000,
      validateStatus: () => true,
    });
    if (resp.status !== 200) {
      logger.warn({ status: resp.status, data: resp.data, keywords }, "Browse API search failed");
      return { items: [], httpStatus: resp.status };
    }
    const rawItems = Array.isArray(resp.data?.itemSummaries) ? resp.data.itemSummaries : [];
    const items = rawItems
      .map((it: any) => toEbayItemFromBrowse(it))
      .filter((it: EbayItem | null): it is EbayItem => Boolean(it));
    return { items, httpStatus: resp.status };
  } catch (err) {
    logger.warn({ err }, "Browse API title search failed");
    return { items: [], httpStatus: 0 };
  }
}

async function searchItemsByTitleBrowse(originalItem: EbayItem, accessToken: string): Promise<EbayItem[]> {
  const { items } = await searchItemsByTitleBrowseWithMeta(originalItem, accessToken);
  return items;
}

function toEbayItemFromFinding(item: any): EbayItem {
  const price =
    parseFirstNumber(item.sellingStatus?.[0]?.currentPrice?.[0]?.__value__) ??
    parseFirstNumber(item.sellingStatus?.[0]?.convertedCurrentPrice?.[0]?.__value__) ??
    0;
  const shipping = parseFirstNumber(item.shippingInfo?.[0]?.shippingServiceCost?.[0]?.__value__) ?? 0;
  const itemUrl = item.viewItemURL?.[0] || "";
  return {
    itemId: item.itemId?.[0] || extractItemIdFromUrl(itemUrl) || "",
    title: item.title?.[0] || "",
    price,
    currency: item.sellingStatus?.[0]?.currentPrice?.[0]?.["@currencyId"] || "USD",
    condition: item.condition?.[0]?.conditionDisplayName?.[0] || "Unknown",
    conditionId: item.condition?.[0]?.conditionId?.[0],
    seller: item.sellerInfo?.[0]?.sellerUserName?.[0],
    url: itemUrl,
    shippingCost: shipping,
    totalPrice: price + shipping,
    imageUrl: item.galleryURL?.[0],
    location: item.location?.[0],
  };
}

export function extractItemIdFromUrl(url: string): string | null {
  const patterns = [
    /\/itm\/(?:[^/]+\/)?(\d+)/,
    /item=(\d+)/,
    /\/(\d{10,13})(?:\?|$)/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

function normalizeToken(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function parseFirstNumber(raw: string | undefined | null): number | undefined {
  if (!raw) return undefined;
  const normalized = String(raw).replace(/,/g, "");
  const m = normalized.match(/-?\d+(?:\.\d+)?/);
  if (!m) return undefined;
  const n = parseFloat(m[0]);
  return Number.isFinite(n) ? n : undefined;
}

function parseShoppingItemIdentifiers(item: any): ProductIdentifiers {
  const ids: ProductIdentifiers = { upc: [], ean: [], isbn: [] };
  if (item?.ProductDetails?.ProductReferenceID) {
    ids.epid = String(item.ProductDetails.ProductReferenceID);
  }
  const nvl = item?.ItemSpecifics?.NameValueList;
  const list = Array.isArray(nvl) ? nvl : nvl ? [nvl] : [];
  for (const entry of list) {
    const name = String(entry?.Name ?? entry?.name ?? "").trim();
    const rawVals = entry?.Value ?? entry?.value;
    const values = Array.isArray(rawVals) ? rawVals : rawVals != null ? [rawVals] : [];
    const vals = values.map((v: any) => String(v).trim()).filter(Boolean);
    const key = name.toLowerCase();
    if (key === "upc" || key.includes("upc")) {
      ids.upc.push(...vals);
    } else if (key === "ean") {
      ids.ean.push(...vals);
    } else if (key === "isbn" || key.includes("isbn")) {
      ids.isbn.push(...vals);
    } else if (key === "mpn" || key === "manufacturer part number" || key.includes("mpn")) {
      if (!ids.mpn && vals[0]) ids.mpn = vals[0];
    } else if (key === "brand" || key === "manufacturer" || key.includes("brand")) {
      if (!ids.brand && vals[0]) ids.brand = vals[0];
    }
  }
  ids.upc = [...new Set(ids.upc.map((x) => x.replace(/\D/g, "")))].filter(Boolean);
  ids.ean = [...new Set(ids.ean.map((x) => x.replace(/\D/g, "")))].filter(Boolean);
  ids.isbn = [...new Set(ids.isbn)];
  return ids;
}

async function fetchEbayItemByApi(itemId: string, appId: string): Promise<EbayItem | null> {
  try {
    // Shopping API endpoint is open.api.ebay.com (api.ebay.com may fail depending on routing).
    const resp = await axios.get("https://open.api.ebay.com/shopping", {
      params: {
        callname: "GetSingleItem",
        responseencoding: "JSON",
        appid: appId,
        siteid: "0",
        version: "967",
        ItemID: itemId,
        IncludeSelector: "Description,ItemSpecifics,ShippingCosts",
      },
      timeout: 10000,
      validateStatus: () => true,
    });

    if (resp.status !== 200) {
      logger.warn(
        { status: resp.status, itemId, data: resp.data },
        "eBay Shopping API non-200 response",
      );
      return null;
    }

    const item = resp.data?.Item;
    if (!item) return null;

    const price = parseFloat(item.CurrentPrice?.Value || "0");
    const shippingCost = parseFloat(item.ShippingCostSummary?.ShippingServiceCost?.Value || "0");
    const identifiers = parseShoppingItemIdentifiers(item);

    return {
      itemId,
      title: item.Title || "",
      price,
      currency: item.CurrentPrice?.CurrencyID || "USD",
      condition: item.ConditionDisplayName || "Unknown",
      conditionId: item.ConditionID,
      seller: item.Seller?.UserID,
      url: item.ViewItemURL || `https://www.ebay.com/itm/${itemId}`,
      shippingCost,
      totalPrice: price + shippingCost,
      imageUrl: item.PictureURL?.[0],
      location: item.Location,
      identifiers,
    };
  } catch (err) {
    logger.warn({ err, itemId }, "eBay Shopping API call failed, falling back to scrape");
    return null;
  }
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

async function fetchEbayItemByTradingApiEx(
  itemId: string,
  creds: TradingCreds,
): Promise<{
  item: EbayItem | null;
  ack: string | null;
  shortMessage: string | null;
  longMessage: string | null;
}> {
  const appId = creds.appId ?? process.env.EBAY_APP_ID ?? "";
  const devId = creds.devId ?? process.env.EBAY_DEV_ID ?? "";
  const certId = creds.certId ?? process.env.EBAY_CERT_ID ?? "";
  const userToken = creds.userToken ?? process.env.EBAY_USER_TOKEN ?? "";
  if (!appId || !devId || !certId || !userToken) {
    return { item: null, ack: null, shortMessage: null, longMessage: null };
  }

  const body = `<?xml version="1.0" encoding="utf-8"?>
<GetItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials>
    <eBayAuthToken>${xmlEscape(userToken)}</eBayAuthToken>
  </RequesterCredentials>
  <ItemID>${itemId}</ItemID>
  <IncludeItemSpecifics>true</IncludeItemSpecifics>
  <DetailLevel>ReturnAll</DetailLevel>
</GetItemRequest>`;

  try {
    const response = await axios.post("https://api.ebay.com/ws/api.dll", body, {
      timeout: 15000,
      headers: {
        "Content-Type": "text/xml",
        "X-EBAY-API-COMPATIBILITY-LEVEL": "967",
        "X-EBAY-API-CALL-NAME": "GetItem",
        "X-EBAY-API-SITEID": "0",
        "X-EBAY-API-APP-NAME": appId,
        "X-EBAY-API-DEV-NAME": devId,
        "X-EBAY-API-CERT-NAME": certId,
      },
      validateStatus: () => true,
    });
    const raw = String(response.data ?? "");
    const $ = cheerio.load(raw, { xmlMode: true });
    const ack = $("Ack").first().text().trim();
    const shortMessage = $("ShortMessage").first().text().trim() || null;
    const longMessage = $("LongMessage").first().text().trim() || null;
    if (!(ack === "Success" || ack === "Warning")) {
      logger.warn({ itemId, ack, short: shortMessage, long: longMessage }, "eBay Trading GetItem failed");
      return { item: null, ack: ack || null, shortMessage, longMessage };
    }
    const title = $("Item > Title").first().text().trim();
    const price =
      parseFirstNumber($("Item > CurrentPrice").first().text().trim()) ??
      parseFirstNumber($("Item > ConvertedCurrentPrice").first().text().trim()) ??
      parseFirstNumber($("Item > BuyItNowPrice").first().text().trim()) ??
      parseFirstNumber($("Item > StartPrice").first().text().trim()) ??
      0;
    const currency = $("Item > CurrentPrice").first().attr("currencyID") || "USD";
    const shipping =
      parseFirstNumber(
        $("Item > ShippingDetails > ShippingServiceOptions > ShippingServiceCost").first().text().trim(),
      ) ?? 0;
    const condition = $("Item > ConditionDisplayName").first().text().trim() || "Unknown";
    const url =
      $("Item > ListingDetails > ViewItemURL").first().text().trim() || `https://www.ebay.com/itm/${itemId}`;
    const imageUrl = $("Item > PictureDetails > PictureURL").first().text().trim() || undefined;
    const seller = $("Item > Seller > UserID").first().text().trim() || undefined;
    const location = $("Item > Location").first().text().trim() || undefined;

    const itemSpecificsPairs = $("Item > ItemSpecifics > NameValueList")
      .map((_, n) => ({
        Name: $(n).find("Name").first().text(),
        Value: $(n)
          .find("Value")
          .map((__, v) => $(v).text())
          .get(),
      }))
      .get();
    const identifiers = parseShoppingItemIdentifiers({
      ProductDetails: { ProductReferenceID: $("Item > ProductListingDetails > ProductReferenceID").first().text() },
      ItemSpecifics: { NameValueList: itemSpecificsPairs },
    });

    return {
      item: {
        itemId,
        title,
        price,
        currency,
        condition,
        seller,
        url,
        shippingCost: shipping,
        totalPrice: price + shipping,
        imageUrl,
        location,
        identifiers,
      },
      ack: ack || null,
      shortMessage,
      longMessage,
    };
  } catch (err) {
    logger.warn({ err, itemId }, "eBay Trading GetItem call failed");
    return { item: null, ack: null, shortMessage: null, longMessage: null };
  }
}

async function fetchEbayItemByTradingApi(itemId: string, creds: TradingCreds): Promise<EbayItem | null> {
  const { item } = await fetchEbayItemByTradingApiEx(itemId, creds);
  return item;
}

async function fetchEbayItemByFindingItemIdWithMeta(
  itemId: string,
  appId: string,
): Promise<{ item: EbayItem | null; httpStatus: number }> {
  try {
    const resp = await axios.get("https://svcs.ebay.com/services/search/FindingService/v1", {
      params: {
        "OPERATION-NAME": "findItemsAdvanced",
        "SERVICE-VERSION": "1.0.0",
        "SECURITY-APPNAME": appId,
        "RESPONSE-DATA-FORMAT": "JSON",
        keywords: itemId,
        "paginationInput.entriesPerPage": "25",
        sortOrder: "BestMatch",
      },
      timeout: 10000,
      validateStatus: () => true,
    });
    if (resp.status !== 200) {
      logger.warn(
        { itemId, status: resp.status, data: resp.data },
        "eBay Finding API HTTP error for itemId lookup",
      );
      return { item: null, httpStatus: resp.status };
    }
    const top = resp.data?.findItemsAdvancedResponse?.[0];
    const ack = String(top?.ack?.[0] ?? "").toLowerCase();
    if (ack && ack !== "success" && ack !== "warning") {
      logger.warn(
        {
          itemId,
          ack,
          error: top?.errorMessage?.[0]?.error?.[0]?.message?.[0],
        },
        "eBay Finding API returned failure for itemId lookup",
      );
      return { item: null, httpStatus: resp.status };
    }
    const items = top?.searchResult?.[0]?.item || [];
    if (!Array.isArray(items) || items.length === 0) return { item: null, httpStatus: resp.status };
    const picked =
      items.find((it: any) => {
        const url = String(it?.viewItemURL?.[0] ?? "");
        const id = extractItemIdFromUrl(url) ?? String(it?.itemId?.[0] ?? "");
        return id === itemId;
      }) ?? items[0];
    const parsed = toEbayItemFromFinding(picked);
    return { item: parsed.itemId ? parsed : null, httpStatus: resp.status };
  } catch (err) {
    logger.warn({ err, itemId }, "eBay Finding by itemId failed");
    return { item: null, httpStatus: 0 };
  }
}

async function fetchEbayItemByFindingItemId(itemId: string, appId: string): Promise<EbayItem | null> {
  const { item } = await fetchEbayItemByFindingItemIdWithMeta(itemId, appId);
  return item;
}

async function scrapeEbayItem(url: string): Promise<EbayItem | null> {
  try {
    const resp = await axios.get(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      },
      timeout: 15000,
    });

    if (typeof resp.data === "string" && resp.data.includes("/splashui/challenge")) {
      logger.warn({ url }, "eBay page challenge detected while scraping");
      return null;
    }

    const $ = cheerio.load(resp.data);

    const title =
      $("h1.x-item-title__mainTitle span").text().trim() ||
      $('[data-testid="x-item-title"] h1').text().trim() ||
      $("h1").first().text().trim();

    const priceText =
      $(".x-price-primary span.ux-textspans").first().text().trim() ||
      $('[data-testid="x-price-primary"] span').first().text().trim() ||
      $(".x-buybox__price span").first().text().trim();

    const price =
      parseFirstNumber(priceText) ??
      parseFirstNumber($('[itemprop="price"]').first().attr("content")) ??
      parseFirstNumber($('[data-testid="x-price-primary"]').first().text()) ??
      0;

    const shippingText =
      $(".ux-labels-values--shipping .ux-textspans").first().text().trim() ||
      $('[data-testid="ux-labels-values--shipping"] span').first().text().trim();

    let shippingCost = 0;
    if (shippingText.toLowerCase().includes("free")) {
      shippingCost = 0;
    } else {
      shippingCost = parseFirstNumber(shippingText) ?? 0;
    }

    const condition =
      $(".x-item-condition-text .ux-textspans").first().text().trim() ||
      $('[data-testid="x-item-condition-text"]').text().trim() ||
      "Unknown";

    const seller =
      $(".x-sellercard-atf__info__about-seller .ux-textspans").text().trim() ||
      $('[data-testid="ux-seller-section__item--seller"] span').text().trim();

    const imageUrl =
      $(".ux-image-carousel-item img").first().attr("src") ||
      $(".img-holder img").first().attr("src") ||
      $("img.img").first().attr("src");

    const location = $(".ux-textspans--BOLD")
      .filter((_, el) => {
        return $(el).parents(".ux-labels-values--itemLocation").length > 0;
      })
      .text()
      .trim();

    const itemId = extractItemIdFromUrl(url) || "unknown";
    const currency = priceText.includes("¥") ? "JPY" : "USD";

    const identifiers = scrapeIdentifiersFromHtml(resp.data);

    return {
      itemId,
      title,
      price,
      currency,
      condition,
      seller,
      url,
      shippingCost,
      totalPrice: price + shippingCost,
      imageUrl,
      location,
      identifiers,
    };
  } catch (err) {
    logger.error({ err, url }, "Failed to scrape eBay item");
    return null;
  }
}

function scrapeIdentifiersFromHtml(html: string): ProductIdentifiers | undefined {
  const ids: ProductIdentifiers = { upc: [], ean: [], isbn: [] };
  const upc = /"upc"\s*:\s*"([^"]+)"/i.exec(html)?.[1];
  const ean = /"ean"\s*:\s*"([^"]+)"/i.exec(html)?.[1];
  const isbn = /"isbn"\s*:\s*"([^"]+)"/i.exec(html)?.[1];
  const mpn = /"mpn"\s*:\s*"([^"]+)"/i.exec(html)?.[1];
  const brand = /"brand"\s*:\s*"([^"]+)"/i.exec(html)?.[1];
  if (upc) ids.upc.push(upc.replace(/\D/g, ""));
  if (ean) ids.ean.push(ean.replace(/\D/g, ""));
  if (isbn) ids.isbn.push(isbn);
  if (mpn) ids.mpn = mpn;
  if (brand) ids.brand = brand;
  if (!ids.upc.length && !ids.ean.length && !ids.isbn.length && !ids.mpn && !ids.brand) return undefined;
  return ids;
}

function normalizeTitle(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2);
}

function jaccardSimilarity(a: string[], b: string[]): number {
  const sa = new Set(a);
  const sb = new Set(b);
  const intersection = [...sa].filter((token) => sb.has(token)).length;
  const union = new Set([...sa, ...sb]).size;
  if (union === 0) return 0;
  return intersection / union;
}

function hasStrongIdentifiers(ids?: ProductIdentifiers): boolean {
  if (!ids) return false;
  if (ids.epid) return true;
  if (ids.upc.length || ids.ean.length || ids.isbn.length) return true;
  if (ids.mpn && ids.brand) return true;
  return false;
}

function identifiersMatch(a?: ProductIdentifiers, b?: ProductIdentifiers): boolean {
  if (!a || !b) return false;
  if (a.epid && b.epid && normalizeToken(a.epid) === normalizeToken(b.epid)) return true;
  const acodes = new Set([...a.upc, ...a.ean, ...a.isbn.map((x) => x.replace(/-/g, ""))]);
  const bcodes = new Set([...b.upc, ...b.ean, ...b.isbn.map((x) => x.replace(/-/g, ""))]);
  for (const c of acodes) {
    if (c && bcodes.has(c)) return true;
  }
  if (a.mpn && b.mpn && normalizeToken(a.mpn) === normalizeToken(b.mpn)) {
    if (a.brand && b.brand && normalizeToken(a.brand) === normalizeToken(b.brand)) return true;
    if (!a.brand || !b.brand) return true;
  }
  return false;
}

function isSameItemStrict(original: EbayItem, candidate: EbayItem): boolean {
  if (candidate.itemId && original.itemId && candidate.itemId === original.itemId) {
    return true;
  }
  if (identifiersMatch(original.identifiers, candidate.identifiers)) {
    return true;
  }
  const score = jaccardSimilarity(normalizeTitle(original.title), normalizeTitle(candidate.title));
  const aStrong = hasStrongIdentifiers(original.identifiers);
  const bStrong = hasStrongIdentifiers(candidate.identifiers);
  if (aStrong && bStrong) {
    return score >= 0.82;
  }
  if (aStrong || bStrong) {
    return score >= 0.88;
  }
  return score >= 0.72;
}

async function searchItemsByTitleWithMeta(
  originalItem: EbayItem,
  appId: string | undefined,
): Promise<{ items: EbayItem[]; httpStatus: number }> {
  if (!appId) {
    return { items: [], httpStatus: 0 };
  }

  try {
    const titleKeywords = originalItem.title.split(" ").slice(0, 6).join(" ").trim();
    const keywords = titleKeywords || originalItem.itemId || "";
    if (!keywords) return { items: [], httpStatus: 0 };

    const resp = await axios.get("https://svcs.ebay.com/services/search/FindingService/v1", {
      params: {
        "OPERATION-NAME": "findItemsAdvanced",
        "SERVICE-VERSION": "1.0.0",
        "SECURITY-APPNAME": appId,
        "RESPONSE-DATA-FORMAT": "JSON",
        keywords,
        "paginationInput.entriesPerPage": "20",
        "itemFilter(0).name": "Condition",
        "itemFilter(0).value(0)": "1000",
        "itemFilter(0).value(1)": "1500",
        "itemFilter(0).value(2)": "2000",
        "itemFilter(0).value(3)": "2500",
        "itemFilter(0).value(4)": "3000",
        "itemFilter(0).value(5)": "4000",
        "itemFilter(0).value(6)": "5000",
        "itemFilter(0).value(7)": "6000",
        sortOrder: "PricePlusShippingLowest",
      },
      timeout: 10000,
      validateStatus: () => true,
    });

    if (resp.status !== 200) {
      logger.warn(
        { status: resp.status, keywords, data: resp.data },
        "eBay Finding API HTTP error for title search",
      );
      return { items: [], httpStatus: resp.status };
    }

    const searchResult = resp.data?.findItemsAdvancedResponse?.[0];
    const ack = String(searchResult?.ack?.[0] ?? "").toLowerCase();
    if (ack && ack !== "success" && ack !== "warning") {
      logger.warn(
        {
          ack,
          error: searchResult?.errorMessage?.[0]?.error?.[0]?.message?.[0],
          keywords,
        },
        "eBay Finding API returned failure for title search",
      );
      return { items: [], httpStatus: resp.status };
    }
    const items = searchResult?.searchResult?.[0]?.item || [];

    return {
      items: items.map((item: any): EbayItem => toEbayItemFromFinding(item)),
      httpStatus: resp.status,
    };
  } catch (err) {
    logger.warn({ err }, "eBay Finding API failed");
    return { items: [], httpStatus: 0 };
  }
}

async function searchItemsByTitle(originalItem: EbayItem, appId: string | undefined): Promise<EbayItem[]> {
  const { items } = await searchItemsByTitleWithMeta(originalItem, appId);
  return items;
}

async function fetchPriceHintByFinding(itemId: string, appId: string): Promise<number | null> {
  try {
    const resp = await axios.get("https://svcs.ebay.com/services/search/FindingService/v1", {
      params: {
        "OPERATION-NAME": "findItemsAdvanced",
        "SERVICE-VERSION": "1.0.0",
        "SECURITY-APPNAME": appId,
        "RESPONSE-DATA-FORMAT": "JSON",
        keywords: itemId,
        "paginationInput.entriesPerPage": "10",
        sortOrder: "BestMatch",
      },
      timeout: 10000,
      validateStatus: () => true,
    });
    if (resp.status !== 200) {
      return null;
    }
    const items = resp.data?.findItemsAdvancedResponse?.[0]?.searchResult?.[0]?.item || [];
    const same = items.find((it: any) => {
      const url = String(it?.viewItemURL?.[0] ?? "");
      const iid = extractItemIdFromUrl(url);
      return iid === itemId;
    });
    const pick = same ?? items[0];
    const p = parseFirstNumber(pick?.sellingStatus?.[0]?.currentPrice?.[0]?.__value__);
    if (p && p > 0) return p;
    const s = parseFirstNumber(pick?.shippingInfo?.[0]?.shippingServiceCost?.[0]?.__value__) ?? 0;
    if (p && p + s > 0) return p + s;
    return null;
  } catch {
    return null;
  }
}

async function searchItemsByTitleScrape(originalItem: EbayItem): Promise<EbayItem[]> {
  try {
    const keywords = encodeURIComponent(originalItem.title.split(" ").slice(0, 5).join(" "));
    const searchUrl = `https://www.ebay.com/sch/i.html?_nkw=${keywords}&_sop=15&_ipg=20`;

    const resp = await axios.get(searchUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      },
      timeout: 15000,
    });

    const $ = cheerio.load(resp.data);
    const items: EbayItem[] = [];

    $(".s-item").each((_, el) => {
      const itemEl = $(el);

      const titleEl = itemEl.find(".s-item__title");
      const title = titleEl.text().trim();
      if (!title || title === "Shop on eBay") return;

      const itemUrl = itemEl.find(".s-item__link").attr("href") || "";
      const itemId = extractItemIdFromUrl(itemUrl) || "";

      const priceText = itemEl.find(".s-item__price").text().trim();
      const price = parseFirstNumber(priceText) ?? 0;

      const shippingText = itemEl.find(".s-item__shipping").text().trim();
      let shippingCost = 0;
      if (!shippingText.toLowerCase().includes("free")) {
        shippingCost = parseFirstNumber(shippingText) ?? 0;
      }

      const condition = itemEl.find(".SECONDARY_INFO").text().trim() || "Unknown";
      const seller = itemEl.find(".s-item__seller-info-text").text().trim();
      const imageUrl = itemEl.find("img").first().attr("src");
      const location = itemEl.find(".s-item__location").text().replace("from", "").trim();

      if (price > 0) {
        items.push({
          itemId,
          title,
          price,
          currency: "USD",
          condition,
          seller,
          url: itemUrl,
          shippingCost,
          totalPrice: price + shippingCost,
          imageUrl,
          location,
        });
      }
    });

    return items;
  } catch (err) {
    logger.error({ err }, "Failed to scrape eBay search");
    return [];
  }
}

async function enrichItemsWithShoppingApi(items: EbayItem[], appId: string, concurrency = 4): Promise<void> {
  const withIds = items.filter((i) => i.itemId);
  for (let i = 0; i < withIds.length; i += concurrency) {
    const chunk = withIds.slice(i, i + concurrency);
    await Promise.all(
      chunk.map(async (item) => {
        const full = await fetchEbayItemByApi(item.itemId, appId);
        if (full?.identifiers) {
          item.identifiers = full.identifiers;
        }
      }),
    );
  }
}

export async function fetchListingCondition(
  ebayUrl: string,
  appId?: string | null,
  tradingCreds?: TradingCreds,
): Promise<string> {
  const resolved = appId ?? process.env.EBAY_APP_ID ?? "";
  const itemId = extractItemIdFromUrl(ebayUrl);
  const { token: accessToken } = await getBuyApiAccessTokenFromDb();
  if (itemId && accessToken) {
    const viaBrowse = await fetchEbayItemByBrowseApi(itemId, accessToken);
    if (viaBrowse?.condition && viaBrowse.condition !== "Unknown") return viaBrowse.condition;
  }
  if (itemId && resolved) {
    const item = await fetchEbayItemByApi(itemId, resolved);
    if (item?.condition && item.condition !== "Unknown") return item.condition;
  }
  if (itemId) {
    const viaTrading = await fetchEbayItemByTradingApi(itemId, {
      appId: tradingCreds?.appId ?? resolved,
      devId: tradingCreds?.devId,
      certId: tradingCreds?.certId,
      userToken: tradingCreds?.userToken,
    });
    if (viaTrading?.condition && viaTrading.condition !== "Unknown") return viaTrading.condition;
  }
  if (itemId && resolved) {
    const viaFinding = await fetchEbayItemByFindingItemId(itemId, resolved);
    if (viaFinding?.condition && viaFinding.condition !== "Unknown") return viaFinding.condition;
  }
  return "Unknown";
}

export async function researchEbayItem(
  url: string,
  options?: { appId?: string | null; devId?: string | null; certId?: string | null; userToken?: string | null },
): Promise<{
  originalItem: EbayItem;
  lowestByCondition: Record<string, EbayItem>;
  allItems: EbayItem[];
  evidenceUrls: string[];
  diagnostics: EbayResearchDiagnostics;
}> {
  const appId = options?.appId ?? process.env.EBAY_APP_ID ?? undefined;
  const itemId = extractItemIdFromUrl(url);
  const { token: accessToken, authMethod } = await getBuyApiAccessTokenFromDb();
  const buyApiAuth =
    authMethod === "oauth_user_refresh" || authMethod === "client_credentials" ? authMethod : "none";

  let browseGetItemHttpStatus: number | null = null;
  let findingItemLookupHttpStatus: number | null = null;
  let tradingAck: string | null = null;
  let tradingErrorJa: string | null = null;

  let originalItem: EbayItem | null = null;
  const tradingCreds: TradingCreds = {
    appId: options?.appId,
    devId: options?.devId,
    certId: options?.certId,
    userToken: options?.userToken,
  };

  if (itemId && accessToken) {
    const br = await browseGetItemByLegacyId(itemId, accessToken);
    browseGetItemHttpStatus = br.httpStatus;
    originalItem = pickBetterItem(originalItem, br.item);
  }

  let shoppingHadPositivePrice = false;
  if (itemId && appId) {
    const shop = await fetchEbayItemByApi(itemId, appId);
    if (shop && (shop.totalPrice ?? 0) > 0) shoppingHadPositivePrice = true;
    originalItem = pickBetterItem(originalItem, shop);
  }

  if (itemId && (!isUsableEbayItem(originalItem) || !originalItem?.title?.trim())) {
    const tr = await fetchEbayItemByTradingApiEx(itemId, tradingCreds);
    tradingAck = tr.ack;
    if (tr.shortMessage || tr.longMessage) {
      tradingErrorJa = [tr.shortMessage, tr.longMessage].filter(Boolean).join(" — ") || null;
    }
    originalItem = pickBetterItem(originalItem, tr.item);
  }

  if (itemId && appId && (!isUsableEbayItem(originalItem) || !originalItem?.title?.trim())) {
    const fd = await fetchEbayItemByFindingItemIdWithMeta(itemId, appId);
    findingItemLookupHttpStatus = fd.httpStatus;
    originalItem = pickBetterItem(originalItem, fd.item);
  }

  if (!originalItem) {
    throw new Error("eBay APIから商品情報を取得できませんでした。設定で eBay App ID + OAuth Client Secret（Browse・在庫アプリと同様）、または AppID/DevID/CertID/UserToken、もしくは OAuth 連携を確認してください。");
  }

  // If listing detail fetch succeeded but price is missing/0, try Finding API hint.
  if ((originalItem.totalPrice ?? 0) <= 0 && itemId && appId) {
    const hinted = await fetchPriceHintByFinding(itemId, appId);
    if (hinted && hinted > 0) {
      originalItem.price = hinted;
      originalItem.totalPrice = hinted;
      originalItem.shippingCost = 0;
    }
  }
  if ((originalItem.totalPrice ?? 0) <= 0) {
    throw new Error("商品価格を取得できませんでした（eBay側の取得制限またはAPI応答不足）。");
  }

  const browseSearchP = accessToken
    ? searchItemsByTitleBrowseWithMeta(originalItem, accessToken)
    : Promise.resolve({ items: [] as EbayItem[], httpStatus: 0 });
  const findingSearchP = searchItemsByTitleWithMeta(originalItem, appId);

  const [browsePack, findingPack] = await Promise.all([browseSearchP, findingSearchP]);
  const browseSearchHttpStatus = accessToken ? browsePack.httpStatus : null;
  const findingSearchHttpStatus = findingPack.httpStatus;

  const browseItems = browsePack.items;
  const findingItems = findingPack.items;

  const dedupMap = new Map<string, EbayItem>();
  for (const item of [...browseItems, ...findingItems]) {
    if (!item.totalPrice || item.totalPrice <= 0) continue;
    const key = item.itemId || item.url;
    if (!key) continue;
    if (!dedupMap.has(key)) dedupMap.set(key, item);
  }
  const foundItems = Array.from(dedupMap.values());

  let prelim = foundItems.filter((item) => {
    if (item.itemId && originalItem!.itemId && item.itemId === originalItem!.itemId) return true;
    const score = jaccardSimilarity(
      normalizeTitle(originalItem!.title),
      normalizeTitle(item.title),
    );
    return score >= 0.45;
  });

  if (prelim.length === 0) {
    prelim = foundItems.filter((item) => {
      if (!item.totalPrice || item.totalPrice <= 0) return false;
      const score = jaccardSimilarity(
        normalizeTitle(originalItem!.title),
        normalizeTitle(item.title),
      );
      return score >= 0.2;
    });
  }

  if (appId && prelim.length) {
    await enrichItemsWithShoppingApi(prelim, appId, 4);
  }

  let allItems = prelim.filter((item) => isSameItemStrict(originalItem!, item));
  if (allItems.length === 0) {
    allItems = prelim.filter((item) => {
      if (!item.totalPrice || item.totalPrice <= 0) return false;
      const score = jaccardSimilarity(
        normalizeTitle(originalItem!.title),
        normalizeTitle(item.title),
      );
      return score >= 0.28;
    });
  }
  if (allItems.length === 0) {
    allItems = foundItems
      .filter((item) => item.totalPrice > 0)
      .sort((a, b) => a.totalPrice - b.totalPrice)
      .slice(0, 12);
  }

  const lowestByCondition: Record<string, EbayItem> = {};
  for (const item of allItems) {
    const cond = item.condition;
    if (!lowestByCondition[cond] || item.totalPrice < lowestByCondition[cond].totalPrice) {
      lowestByCondition[cond] = item;
    }
  }

  const evidenceUrls = allItems.map((item) => item.url).filter(Boolean);
  if (originalItem.url) {
    evidenceUrls.unshift(originalItem.url);
  }

  const hintsJa: string[] = [];
  if (buyApiAuth === "none") {
    hintsJa.push(
      "Browse API 用トークンがありません。設定に「OAuth Client Secret」を保存すると在庫アプリと同じクライアント認証で検索できます。",
    );
  }
  if (browseGetItemHttpStatus != null && browseGetItemHttpStatus !== 200) {
    hintsJa.push(`Browse 商品取得が HTTP ${browseGetItemHttpStatus} で失敗しました。Client Secret・キー有効性を確認してください。`);
  }
  if (tradingAck && tradingAck !== "Success" && tradingAck !== "Warning") {
    hintsJa.push(`Trading GetItem: ${tradingAck}${tradingErrorJa ? `（${tradingErrorJa}）` : ""}`);
  }
  if (findingItemLookupHttpStatus === 500 || findingSearchHttpStatus === 500) {
    hintsJa.push("Finding API が HTTP 500 を返しています。eBay 開発者コンソールのキー権限・Finding の有効化を確認してください。");
  }
  if (findingSearchHttpStatus != null && findingSearchHttpStatus !== 200 && findingSearchHttpStatus !== 500) {
    hintsJa.push(`Finding 検索が HTTP ${findingSearchHttpStatus} で失敗しました。`);
  }
  if (!accessToken && appId && findingItems.length === 0 && browseItems.length === 0) {
    hintsJa.push("競合検索には Browse トークンか有効な Finding API が必要です。");
  }

  const diagnostics: EbayResearchDiagnostics = {
    itemId,
    buyApiAuth,
    browseGetItemHttpStatus,
    shoppingHadPositivePrice,
    tradingAck,
    tradingErrorJa,
    findingItemLookupHttpStatus,
    browseSearchHttpStatus,
    findingSearchHttpStatus,
    competitorBrowseCount: browseItems.length,
    competitorFindingCount: findingItems.length,
    hintsJa,
  };

  return {
    originalItem,
    lowestByCondition,
    allItems,
    evidenceUrls: Array.from(new Set(evidenceUrls)),
    diagnostics,
  };
}
