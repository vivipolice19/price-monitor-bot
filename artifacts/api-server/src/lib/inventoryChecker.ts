import axios from "axios";
import { logger } from "./logger";

export interface InventoryCheckerProduct {
  id: number;
  mercari_url: string;
  ebay_url: string;
  purchase_price: number;
  ebay_price_usd: number;
  status: string;
  alert_status?: string;
  last_check?: string | null;
}

export interface InventoryProductsResponse {
  count: number;
  products: InventoryCheckerProduct[];
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

export async function fetchInventoryCheckerProducts(params: {
  baseUrl: string;
  apiKey?: string | null;
}): Promise<InventoryProductsResponse> {
  const base = normalizeBaseUrl(params.baseUrl.trim());
  const headers: Record<string, string> = {};
  if (params.apiKey) {
    headers.Authorization = `Bearer ${params.apiKey}`;
  }

  const resp = await axios.get<InventoryProductsResponse>(`${base}/api/products`, {
    headers,
    timeout: 20000,
    validateStatus: () => true,
  });

  if (resp.status !== 200 || !resp.data?.products) {
    logger.warn({ status: resp.status, data: resp.data }, "inventory checker /api/products failed");
    throw new Error(`在庫管理APIから商品一覧を取得できませんでした (HTTP ${resp.status})`);
  }

  return resp.data;
}

export async function triggerInventoryCheckerSync(params: {
  baseUrl: string;
  apiKey?: string | null;
}): Promise<{ success: boolean; message?: string; error?: string }> {
  const base = normalizeBaseUrl(params.baseUrl.trim());
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (params.apiKey) {
    headers.Authorization = `Bearer ${params.apiKey}`;
  }

  const resp = await axios.post(`${base}/api/sheets/sync`, {}, { headers, timeout: 30000, validateStatus: () => true });
  const data = resp.data as { success?: boolean; message?: string; error?: string };
  return {
    success: !!data.success,
    message: data.message,
    error: data.error,
  };
}
