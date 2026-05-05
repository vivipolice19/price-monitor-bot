import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetSpreadsheetConfig,
  useSaveSpreadsheetConfig,
  useTestSpreadsheetConnection,
  useSyncMonitorsFromSources,
  useTriggerRemoteInventorySync,
  getGetSpreadsheetConfigQueryKey,
  getEbayOAuthAuthorizeUrl,
} from "@workspace/api-client-react";
import type { SpreadsheetConfigRequest } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Loader2, CheckCircle2, XCircle, TableProperties, RefreshCw, ExternalLink } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useEffect } from "react";
import { Info, BookOpen } from "lucide-react";

const sheetSchema = z.object({
  spreadsheetId: z.string().min(1, "Spreadsheet IDは必須です"),
  sheetName: z.string().min(1, "シート名は必須です"),
  alertColumnIndex: z.coerce.number().min(0, "0以上の数値を入力してください"),
  priceColumnIndex: z.coerce.number().min(0, "0以上の数値を入力してください"),
  myPriceColumnIndex: z.coerce.number().min(0, "0以上の数値を入力してください"),
  sourceUrlColumnIndex: z.coerce.number().min(0).default(0),
  ebayUrlColumnIndex: z.coerce.number().min(0).default(1),
  inventoryStatusColumnIndex: z.coerce.number().min(0).default(5),
  ebayListingConditionColumnIndex: z.string().optional(),
  inventoryCheckerBaseUrl: z.string().optional(),
  inventoryCheckerApiKey: z.string().optional(),
  ebayOAuthRedirectUri: z.string().optional(),
  ebayOAuthClientSecret: z.string().optional(),
  autoRepriceEnabled: z.boolean().default(false),
  undercutAmount: z.coerce.number().min(0, "0以上を入力してください"),
  minAllowedPrice: z.coerce.number().min(0, "0以上を入力してください").optional(),
  ebayAppId: z.string().optional(),
  ebayDevId: z.string().optional(),
  ebayCertId: z.string().optional(),
  ebayUserToken: z.string().optional(),
  serviceAccountJson: z.string().optional(),
});

type SheetValues = z.infer<typeof sheetSchema>;

export function Settings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const { data: config, isLoading, isError, error } = useGetSpreadsheetConfig({
    query: { queryKey: getGetSpreadsheetConfigQueryKey() },
  });
  
  const saveConfig = useSaveSpreadsheetConfig();
  const testConnection = useTestSpreadsheetConnection();
  const syncPipeline = useSyncMonitorsFromSources();
  const remoteInventorySync = useTriggerRemoteInventorySync();

  const sheetForm = useForm<SheetValues>({
    resolver: zodResolver(sheetSchema),
    defaultValues: {
      spreadsheetId: "",
      sheetName: "",
      alertColumnIndex: 5,
      priceColumnIndex: 6,
      myPriceColumnIndex: 3,
      sourceUrlColumnIndex: 0,
      ebayUrlColumnIndex: 1,
      inventoryStatusColumnIndex: 5,
      ebayListingConditionColumnIndex: "",
      inventoryCheckerBaseUrl: "https://ebay-lowest-checker-1.onrender.com",
      inventoryCheckerApiKey: "",
      ebayOAuthRedirectUri: "",
      ebayOAuthClientSecret: "",
      autoRepriceEnabled: false,
      undercutAmount: 0.01,
      minAllowedPrice: undefined,
      ebayAppId: "",
      ebayDevId: "",
      ebayCertId: "",
      ebayUserToken: "",
      serviceAccountJson: "",
    }
  });

  useEffect(() => {
    if (config) {
      sheetForm.reset({
        spreadsheetId: config.spreadsheetId || "",
        sheetName: config.sheetName || "",
        alertColumnIndex: config.alertColumnIndex ?? 5,
        priceColumnIndex: config.priceColumnIndex ?? 6,
        myPriceColumnIndex: config.myPriceColumnIndex ?? 3,
        sourceUrlColumnIndex: config.sourceUrlColumnIndex ?? 0,
        ebayUrlColumnIndex: config.ebayUrlColumnIndex ?? 1,
        inventoryStatusColumnIndex: config.inventoryStatusColumnIndex ?? 5,
        ebayListingConditionColumnIndex:
          config.ebayListingConditionColumnIndex != null
            ? String(config.ebayListingConditionColumnIndex)
            : "",
        inventoryCheckerBaseUrl: config.inventoryCheckerBaseUrl || "https://ebay-lowest-checker-1.onrender.com",
        inventoryCheckerApiKey: "",
        ebayOAuthRedirectUri: config.ebayOAuthRedirectUri || "",
        ebayOAuthClientSecret: "",
        autoRepriceEnabled: config.autoRepriceEnabled ?? false,
        undercutAmount: config.undercutAmount ?? 0.01,
        minAllowedPrice: config.minAllowedPrice ?? undefined,
        ebayAppId: "",
        ebayDevId: "",
        ebayCertId: "",
        ebayUserToken: "",
        serviceAccountJson: "",
      });
    }
  }, [config, sheetForm]);

  const onSheetSubmit = (data: SheetValues) => {
    const { ebayListingConditionColumnIndex: condStr, ...rest } = data;
    const trimmed = condStr?.trim();
    const body: SpreadsheetConfigRequest = {
      ...rest,
      ebayListingConditionColumnIndex:
        !trimmed || Number.isNaN(Number(trimmed)) ? null : Number(trimmed),
    };

    saveConfig.mutate({ data: body }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetSpreadsheetConfigQueryKey() });
        toast({ title: "設定を保存しました", description: "スプレッドシート連携が更新されました。" });
        sheetForm.setValue("serviceAccountJson", "");
      },
      onError: (err) => toast({ variant: "destructive", title: "保存失敗", description: err.message })
    });
  };

  const handleFullSync = () => {
    syncPipeline.mutate(undefined, {
      onSuccess: (r) => {
        queryClient.invalidateQueries({ queryKey: getGetSpreadsheetConfigQueryKey() });
        toast({
          title: "監視同期完了",
          description: `シート ${r.sheet.created}件新規 / 在庫API ${r.inventory.updated}件更新 / 行紐付け ${r.linkedRows} / コンディション補完 ${r.hydratedConditions}`,
        });
      },
      onError: (err) =>
        toast({ variant: "destructive", title: "同期失敗", description: err.message }),
    });
  };

  const handleRemoteInventorySync = () => {
    remoteInventorySync.mutate(undefined, {
      onSuccess: (r) => {
        toast({
          title: "リモート同期を要求しました",
          description: JSON.stringify(r),
        });
      },
      onError: (err) =>
        toast({ variant: "destructive", title: "リモート同期失敗", description: err.message }),
    });
  };

  const handleEbayOAuth = async () => {
    try {
      const { authorizeUrl } = await getEbayOAuthAuthorizeUrl();
      window.open(authorizeUrl, "_blank", "noopener,noreferrer");
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: "OAuth URL取得失敗",
        description: err?.message ?? String(err),
      });
    }
  };

  const handleTestConnection = () => {
    testConnection.mutate(undefined, {
      onSuccess: (result) => {
        if (result.success) {
          toast({ 
            title: "接続テスト成功", 
            description: `シート "${result.sheetTitle}" へのアクセスを確認しました。` 
          });
        } else {
          toast({ variant: "destructive", title: "接続テスト失敗", description: result.message });
        }
      },
      onError: (err) => toast({ variant: "destructive", title: "接続エラー", description: err.message })
    });
  };

  if (isLoading) {
    return (
      <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-[300px] w-full" />
        <Skeleton className="h-[500px] w-full" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-4 md:p-8 max-w-5xl mx-auto">
        <Alert variant="destructive">
          <AlertTitle>設定を読み込めません</AlertTitle>
          <AlertDescription className="mt-2">
            {(error as Error)?.message ||
              "サーバーに接続できないか、エラーが返りました。しばらく待って再読み込みしてください。"}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-6 md:space-y-8">
      <div>
        <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-foreground">設定</h1>
        <p className="text-muted-foreground mt-2 text-sm md:text-base leading-relaxed">
          下の項目は「シート連携・在庫同期・自動改定」を使うときに必要です。まずは<strong>左の「価格リサーチ」だけ使う</strong>場合、eBay の App ID を環境変数
          <code className="mx-1 rounded bg-muted px-1">EBAY_APP_ID</code>
          で渡すか、下のフォームに保存してください。
        </p>
      </div>

      {config?.databaseNeedsMigration ? (
        <Alert variant="destructive">
          <AlertTitle>データベースの初期化が必要です</AlertTitle>
          <AlertDescription className="mt-2 whitespace-pre-wrap">
            {config.setupMessageJa ??
              "PostgreSQL にテーブルがありません。リポジトリのルートで DATABASE_URL を設定し、pnpm exec drizzle-kit push を実行してください。"}
          </AlertDescription>
        </Alert>
      ) : null}

      <Accordion type="single" collapsible className="max-w-4xl rounded-lg border bg-card px-2">
        <AccordionItem value="guide" className="border-0">
          <AccordionTrigger className="px-3 py-3 text-left hover:no-underline">
            <span className="flex items-center gap-2 font-semibold text-foreground">
              <BookOpen className="h-4 w-4 shrink-0 text-primary" />
              使い方（開いて確認）
            </span>
          </AccordionTrigger>
          <AccordionContent className="px-3 pb-4 text-sm text-muted-foreground leading-relaxed space-y-3">
            <p>
              <strong className="text-foreground">1. 価格リサーチ</strong>
              ：トップで eBay URL を入れて「分析する」。シートは不要です。
            </p>
            <p>
              <strong className="text-foreground">2. 監視・シート書き込み</strong>
              ：Google のサービスアカウント JSON とスプレッドシート ID をここで保存し、「接続テスト」で確認します。
            </p>
            <p>
              <strong className="text-foreground">3. 在庫サービス</strong>
              ：Mercari→eBay 同期ツールの URL を「在庫チェック基準 URL」に入れ、必要なら API キーも設定します。
            </p>
            <p className="flex items-start gap-2 rounded-md bg-muted/50 p-3 text-xs">
              <Info className="h-4 w-4 shrink-0 mt-0.5" />
              Render の無料プランはしばらく使わないとスリープし、初回アクセスが遅くなります。定期監視には有料プランや Cron の検討が必要です。
            </p>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      <div className="max-w-4xl">
        <Card className="border-0 shadow-sm ring-1 ring-border/50">
          <CardHeader className="bg-muted/30 border-b">
            <div className="flex justify-between items-start">
              <div>
                <CardTitle className="flex items-center text-lg"><TableProperties className="mr-2 h-5 w-5 text-primary" /> Google Sheets Sync</CardTitle>
                <CardDescription>Map columns for automatic price sync.</CardDescription>
              </div>
              <div className="flex flex-wrap gap-2 justify-end">
                {config?.hasServiceAccount ? (
                  <Badge variant="outline" className="text-success bg-success/10 border-success/20 font-medium">
                    <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" /> Sheets
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-destructive bg-destructive/10 border-destructive/20 font-medium">
                    <XCircle className="mr-1.5 h-3.5 w-3.5" /> Sheets
                  </Badge>
                )}
                {config?.hasEbayCredentials ? (
                  <Badge variant="outline" className="text-success bg-success/10 border-success/20 font-medium">
                    Trading API
                  </Badge>
                ) : null}
                {config?.hasEbayOAuth ? (
                  <Badge variant="outline" className="text-success bg-success/10 border-success/20 font-medium">
                    OAuth
                  </Badge>
                ) : null}
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-6">
            <Form {...sheetForm}>
              <form onSubmit={sheetForm.handleSubmit(onSheetSubmit)} className="space-y-6">
                <div className="space-y-5">
                  <FormField
                    control={sheetForm.control}
                    name="spreadsheetId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="font-semibold text-xs uppercase tracking-wider text-muted-foreground">Spreadsheet ID</FormLabel>
                        <FormControl>
                          <Input placeholder="1BxiMVs0XRYFgwn..." className="font-mono text-sm" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <FormField
                    control={sheetForm.control}
                    name="sheetName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="font-semibold text-xs uppercase tracking-wider text-muted-foreground">Sheet Name</FormLabel>
                        <FormControl>
                          <Input placeholder="Sheet1" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-2">
                    <FormField
                      control={sheetForm.control}
                      name="sourceUrlColumnIndex"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="font-semibold text-[10px] uppercase tracking-wider text-muted-foreground leading-tight">仕入先URL列(0始まり)</FormLabel>
                          <FormControl>
                            <Input type="number" className="tabular-nums" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={sheetForm.control}
                      name="ebayUrlColumnIndex"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="font-semibold text-[10px] uppercase tracking-wider text-muted-foreground leading-tight">eBay URL列(0始まり)</FormLabel>
                          <FormControl>
                            <Input type="number" className="tabular-nums" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={sheetForm.control}
                      name="inventoryStatusColumnIndex"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="font-semibold text-[10px] uppercase tracking-wider text-muted-foreground leading-tight">在庫状態列(0始まり)</FormLabel>
                          <FormControl>
                            <Input type="number" className="tabular-nums" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={sheetForm.control}
                      name="ebayListingConditionColumnIndex"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="font-semibold text-[10px] uppercase tracking-wider text-muted-foreground leading-tight">出品コンディション列(任意)</FormLabel>
                          <FormControl>
                            <Input placeholder="空欄でAPI取得" className="tabular-nums" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <div className="rounded-lg border p-4 space-y-4 bg-muted/10">
                    <p className="font-semibold text-sm">在庫管理アプリ (Mercari→eBay)</p>
                    <FormField
                      control={sheetForm.control}
                      name="inventoryCheckerBaseUrl"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="font-semibold text-xs uppercase tracking-wider text-muted-foreground">ベースURL</FormLabel>
                          <FormControl>
                            <Input className="font-mono text-sm" placeholder="https://...onrender.com" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={sheetForm.control}
                      name="inventoryCheckerApiKey"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="font-semibold text-xs uppercase tracking-wider text-muted-foreground">APIキー (任意)</FormLabel>
                          <FormControl>
                            <Input type="password" className="font-mono text-xs" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <div className="rounded-lg border p-4 space-y-4 bg-muted/10">
                    <p className="font-semibold text-sm">eBay OAuth (自動改定推奨)</p>
                    <FormField
                      control={sheetForm.control}
                      name="ebayOAuthRedirectUri"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="font-semibold text-xs uppercase tracking-wider text-muted-foreground">リダイレクトURI</FormLabel>
                          <FormControl>
                            <Input className="font-mono text-xs" placeholder="https://あなたのAPI/api/ebay/oauth/callback" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={sheetForm.control}
                      name="ebayOAuthClientSecret"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="font-semibold text-xs uppercase tracking-wider text-muted-foreground">OAuth Client Secret</FormLabel>
                          <FormControl>
                            <Input type="password" className="font-mono text-xs" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <div className="grid grid-cols-3 gap-4 pt-2">
                    <FormField
                      control={sheetForm.control}
                      name="myPriceColumnIndex"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="font-semibold text-[10px] uppercase tracking-wider text-muted-foreground leading-tight">My Price Col (0-based)</FormLabel>
                          <FormControl>
                            <Input type="number" className="tabular-nums" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={sheetForm.control}
                      name="priceColumnIndex"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="font-semibold text-[10px] uppercase tracking-wider text-muted-foreground leading-tight">Comp. Price Col (0-based)</FormLabel>
                          <FormControl>
                            <Input type="number" className="tabular-nums" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={sheetForm.control}
                      name="alertColumnIndex"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="font-semibold text-[10px] uppercase tracking-wider text-muted-foreground leading-tight">Alert Flag Col (0-based)</FormLabel>
                          <FormControl>
                            <Input type="number" className="tabular-nums" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <div className="rounded-lg border p-4 space-y-4 bg-muted/20">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-semibold text-sm">自動価格改定</p>
                        <p className="text-xs text-muted-foreground">競合最安値を検知した際にeBay価格を自動改定します。</p>
                      </div>
                      <FormField
                        control={sheetForm.control}
                        name="autoRepriceEnabled"
                        render={({ field }) => (
                          <Switch checked={field.value} onCheckedChange={field.onChange} />
                        )}
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <FormField
                        control={sheetForm.control}
                        name="undercutAmount"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="font-semibold text-[10px] uppercase tracking-wider text-muted-foreground leading-tight">アンダーカット幅(USD)</FormLabel>
                            <FormControl>
                              <Input type="number" step="0.01" className="tabular-nums" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={sheetForm.control}
                        name="minAllowedPrice"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="font-semibold text-[10px] uppercase tracking-wider text-muted-foreground leading-tight">最低改定価格(USD)</FormLabel>
                            <FormControl>
                              <Input type="number" step="0.01" className="tabular-nums" value={field.value ?? ""} onChange={(e) => field.onChange(e.target.value)} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 pt-2">
                    <FormField
                      control={sheetForm.control}
                      name="ebayAppId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="font-semibold text-[10px] uppercase tracking-wider text-muted-foreground leading-tight">eBay App ID</FormLabel>
                          <FormControl>
                            <Input type="password" className="font-mono text-xs" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={sheetForm.control}
                      name="ebayDevId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="font-semibold text-[10px] uppercase tracking-wider text-muted-foreground leading-tight">eBay Dev ID</FormLabel>
                          <FormControl>
                            <Input type="password" className="font-mono text-xs" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={sheetForm.control}
                      name="ebayCertId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="font-semibold text-[10px] uppercase tracking-wider text-muted-foreground leading-tight">eBay Cert ID</FormLabel>
                          <FormControl>
                            <Input type="password" className="font-mono text-xs" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={sheetForm.control}
                      name="ebayUserToken"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="font-semibold text-[10px] uppercase tracking-wider text-muted-foreground leading-tight">eBay User Token</FormLabel>
                          <FormControl>
                            <Input type="password" className="font-mono text-xs" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  
                  <FormField
                    control={sheetForm.control}
                    name="serviceAccountJson"
                    render={({ field }) => (
                      <FormItem className="pt-2">
                        <FormLabel className="font-semibold text-xs uppercase tracking-wider text-muted-foreground">Service Account JSON</FormLabel>
                        <FormControl>
                          <Textarea 
                            placeholder='{"type": "service_account", "project_id": ...}' 
                            className="font-mono text-xs h-24 bg-muted/50 resize-none focus:bg-background transition-colors"
                            {...field} 
                          />
                        </FormControl>
                        <FormDescription className="text-[11px]">Only needed to update credentials.</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                
                <div className="flex flex-col gap-3 pt-4 border-t border-border/50">
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="secondary" onClick={handleFullSync} disabled={syncPipeline.isPending}>
                      {syncPipeline.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                      監視フル同期
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleRemoteInventorySync}
                      disabled={remoteInventorySync.isPending}
                    >
                      {remoteInventorySync.isPending ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <ExternalLink className="mr-2 h-4 w-4" />
                      )}
                      在庫アプリに同期依頼
                    </Button>
                    <Button type="button" variant="outline" onClick={handleEbayOAuth}>
                      eBayで認証
                    </Button>
                  </div>
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleTestConnection}
                      disabled={testConnection.isPending || !config?.isConfigured}
                      className="font-medium"
                    >
                      {testConnection.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                      Test Connection
                    </Button>
                    <Button type="submit" disabled={saveConfig.isPending} className="font-bold px-6 shadow-sm">
                      {saveConfig.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Save Config
                    </Button>
                  </div>
                </div>
              </form>
            </Form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
