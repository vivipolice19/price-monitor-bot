import { useState, useRef, useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useCreateMonitor, getListMonitorsQueryKey, useGetSpreadsheetRow, getGetSpreadsheetRowQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, DownloadCloud, CheckCircle2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

const formSchema = z.object({
  ebayUrl: z.string().url("有効なURLを入力してください"),
  myPrice: z.coerce.number().min(0, "0以上の数値を入力してください"),
  myCondition: z.string().min(1, "コンディションを入力してください"),
  label: z.string().optional(),
  spreadsheetRow: z.coerce.number().optional(),
  checkIntervalMinutes: z.coerce.number().min(5, "最短5分です").default(60),
});

type FormValues = z.infer<typeof formSchema>;

interface CreateMonitorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultValues?: Partial<FormValues>;
}

export function CreateMonitorDialog({ open, onOpenChange, defaultValues }: CreateMonitorDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createMonitor = useCreateMonitor();
  
  const [fetchStatus, setFetchStatus] = useState<{ status: 'idle' | 'loading' | 'success' | 'error', message?: string }>({ status: 'idle' });
  const [rowToFetch, setRowToFetch] = useState<number | null>(defaultValues?.spreadsheetRow || null);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      ebayUrl: defaultValues?.ebayUrl || "",
      myPrice: defaultValues?.myPrice || 0,
      myCondition: defaultValues?.myCondition || "New",
      label: defaultValues?.label || "",
      spreadsheetRow: defaultValues?.spreadsheetRow,
      checkIntervalMinutes: 60,
    },
  });

  const rowValue = form.watch("spreadsheetRow");
  
  const { refetch: fetchRow, isFetching: isFetchingRow } = useGetSpreadsheetRow(rowValue || 0, {
    query: { 
      enabled: false,
      queryKey: getGetSpreadsheetRowQueryKey(rowValue || 0)
    }
  });

  const handleFetchPrice = async () => {
    if (!rowValue) {
      setFetchStatus({ status: 'error', message: "行番号を入力してください" });
      return;
    }
    
    setFetchStatus({ status: 'loading' });
    try {
      const result = await fetchRow();
      if (result.data && result.data.found && result.data.myPrice !== undefined) {
        form.setValue("myPrice", result.data.myPrice);
        setFetchStatus({ status: 'success', message: `✓ $${result.data.myPrice} 取得済み` });
      } else {
        setFetchStatus({ status: 'error', message: "価格が見つかりません" });
      }
    } catch (error) {
      setFetchStatus({ status: 'error', message: "取得失敗" });
    }
  };

  function onSubmit(data: FormValues) {
    createMonitor.mutate(
      { data },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListMonitorsQueryKey() });
          toast({
            title: "監視リストに追加しました",
            description: "設定した間隔で自動的に価格チェックを行います。",
          });
          onOpenChange(false);
          form.reset();
          setFetchStatus({ status: 'idle' });
        },
        onError: (error) => {
          toast({
            variant: "destructive",
            title: "エラーが発生しました",
            description: error.message || "監視リストの追加に失敗しました。",
          });
        },
      }
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px] p-0 overflow-hidden border-0 shadow-2xl">
        <div className="bg-sidebar p-6 text-sidebar-foreground">
          <DialogTitle className="text-xl font-bold">監視リストに追加</DialogTitle>
          <DialogDescription className="text-sidebar-foreground/70 mt-1">
            この商品の価格変動を自動的に監視します。
          </DialogDescription>
        </div>
        
        <div className="p-6">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
              <FormField
                control={form.control}
                name="label"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="font-semibold text-xs uppercase tracking-wider text-muted-foreground">管理ラベル</FormLabel>
                    <FormControl>
                      <Input placeholder="商品名などわかりやすい名前" className="focus-visible:ring-primary/20" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <FormField
                control={form.control}
                name="ebayUrl"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="font-semibold text-xs uppercase tracking-wider text-muted-foreground">eBay URL</FormLabel>
                    <FormControl>
                      <Input placeholder="https://..." className="focus-visible:ring-primary/20" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <div className="grid grid-cols-2 gap-5">
                <FormField
                  control={form.control}
                  name="spreadsheetRow"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="font-semibold text-xs uppercase tracking-wider text-muted-foreground">スプレッドシート行</FormLabel>
                      <div className="flex items-center gap-2">
                        <FormControl>
                          <Input type="number" placeholder="2" className="tabular-nums focus-visible:ring-primary/20" {...field} value={field.value || ""} />
                        </FormControl>
                        <Button 
                          type="button" 
                          variant="secondary" 
                          size="sm" 
                          className="px-3"
                          onClick={handleFetchPrice}
                          disabled={!field.value || isFetchingRow}
                        >
                          {isFetchingRow ? <Loader2 className="h-4 w-4 animate-spin" /> : "取得"}
                        </Button>
                      </div>
                      {fetchStatus.status !== 'idle' && (
                        <div className={cn(
                          "text-xs mt-1 font-medium flex items-center",
                          fetchStatus.status === 'success' ? "text-success" : "text-destructive"
                        )}>
                          {fetchStatus.message}
                        </div>
                      )}
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="myPrice"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="font-semibold text-xs uppercase tracking-wider text-muted-foreground">自社価格 (USD)</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-medium">$</span>
                          <Input type="number" step="0.01" className="pl-7 font-mono font-bold tabular-nums text-lg focus-visible:ring-primary/20" {...field} />
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-2 gap-5">
                <FormField
                  control={form.control}
                  name="myCondition"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="font-semibold text-xs uppercase tracking-wider text-muted-foreground">コンディション</FormLabel>
                      <FormControl>
                        <Input className="focus-visible:ring-primary/20" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={form.control}
                  name="checkIntervalMinutes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="font-semibold text-xs uppercase tracking-wider text-muted-foreground">チェック間隔 (分)</FormLabel>
                      <FormControl>
                        <Input type="number" className="tabular-nums focus-visible:ring-primary/20" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              
              <div className="flex justify-end pt-4 gap-3">
                <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>キャンセル</Button>
                <Button type="submit" className="font-bold px-6 shadow-sm" disabled={createMonitor.isPending}>
                  {createMonitor.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  監視を開始する
                </Button>
              </div>
            </form>
          </Form>
        </div>
      </DialogContent>
    </Dialog>
  );
}
