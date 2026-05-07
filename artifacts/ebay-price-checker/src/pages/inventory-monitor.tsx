import { useListInventoryProducts, getListInventoryProductsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RefreshCw, ExternalLink, Search } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useLocation } from "wouter";

export function InventoryMonitorPage() {
  const [, navigate] = useLocation();

  const listQ = useListInventoryProducts({
    query: {
      queryKey: getListInventoryProductsQueryKey(),
      retry: false,
    },
  });

  const RESEARCH_PREFILL_KEY = "ebayPriceCheckerResearchPrefill";

  const moveToResearch = (ebayUrl: string, myPrice: number, row?: number | null) => {
    try {
      sessionStorage.setItem(
        RESEARCH_PREFILL_KEY,
        JSON.stringify({
          url: ebayUrl,
          myPrice: String(myPrice),
          row: row != null ? String(row) : undefined,
        }),
      );
    } catch {
      /* private mode 等 */
    }
    const qp = new URLSearchParams();
    qp.set("url", ebayUrl);
    qp.set("myPrice", String(myPrice));
    if (row != null && Number.isFinite(row)) qp.set("row", String(row));
    navigate(`/?${qp.toString()}`);
  };

  if (listQ.isLoading) {
    return (
      <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-4">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (listQ.isError) {
    const msg =
      (listQ.error as Error)?.message ||
      "在庫管理の URL が未設定の可能性があります。設定ページで「在庫チェック基準 URL」を保存してください。";
    return (
      <div className="p-4 md:p-8 max-w-3xl mx-auto">
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle>在庫一覧を取得できません</CardTitle>
            <CardDescription>{msg}</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const products = listQ.data?.products ?? [];

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">在庫から監視</h1>
        <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
          在庫一覧から通常の<strong>リサーチ画面</strong>へ移動します。監視開始はリサーチ結果を確認してから、
          あなたがURLを選んで実行してください（自動監視は行いません）。
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div>
            <CardTitle className="text-lg">在庫の商品</CardTitle>
            <CardDescription>{listQ.data?.count ?? 0} 件</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => listQ.refetch()} disabled={listQ.isFetching}>
            <RefreshCw className={listQ.isFetching ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            <span className="ml-2">再読込</span>
          </Button>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {products.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">在庫に商品がありません。</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-14">ID</TableHead>
                  <TableHead>ステータス</TableHead>
                  <TableHead>自分の売価(USD)</TableHead>
                  <TableHead className="min-w-[180px]">eBay URL</TableHead>
                  <TableHead>監視</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {products.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono text-xs">{p.id}</TableCell>
                    <TableCell>
                      <Badge variant={p.status === "active" ? "default" : "secondary"}>{p.status}</Badge>
                    </TableCell>
                    <TableCell className="tabular-nums">${Number(p.ebay_price_usd).toFixed(2)}</TableCell>
                    <TableCell className="max-w-[260px] truncate text-xs font-mono" title={p.ebay_url}>
                      {p.ebay_url ? (
                        <a
                          href={p.ebay_url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-primary hover:underline"
                        >
                          {p.ebay_url}
                          <ExternalLink className="h-3 w-3 shrink-0" />
                        </a>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell>
                      {p.monitorId != null ? (
                        <Badge variant="outline">ID {p.monitorId}</Badge>
                      ) : (
                        <span className="text-muted-foreground text-xs">なし</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        disabled={!p.ebay_url?.trim()}
                        onClick={() => p.ebay_url && moveToResearch(p.ebay_url, Number(p.ebay_price_usd), p.monitorRow)}
                      >
                        <Search className="h-3.5 w-3.5 mr-1" />
                        リサーチへ移動
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
