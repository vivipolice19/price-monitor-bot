import { useEffect, useMemo, useState } from "react";
import {
  useListInventoryProducts,
  useInventoryResearchProduct,
  useCreateMonitorFromInventory,
  getListInventoryProductsQueryKey,
  getListMonitorsQueryKey,
  type InventoryResearchResponse,
  type InventoryProductRow,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, RefreshCw, Package, ExternalLink, Link2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export function InventoryMonitorPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const listQ = useListInventoryProducts({
    query: {
      queryKey: getListInventoryProductsQueryKey(),
      retry: false,
    },
  });

  const researchMut = useInventoryResearchProduct();
  const createMut = useCreateMonitorFromInventory();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [activeProduct, setActiveProduct] = useState<InventoryProductRow | null>(null);
  const [research, setResearch] = useState<InventoryResearchResponse | null>(null);
  const [seedUrl, setSeedUrl] = useState<string>("");
  const [myCondition, setMyCondition] = useState<string>("New");
  const [myPriceInput, setMyPriceInput] = useState<string>("");

  const conditionOptions = useMemo(() => {
    if (!research) return ["New", "Used"];
    const fromLow = Object.keys(research.lowestByCondition ?? {});
    const base = research.originalItem?.condition;
    const set = new Set<string>([...fromLow, base, myCondition].filter(Boolean) as string[]);
    return Array.from(set);
  }, [research, myCondition]);

  const openDialogForProduct = (p: InventoryProductRow) => {
    setActiveProduct(p);
    setResearch(null);
    setSeedUrl(p.ebay_url?.trim() ?? "");
    setMyPriceInput(String(p.ebay_price_usd ?? ""));
    setDialogOpen(true);
    researchMut.mutate(
      { data: { inventoryProductId: p.id } },
      {
        onSuccess: (data) => {
          setResearch(data);
          const inv = data.inventoryProduct;
          const u = inv.ebay_url?.trim() ?? "";
          setSeedUrl(u);
          setMyPriceInput(String(inv.ebay_price_usd ?? ""));
          const c = data.originalItem?.condition;
          if (c) setMyCondition(c);
        },
        onError: (e: Error & { data?: unknown }) => {
          toast({
            variant: "destructive",
            title: "リサーチに失敗しました",
            description: e.message,
          });
        },
      },
    );
  };

  useEffect(() => {
    if (!dialogOpen) {
      setActiveProduct(null);
      setResearch(null);
    }
  }, [dialogOpen]);

  const handleStartMonitor = () => {
    if (!activeProduct) return;
    const price = parseFloat(myPriceInput);
    if (!Number.isFinite(price)) {
      toast({ variant: "destructive", title: "価格が不正です" });
      return;
    }
    if (!myCondition.trim()) {
      toast({ variant: "destructive", title: "コンディションを選んでください" });
      return;
    }
    const invUrl = activeProduct.ebay_url?.trim() ?? "";
    const body = {
      inventoryProductId: activeProduct.id,
      myCondition: myCondition.trim(),
      myPrice: price,
      seedEbayUrl:
        seedUrl.trim() && seedUrl.trim() !== invUrl ? seedUrl.trim() : undefined,
    };
    createMut.mutate(
      { data: body },
      {
        onSuccess: (res) => {
          toast({
            title: res.updated ? "監視を更新しました" : "監視を登録しました",
            description: `モニター ID ${res.id} / 起点URLは ${res.ebayUrl.slice(0, 48)}…`,
          });
          queryClient.invalidateQueries({ queryKey: getListInventoryProductsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListMonitorsQueryKey() });
          setDialogOpen(false);
        },
        onError: (e: Error) =>
          toast({ variant: "destructive", title: "保存に失敗", description: e.message }),
      },
    );
  };

  const candidateEntries = useMemo(() => {
    if (!research) return [];
    type Row = { url: string; label: string; price: number; condition: string; total: number; isOwn: boolean };
    const rows: Row[] = [];
    const own = research.inventoryProduct?.ebay_url?.trim() ?? "";
    const seen = new Set<string>();
    const push = (r: Row) => {
      if (seen.has(r.url)) return;
      seen.add(r.url);
      rows.push(r);
    };
    push({
      url: research.originalItem.url,
      label: "起点となった出品（同一商品として解析）",
      price: research.originalItem.price,
      condition: research.originalItem.condition || "—",
      total: research.originalItem.totalPrice,
      isOwn: own.length > 0 && research.originalItem.url.includes(own.split("?")[0] ?? ""),
    });
    for (const it of research.allItems ?? []) {
      push({
        url: it.url,
        label: it.title?.slice(0, 60) ?? it.itemId,
        price: it.price,
        condition: it.condition || "—",
        total: it.totalPrice,
        isOwn: own.length > 0 && it.url.includes(own.split("?")[0] ?? ""),
      });
    }
    return rows;
  }, [research]);

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
          出品管理アプリ（設定のベース URL）の一覧を読み、各行の eBay 出品を<strong>自動リサーチ</strong>
          したうえで、監視の<strong>起点 URL</strong>（通常は自分の出品）と<strong>自分のコンディション</strong>
          を選び、定期追跡に登録します。既に監視がある行は更新されます。
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
                    <TableCell className="max-w-[220px] truncate text-xs font-mono" title={p.ebay_url}>
                      {p.ebay_url || "—"}
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
                        onClick={() => openDialogForProduct(p)}
                      >
                        <Link2 className="h-3.5 w-3.5 mr-1" />
                        リサーチ→監視
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>同一商品リサーチ → 監視登録</DialogTitle>
            <DialogDescription>
              下の一覧から<strong>監視の起点</strong>になる出品 URL を1つ選びます。通常は自分の出品（在庫と同じ URL）のままです。コンディションはアラート比較に使います。
            </DialogDescription>
          </DialogHeader>

          {!research && researchMut.isPending ? (
            <div className="flex items-center gap-2 py-12 text-muted-foreground justify-center">
              <Loader2 className="h-6 w-6 animate-spin" />
              リサーチ中…
            </div>
          ) : research ? (
            <div className="space-y-4">
              <div className="flex gap-3 rounded-lg border p-3 bg-muted/30">
                <div className="h-16 w-16 rounded bg-muted flex items-center justify-center shrink-0 overflow-hidden">
                  {research.originalItem.imageUrl ? (
                    <img src={research.originalItem.imageUrl} alt="" className="h-full w-full object-contain" />
                  ) : (
                    <Package className="h-8 w-8 text-muted-foreground/40" />
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium line-clamp-2">{research.originalItem.title}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    在庫 ID {research.inventoryProduct.id} / 売価参照 ${Number(research.inventoryProduct.ebay_price_usd).toFixed(2)}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>自分の出品価格（USD）</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={myPriceInput}
                    onChange={(e) => setMyPriceInput(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>自分のコンディション（競合と比較する軸）</Label>
                  <Select value={myCondition} onValueChange={setMyCondition}>
                    <SelectTrigger>
                      <SelectValue placeholder="選ぶ" />
                    </SelectTrigger>
                    <SelectContent>
                      {conditionOptions.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label>監視の起点 URL（候補から選択）</Label>
                <RadioGroup value={seedUrl} onValueChange={setSeedUrl} className="gap-2">
                  {candidateEntries.map((row, i) => (
                    <div
                      key={`${row.url}-${i}`}
                      className="flex items-start gap-3 rounded-md border p-3 has-[:checked]:border-primary/60 has-[:checked]:bg-primary/5"
                    >
                      <RadioGroupItem value={row.url} id={`seed-${i}`} className="mt-1" />
                      <label htmlFor={`seed-${i}`} className="flex-1 cursor-pointer space-y-1">
                        <div className="text-sm font-medium flex items-center gap-2">
                          {row.isOwn && <Badge variant="secondary">在庫と同じ出品</Badge>}
                          <span className="text-muted-foreground font-normal">${row.total.toFixed(2)} / {row.condition}</span>
                        </div>
                        <p className="text-xs text-muted-foreground line-clamp-2">{row.label}</p>
                        <a
                          href={row.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-primary inline-flex items-center gap-1"
                          onClick={(e) => e.stopPropagation()}
                        >
                          開く <ExternalLink className="h-3 w-3" />
                        </a>
                      </label>
                    </div>
                  ))}
                </RadioGroup>
              </div>
            </div>
          ) : (
            <p className="text-sm text-destructive py-6">リサーチ結果がありません。</p>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              キャンセル
            </Button>
            <Button
              onClick={handleStartMonitor}
              disabled={!research || createMut.isPending || !seedUrl}
            >
              {createMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              この内容で監視を開始（または更新）
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
