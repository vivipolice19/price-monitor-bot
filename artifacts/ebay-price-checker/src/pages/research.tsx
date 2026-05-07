import { useRef, useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { useLocation } from "wouter";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useResearchPrice, useGetSpreadsheetRow, getGetSpreadsheetRowQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Search, PlusCircle, ExternalLink, Package } from "lucide-react";
import { CreateMonitorDialog } from "@/components/create-monitor-dialog";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const formSchema = z.object({
  url: z.string().url("有効なeBayのURLを入力してください"),
  myPrice: z.string().optional(),
  row: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

function formatResearchError(err: unknown): string {
  const msg =
    err && typeof err === "object" && "message" in err
      ? String((err as Error).message)
      : String(err ?? "");
  if (/Failed query|spreadsheet_config|42P01|does not exist/i.test(msg)) {
    return "データベースの準備ができていません。管理者向け: drizzle-kit push でテーブルを作成してください。";
  }
  if (/App ID|APP_ID|appId|api key/i.test(msg)) {
    return "eBay の App ID が必要です。Render の環境変数 EBAY_APP_ID を設定するか、設定ページで eBay App ID を保存してください。";
  }
  return msg.trim() || "リサーチに失敗しました。URL とネット接続を確認してください。";
}

export function Research() {
  const [location] = useLocation();
  const [selectedItemForMonitor, setSelectedItemForMonitor] = useState<any>(null);
  const research = useResearchPrice();
  const didAutoFetchRowRef = useRef(false);
  
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      url: "",
      myPrice: "",
      row: "",
    },
  });

  const RESEARCH_PREFILL_KEY = "ebayPriceCheckerResearchPrefill";

  // 在庫ページ「リサーチへ移動」: ?url= &myPrice= &row= または sessionStorage の引き継ぎ
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    let urlParam = params.get("url")?.trim();
    let priceParam = params.get("myPrice");
    let rowParam = params.get("row");

    if (urlParam) {
      try {
        sessionStorage.removeItem(RESEARCH_PREFILL_KEY);
      } catch {
        /* noop */
      }
    }

    if (!urlParam) {
      try {
        const raw = sessionStorage.getItem(RESEARCH_PREFILL_KEY);
        if (raw) {
          const o = JSON.parse(raw) as { url?: string; myPrice?: string; row?: string };
          sessionStorage.removeItem(RESEARCH_PREFILL_KEY);
          urlParam = o.url?.trim();
          if (o.myPrice != null && o.myPrice !== "") priceParam = o.myPrice;
          if (o.row != null && o.row !== "") rowParam = o.row;
        }
      } catch {
        sessionStorage.removeItem(RESEARCH_PREFILL_KEY);
      }
    }

    if (!urlParam) return;

    form.setValue("url", urlParam);
    if (priceParam != null && priceParam !== "") {
      form.setValue("myPrice", priceParam);
    }
    if (rowParam != null && rowParam !== "") {
      form.setValue("row", rowParam);
    }

    params.delete("url");
    params.delete("myPrice");
    params.delete("row");
    const rest = params.toString();
    const pathOnly = window.location.pathname + (rest ? `?${rest}` : "");
    window.history.replaceState(window.history.state, "", pathOnly);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 在庫→リサーチの1回だけ同期（location 変化時）
  }, [location]);

  const rowValue = form.watch("row");
  const { refetch: fetchRow, isFetching: isFetchingRow } = useGetSpreadsheetRow(rowValue ? Number(rowValue) : 0, {
    query: {
      enabled: false,
      queryKey: getGetSpreadsheetRowQueryKey(rowValue ? Number(rowValue) : 0)
    }
  });

  const handleFetchPrice = async () => {
    if (!rowValue) return;
    try {
      const result = await fetchRow();
      if (result.data && result.data.found) {
        if (result.data.ebayUrl) {
          form.setValue("url", result.data.ebayUrl);
        }
        if (result.data.myPrice !== undefined) {
          form.setValue("myPrice", result.data.myPrice.toString());
        }
      }
    } catch (e) {
      // Error handled silently here
    }
  };

  // URL が指定されていないが row が指定されている場合は、行から自動で URL/価格 を取得
  useEffect(() => {
    const url = form.getValues("url")?.trim();
    if (url) return;
    if (!rowValue) return;
    if (didAutoFetchRowRef.current) return;
    didAutoFetchRowRef.current = true;
    handleFetchPrice();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- row 指定の初回だけ自動取得
  }, [rowValue, location]);

  function onSubmit(data: FormValues) {
    research.mutate({
      data: {
        url: data.url,
        myPrice: data.myPrice ? Number(data.myPrice) : undefined,
      }
    });
  }

  const result = research.data;

  return (
    <div className="p-4 md:p-8 max-w-[1400px] mx-auto space-y-6 md:space-y-8">
      <div>
        <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-foreground">価格リサーチ</h1>
        <p className="text-muted-foreground mt-2 text-sm md:text-base leading-relaxed">
          調べたい商品の <strong>eBay 出品 URL</strong> を入れて「分析する」を押すだけです。競合検索に <strong>Browse API</strong> を使う場合は、設定で <strong>eBay App ID</strong> と <strong>OAuth Client Secret</strong>（在庫管理アプリのクライアント秘密と同じ種類）を保存してください。シート連携を使う場合だけ、行番号と自分の価格を入力します（任意）。
        </p>
      </div>

      <Card className="border-0 shadow-sm ring-1 ring-border/50 bg-white">
        <CardContent className="p-4 md:p-6">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col md:flex-row items-stretch md:items-end gap-4 md:gap-5">
              <FormField
                control={form.control}
                name="url"
                render={({ field }) => (
                  <FormItem className="flex-1 w-full">
                    <FormLabel className="font-semibold text-sm text-foreground">① eBay の商品 URL（必須）</FormLabel>
                    <FormControl>
                      <Input placeholder="https://www.ebay.com/itm/..." className="h-11 font-mono text-sm shadow-sm focus-visible:ring-primary/30" {...field} />
                    </FormControl>
                    <p className="text-xs text-muted-foreground">ブラウザのアドレスバーからそのままコピーできます。</p>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <div className="flex flex-col sm:flex-row gap-4 w-full md:w-auto">
                <FormField
                  control={form.control}
                  name="row"
                  render={({ field }) => (
                    <FormItem className="w-full sm:w-28">
                      <FormLabel className="font-semibold text-sm text-foreground">② シートの行番号（任意）</FormLabel>
                      <FormControl>
                        <Input placeholder="例: 5 （シート左の行番号と同じ）" className="h-11 tabular-nums focus-visible:ring-primary/30 shadow-sm" inputMode="numeric" {...field} />
                      </FormControl>
                      <p className="text-xs text-muted-foreground leading-snug pt-1">
                        Googleシート連携済みで、その行にある<strong>自分の売価</strong>を自動で読み込みたいときだけ入力。「取得」を押すと自分の売価欄に読み込みます。シートを使わないときは<strong>空欄でそのままでOK</strong>
                        です。
                      </p>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={form.control}
                  name="myPrice"
                  render={({ field }) => (
                    <FormItem className="w-full sm:w-44">
                      <FormLabel className="font-semibold text-sm text-foreground">③ 自分の価格 USD（任意）</FormLabel>
                      <FormControl>
                        <div className="relative flex">
                          <Input type="number" step="0.01" placeholder="0.00" className="h-11 pl-6 font-mono tabular-nums shadow-sm focus-visible:ring-primary/30 rounded-r-none" {...field} />
                          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/70 font-medium">$</span>
                          <Button 
                            type="button" 
                            variant="secondary" 
                            onClick={handleFetchPrice} 
                            disabled={!rowValue || isFetchingRow}
                            className="h-11 rounded-l-none border-l-0 px-3 bg-muted hover:bg-muted/80 text-muted-foreground"
                            title="シートの行から価格を読み込む"
                          >
                            {isFetchingRow ? <Loader2 className="h-4 w-4 animate-spin" /> : "取得"}
                          </Button>
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <Button type="submit" disabled={research.isPending} className="h-11 px-8 font-bold shadow-sm w-full md:w-auto shrink-0">
                {research.isPending ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> 分析中…</>
                ) : (
                  <><Search className="mr-2 h-4 w-4" /> 分析する</>
                )}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>

      {research.isError && (
        <div className="bg-destructive/10 text-destructive border border-destructive/20 p-4 rounded-md text-sm leading-relaxed">
          <p className="font-semibold mb-1">エラー</p>
          <p>{formatResearchError(research.error)}</p>
        </div>
      )}

      {result && (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
          {result.diagnostics?.hintsJa?.length ? (
            <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 px-4 py-3 text-sm text-foreground/90">
              <p className="font-semibold text-amber-900 dark:text-amber-100 mb-2">
                接続状況（リサーチは実行済みです）
              </p>
              <ul className="list-disc pl-5 space-y-1.5 leading-relaxed">
                {result.diagnostics.hintsJa.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
              <details className="mt-3 text-xs text-muted-foreground">
                <summary className="cursor-pointer font-medium text-foreground/80">技術メモを表示</summary>
                <pre className="mt-2 p-3 rounded-md bg-muted/50 overflow-x-auto whitespace-pre-wrap break-all">
                  {JSON.stringify(
                    {
                      buyApiAuth: result.diagnostics.buyApiAuth,
                      oauthClientCredAttempted: result.diagnostics.oauthClientCredAttempted,
                      oauthClientCredHttpStatus: result.diagnostics.oauthClientCredHttpStatus,
                      oauthClientCredErrorJa: result.diagnostics.oauthClientCredErrorJa,
                      browseGetItemHttpStatus: result.diagnostics.browseGetItemHttpStatus,
                      shoppingHadPositivePrice: result.diagnostics.shoppingHadPositivePrice,
                      tradingAck: result.diagnostics.tradingAck,
                      findingItemLookupHttpStatus: result.diagnostics.findingItemLookupHttpStatus,
                      browseSearchHttpStatus: result.diagnostics.browseSearchHttpStatus,
                      findingSearchHttpStatus: result.diagnostics.findingSearchHttpStatus,
                      competitorBrowseCount: result.diagnostics.competitorBrowseCount,
                      competitorFindingCount: result.diagnostics.competitorFindingCount,
                    },
                    null,
                    2,
                  )}
                </pre>
              </details>
            </div>
          ) : null}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <Card className="lg:col-span-1 border-0 shadow-sm ring-1 ring-border/50 overflow-hidden flex flex-col">
              <div className="bg-sidebar p-4 border-b border-sidebar-border">
                <h3 className="font-bold text-sidebar-foreground tracking-tight text-sm">入力した出品</h3>
              </div>
              <CardContent className="p-0 flex-1 flex flex-col">
                <div className="aspect-[4/3] bg-muted relative border-b">
                  {result.originalItem.imageUrl ? (
                    <img src={result.originalItem.imageUrl} alt={result.originalItem.title} className="w-full h-full object-contain p-4" />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center text-muted-foreground/50">
                      <Package className="h-12 w-12 mb-2" />
                      <span className="text-xs font-medium uppercase">No Image</span>
                    </div>
                  )}
                  <div className="absolute top-3 left-3">
                    <Badge variant="secondary" className="bg-background/90 backdrop-blur-sm border-0 shadow-sm font-semibold">
                      {result.originalItem.condition || "Unknown"}
                    </Badge>
                  </div>
                </div>
                <div className="p-5 flex-1 flex flex-col">
                  <h3 className="font-semibold text-sm leading-snug mb-4 line-clamp-3 text-foreground/90" title={result.originalItem.title}>
                    {result.originalItem.title}
                  </h3>
                  <div className="mt-auto">
                    <div className="flex justify-between items-baseline mb-4">
                      <span className="text-xs font-semibold text-muted-foreground">表示価格</span>
                      <span className="font-mono text-2xl font-extrabold tabular-nums">${result.originalItem.price.toFixed(2)}</span>
                    </div>
                    <Button variant="outline" className="w-full font-semibold border-primary/20 text-primary hover:bg-primary/5" asChild>
                      <a href={result.originalItem.url} target="_blank" rel="noreferrer">
                        eBay で開く <ExternalLink className="ml-2 h-4 w-4" />
                      </a>
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="lg:col-span-2 border-0 shadow-sm ring-1 ring-border/50 flex flex-col">
              <div className="bg-sidebar p-4 border-b border-sidebar-border">
                <h3 className="font-bold text-sidebar-foreground tracking-tight text-sm">コンディション別の最安</h3>
              </div>
              <CardContent className="p-0 flex-1 bg-muted/10">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-5">
                  {Object.entries(result.lowestByCondition).map(([condition, item]) => (
                    <div key={condition} className="bg-card rounded-lg border shadow-sm overflow-hidden flex flex-col hover:border-primary/40 transition-colors">
                      <div className="p-3 border-b bg-muted/30 flex justify-between items-center">
                        <span className="font-bold text-sm truncate">{condition}</span>
                        <Badge variant="outline" className="text-[10px] font-mono bg-background">候補内の最安</Badge>
                      </div>
                      <div className="p-4 flex gap-4">
                        <div className="w-16 h-16 rounded bg-muted shrink-0 border overflow-hidden flex items-center justify-center">
                          {item.imageUrl ? (
                            <img src={item.imageUrl} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <Package className="h-6 w-6 text-muted-foreground/30" />
                          )}
                        </div>
                        <div className="flex-1 flex flex-col justify-center">
                          <div className="font-mono text-xl font-extrabold text-primary tabular-nums">
                            ${item.totalPrice.toFixed(2)}
                          </div>
                          <div className="text-xs text-muted-foreground font-medium mt-1 truncate">
                            {item.seller || "Unknown Seller"}
                          </div>
                        </div>
                      </div>
                      <div className="px-4 py-3 bg-muted/20 border-t mt-auto">
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            className="flex-1 font-semibold border-primary/20 text-primary hover:bg-primary/5"
                            asChild
                          >
                            <a href={item.url} target="_blank" rel="noreferrer">
                              eBayで開く <ExternalLink className="ml-2 h-4 w-4" />
                            </a>
                          </Button>
                          <Button
                            size="sm"
                            variant="default"
                            className="flex-1 font-bold shadow-sm"
                            onClick={() => setSelectedItemForMonitor(item)}
                          >
                            <PlusCircle className="mr-2 h-4 w-4" /> 監視
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                  {Object.keys(result.lowestByCondition).length === 0 && (
                    <div className="col-span-full py-12 text-center text-muted-foreground font-medium">
                      同条件の競合が見つかりませんでした。
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          <Card className="border-0 shadow-sm ring-1 ring-border/50">
            <div className="bg-sidebar p-4 border-b border-sidebar-border flex justify-between items-center">
              <h3 className="font-bold text-sidebar-foreground tracking-tight text-sm uppercase flex items-center">
                すべての候補 <Badge variant="secondary" className="ml-3 bg-sidebar-accent text-sidebar-accent-foreground border-0">{result.allItems.length}</Badge>
              </h3>
            </div>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader className="bg-muted/40">
                    <TableRow className="hover:bg-muted/40">
                      <TableHead className="w-12 text-center py-4"></TableHead>
                      <TableHead className="w-48 py-4 font-semibold text-xs">状態</TableHead>
                      <TableHead className="py-4 font-semibold text-xs text-right">価格</TableHead>
                      <TableHead className="py-4 font-semibold text-xs text-right">送料</TableHead>
                      <TableHead className="py-4 font-semibold text-xs text-right">合計</TableHead>
                      <TableHead className="py-4 font-semibold text-xs">出品者</TableHead>
                      <TableHead className="text-right py-4 font-semibold text-xs">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.allItems.map((item, i) => (
                      <TableRow key={`${item.itemId}-${i}`} className="group hover:bg-muted/20 transition-colors">
                        <TableCell className="p-2">
                          <div className="w-10 h-10 rounded border bg-card flex items-center justify-center overflow-hidden mx-auto">
                            {item.imageUrl ? (
                              <img src={item.imageUrl} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <Package className="h-4 w-4 text-muted-foreground/30" />
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="font-medium text-sm p-4">
                          {item.condition || "Unknown"}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums p-4 text-muted-foreground">${item.price.toFixed(2)}</TableCell>
                        <TableCell className="text-right font-mono tabular-nums p-4 text-muted-foreground text-xs">
                          {item.shippingCost ? `+$${item.shippingCost.toFixed(2)}` : "Free"}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums p-4 font-bold text-primary">${item.totalPrice.toFixed(2)}</TableCell>
                        <TableCell className="p-4">
                          <span className="inline-block max-w-[120px] truncate text-sm font-medium">{item.seller}</span>
                        </TableCell>
                        <TableCell className="p-4 text-right">
                          {/* On mobile there is no hover, so keep actions visible. */}
                          <div className="flex justify-end gap-2 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                            <Button size="sm" variant="outline" className="h-8 font-semibold" asChild>
                              <a href={item.url} target="_blank" rel="noreferrer">
                                開く <ExternalLink className="ml-2 h-4 w-4" />
                              </a>
                            </Button>
                            <Button size="sm" variant="default" className="h-8 font-bold px-3 shadow-sm" onClick={() => setSelectedItemForMonitor(item)}>
                              この価格で監視
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {selectedItemForMonitor && (
        <CreateMonitorDialog 
          open={!!selectedItemForMonitor} 
          onOpenChange={(open) => !open && setSelectedItemForMonitor(null)}
          defaultValues={{
            ebayUrl: selectedItemForMonitor.url || form.getValues("url"),
            myPrice: form.getValues("myPrice") ? Number(form.getValues("myPrice")) : selectedItemForMonitor.price,
            spreadsheetRow: form.getValues("row") ? Number(form.getValues("row")) : undefined,
            myCondition: selectedItemForMonitor.condition || "New",
            label: selectedItemForMonitor.title,
          }}
        />
      )}
    </div>
  );
}
