import axios from "axios";
import * as cheerio from "cheerio";
import { logger } from "./logger";

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
    const resp = await axios.get("https://api.ebay.com/shopping", {
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
    });

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
    logger.warn({ err, itemId }, "eBay API call failed, falling back to scrape");
    return null;
  }
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

    const $ = cheerio.load(resp.data);

    const title =
      $("h1.x-item-title__mainTitle span").text().trim() ||
      $('[data-testid="x-item-title"] h1').text().trim() ||
      $("h1").first().text().trim();

    const priceText =
      $(".x-price-primary span.ux-textspans").first().text().trim() ||
      $('[data-testid="x-price-primary"] span').first().text().trim() ||
      $(".x-buybox__price span").first().text().trim();

    const price = parseFloat(priceText.replace(/[^0-9.]/g, "")) || 0;

    const shippingText =
      $(".ux-labels-values--shipping .ux-textspans").first().text().trim() ||
      $('[data-testid="ux-labels-values--shipping"] span').first().text().trim();

    let shippingCost = 0;
    if (shippingText.toLowerCase().includes("free")) {
      shippingCost = 0;
    } else {
      shippingCost = parseFloat(shippingText.replace(/[^0-9.]/g, "")) || 0;
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

async function searchItemsByTitle(originalItem: EbayItem, appId: string | undefined): Promise<EbayItem[]> {
  if (!appId) {
    return searchItemsByTitleScrape(originalItem);
  }

  try {
    const keywords = originalItem.title.split(" ").slice(0, 6).join(" ");

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
    });

    const searchResult = resp.data?.findItemsAdvancedResponse?.[0];
    const items = searchResult?.searchResult?.[0]?.item || [];

    return items.map((item: any): EbayItem => {
      const price = parseFloat(item.sellingStatus?.[0]?.currentPrice?.[0]?.__value__ || "0");
      const shipping = parseFloat(item.shippingInfo?.[0]?.shippingServiceCost?.[0]?.__value__ || "0");
      return {
        itemId: item.itemId?.[0] || "",
        title: item.title?.[0] || "",
        price,
        currency: item.sellingStatus?.[0]?.currentPrice?.[0]?.["@currencyId"] || "USD",
        condition: item.condition?.[0]?.conditionDisplayName?.[0] || "Unknown",
        conditionId: item.condition?.[0]?.conditionId?.[0],
        seller: item.sellerInfo?.[0]?.sellerUserName?.[0],
        url: item.viewItemURL?.[0] || "",
        shippingCost: shipping,
        totalPrice: price + shipping,
        imageUrl: item.galleryURL?.[0],
        location: item.location?.[0],
      };
    });
  } catch (err) {
    logger.warn({ err }, "eBay Finding API failed, falling back to scrape search");
    return searchItemsByTitleScrape(originalItem);
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
      const price = parseFloat(priceText.replace(/[^0-9.]/g, "")) || 0;

      const shippingText = itemEl.find(".s-item__shipping").text().trim();
      let shippingCost = 0;
      if (!shippingText.toLowerCase().includes("free")) {
        shippingCost = parseFloat(shippingText.replace(/[^0-9.]/g, "")) || 0;
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

export async function fetchListingCondition(ebayUrl: string, appId?: string | null): Promise<string> {
  const resolved = appId ?? process.env.EBAY_APP_ID ?? "";
  const itemId = extractItemIdFromUrl(ebayUrl);
  if (itemId && resolved) {
    const item = await fetchEbayItemByApi(itemId, resolved);
    if (item?.condition) return item.condition;
  }
  const scraped = await scrapeEbayItem(ebayUrl);
  return scraped?.condition ?? "Unknown";
}

export async function researchEbayItem(
  url: string,
  options?: { appId?: string | null },
): Promise<{
  originalItem: EbayItem;
  lowestByCondition: Record<string, EbayItem>;
  allItems: EbayItem[];
  evidenceUrls: string[];
}> {
  const appId = options?.appId ?? process.env.EBAY_APP_ID ?? undefined;
  const itemId = extractItemIdFromUrl(url);

  let originalItem: EbayItem | null = null;

  if (itemId && appId) {
    originalItem = await fetchEbayItemByApi(itemId, appId);
  }

  if (!originalItem) {
    originalItem = await scrapeEbayItem(url);
  }

  if (!originalItem) {
    throw new Error("商品情報を取得できませんでした。URLを確認してください。");
  }

  const foundItems = await searchItemsByTitle(originalItem, appId);

  const prelim = foundItems.filter((item) => {
    if (item.itemId && originalItem!.itemId && item.itemId === originalItem!.itemId) return true;
    const score = jaccardSimilarity(
      normalizeTitle(originalItem!.title),
      normalizeTitle(item.title),
    );
    return score >= 0.45;
  });

  if (appId && prelim.length) {
    await enrichItemsWithShoppingApi(prelim, appId, 4);
  }

  const allItems = prelim.filter((item) => isSameItemStrict(originalItem!, item));

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

  return { originalItem, lowestByCondition, allItems, evidenceUrls: Array.from(new Set(evidenceUrls)) };
}
