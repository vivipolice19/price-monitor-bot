import { useState } from "react";
import { format } from "date-fns";
import { ja } from "date-fns/locale";
import { useQueryClient } from "@tanstack/react-query";
import { 
  useListMonitors, 
  useDeleteMonitor, 
  useUpdateMonitor,
  useCheckMonitorNow,
  getListMonitorsQueryKey
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { 
  Loader2, 
  RefreshCw, 
  Trash2, 
  ExternalLink,
  AlertTriangle,
  Activity,
  Database,
  ShieldAlert
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function Monitors() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const { data: monitors, isLoading, isError, error } = useListMonitors({
    query: {
      queryKey: getListMonitorsQueryKey(),
      refetchInterval: 30000,
    }
  });
  
  const deleteMonitor = useDeleteMonitor();
  const updateMonitor = useUpdateMonitor();
  const checkNow = useCheckMonitorNow();

  const [checkingId, setCheckingId] = useState<number | null>(null);

  const handleDelete = (id: number) => {
    if (!confirm("この監視を削除してもよろしいですか？")) return;
    
    deleteMonitor.mutate({ id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListMonitorsQueryKey() });
        toast({ title: "削除しました" });
      },
      onError: (err) => toast({ variant: "destructive", title: "削除に失敗しました", description: err.message })
    });
  };

  const handleToggleActive = (id: number, currentStatus: boolean) => {
    updateMonitor.mutate({ id, data: { isActive: !currentStatus } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListMonitorsQueryKey() });
        toast({ title: !currentStatus ? "監視を再開しました" : "監視を一時停止しました" });
      }
    });
  };

  const handleCheckNow = (id: number) => {
    setCheckingId(id);
    checkNow.mutate({ id }, {
      onSuccess: (result) => {
        queryClient.invalidateQueries({ queryKey: getListMonitorsQueryKey() });
        if (result.alertTriggered) {
          toast({ 
            variant: "destructive",
            title: "プライスアラート発生！", 
            description: `競合があなたの価格を下回りました: $${result.lowestPrice.toFixed(2)}` 
          });
        } else {
          toast({ 
            title: "チェック完了", 
            description: `最安値: $${result.lowestPrice.toFixed(2)}` 
          });
        }
      },
      onError: (err) => toast({ variant: "destructive", title: "チェック失敗", description: err.message }),
      onSettled: () => setCheckingId(null)
    });
  };

  if (isLoading) {
    return (
      <div className="p-8 max-w-7xl mx-auto space-y-6">
        <Skeleton className="h-10 w-48 mb-8" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
        <Skeleton className="h-[400px] w-full mt-8" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-8 max-w-7xl mx-auto">
        <div className="bg-destructive/10 text-destructive border border-destructive/20 p-4 rounded-md font-medium flex items-center">
          <div className="w-2 h-2 rounded-full bg-destructive mr-3"></div>
          {(error as any)?.message || "データの取得に失敗しました"}
        </div>
      </div>
    );
  }

  const activeMonitors = monitors?.filter(m => m.isActive) || [];
  const alertCount = monitors?.filter(m => m.hasAlert).length || 0;

  return (
    <div className="p-8 max-w-[1400px] mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight text-foreground">Monitors</h1>
        <p className="text-muted-foreground mt-2">Active price tracking and competitor analysis.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="border-0 shadow-sm ring-1 ring-border/50 overflow-hidden relative group">
          <div className="absolute top-0 left-0 w-1 h-full bg-primary"></div>
          <CardContent className="p-6">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">Total Items</p>
                <div className="text-4xl font-extrabold tabular-nums tracking-tight">{monitors?.length || 0}</div>
                <div className="text-sm font-medium text-muted-foreground mt-2 flex items-center">
                  <div className="w-2 h-2 rounded-full bg-success mr-2"></div>
                  {activeMonitors.length} Active
                </div>
              </div>
              <div className="p-3 bg-primary/10 rounded-xl">
                <Activity className="h-6 w-6 text-primary" />
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card className={cn(
          "border-0 shadow-sm ring-1 ring-border/50 overflow-hidden relative group transition-colors",
          alertCount > 0 ? "bg-destructive/5" : ""
        )}>
          <div className={cn("absolute top-0 left-0 w-1 h-full", alertCount > 0 ? "bg-destructive" : "bg-muted")}></div>
          <CardContent className="p-6">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">Active Alerts</p>
                <div className={cn("text-4xl font-extrabold tabular-nums tracking-tight", alertCount > 0 ? "text-destructive" : "")}>
                  {alertCount}
                </div>
                <div className="text-sm font-medium text-muted-foreground mt-2">
                  Price drop detected
                </div>
              </div>
              <div className={cn("p-3 rounded-xl", alertCount > 0 ? "bg-destructive/20" : "bg-muted")}>
                <ShieldAlert className={cn("h-6 w-6", alertCount > 0 ? "text-destructive" : "text-muted-foreground")} />
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card className="border-0 shadow-sm ring-1 ring-border/50 overflow-hidden relative group">
          <div className="absolute top-0 left-0 w-1 h-full bg-blue-500"></div>
          <CardContent className="p-6">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">Sheet Sync</p>
                <div className="text-4xl font-extrabold tabular-nums tracking-tight text-blue-600">
                  {monitors?.filter(m => m.spreadsheetRow).length || 0}
                </div>
                <div className="text-sm font-medium text-muted-foreground mt-2">
                  Rows mapped
                </div>
              </div>
              <div className="p-3 bg-blue-500/10 rounded-xl">
                <Database className="h-6 w-6 text-blue-600" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-0 shadow-sm ring-1 ring-border/50">
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-muted/40">
              <TableRow className="hover:bg-muted/40 border-b border-border">
                <TableHead className="w-16 text-center py-4"></TableHead>
                <TableHead className="py-4 font-semibold text-xs uppercase tracking-wider">Item Label</TableHead>
                <TableHead className="py-4 font-semibold text-xs uppercase tracking-wider text-right">My Price</TableHead>
                <TableHead className="py-4 font-semibold text-xs uppercase tracking-wider text-right">Lowest Comp.</TableHead>
                <TableHead className="py-4 font-semibold text-xs uppercase tracking-wider text-right">Diff</TableHead>
                <TableHead className="py-4 font-semibold text-xs uppercase tracking-wider">Status</TableHead>
                <TableHead className="text-right py-4 font-semibold text-xs uppercase tracking-wider">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!monitors || monitors.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-32 text-center text-muted-foreground font-medium">
                    No monitors active. Add items from Research to start tracking.
                  </TableCell>
                </TableRow>
              ) : (
                monitors.map((monitor) => {
                  const diff = monitor.currentLowestPrice ? monitor.myPrice - monitor.currentLowestPrice : 0;
                  const isCheaper = monitor.currentLowestPrice ? monitor.currentLowestPrice < monitor.myPrice : false;
                  
                  return (
                    <TableRow 
                      key={monitor.id} 
                      className={cn(
                        "group transition-colors relative",
                        monitor.hasAlert ? "bg-destructive/[0.03] hover:bg-destructive/[0.05]" : "hover:bg-muted/20"
                      )}
                    >
                      <TableCell className="p-4 align-top relative">
                        {monitor.hasAlert && (
                          <div className="absolute left-0 top-0 bottom-0 w-1 bg-destructive"></div>
                        )}
                        <div className="flex flex-col items-center gap-3 mt-1">
                          <Switch 
                            checked={monitor.isActive} 
                            onCheckedChange={() => handleToggleActive(monitor.id, monitor.isActive)}
                            aria-label="Toggle active status"
                            className="scale-90"
                          />
                          <div className={cn(
                            "w-2.5 h-2.5 rounded-full shadow-sm",
                            monitor.hasAlert ? "bg-destructive shadow-destructive/50" : 
                            monitor.isActive ? "bg-success shadow-success/50" : "bg-muted-foreground/30"
                          )} />
                        </div>
                      </TableCell>
                      <TableCell className="p-4 align-top">
                        <div className="font-bold text-sm text-foreground/90 mb-1 flex items-start gap-2">
                          {monitor.label || "Untitled Item"}
                          {monitor.hasAlert && (
                            <Badge variant="destructive" className="h-5 px-1.5 font-bold shadow-sm py-0"><AlertTriangle className="h-3 w-3 mr-1"/> ALERT</Badge>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-2 mt-2">
                          <Badge variant="secondary" className="font-semibold text-[10px] uppercase bg-muted/60">{monitor.myCondition}</Badge>
                          {monitor.spreadsheetRow && (
                            <Badge variant="outline" className="font-mono text-[10px] text-blue-600 border-blue-200 bg-blue-50/50">Row {monitor.spreadsheetRow}</Badge>
                          )}
                          <a href={monitor.ebayUrl} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline font-medium inline-flex items-center ml-1">
                            eBay <ExternalLink className="h-3 w-3 ml-0.5" />
                          </a>
                        </div>
                      </TableCell>
                      <TableCell className="p-4 align-top text-right">
                        <div className="font-mono text-lg font-bold tabular-nums">${monitor.myPrice.toFixed(2)}</div>
                      </TableCell>
                      <TableCell className="p-4 align-top text-right">
                        {monitor.currentLowestPrice ? (
                          <>
                            <div className={cn(
                              "font-mono text-lg font-bold tabular-nums",
                              isCheaper ? "text-destructive" : "text-foreground"
                            )}>
                              ${monitor.currentLowestPrice.toFixed(2)}
                            </div>
                            {monitor.currentLowestCondition && (
                              <div className="text-[10px] font-bold uppercase text-muted-foreground tracking-wider mt-1">
                                {monitor.currentLowestCondition}
                              </div>
                            )}
                          </>
                        ) : (
                          <span className="text-muted-foreground text-sm font-medium italic">Pending</span>
                        )}
                      </TableCell>
                      <TableCell className="p-4 align-top text-right">
                        {monitor.currentLowestPrice ? (
                          <div className={cn(
                            "font-mono font-bold text-sm tabular-nums px-2 py-1 rounded inline-block",
                            isCheaper ? "bg-destructive/10 text-destructive" : "bg-success/10 text-success"
                          )}>
                            {isCheaper ? "-" : "+"}${Math.abs(diff).toFixed(2)}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell className="p-4 align-top">
                        <div className="text-sm font-medium">
                          {monitor.lastCheckedAt ? format(new Date(monitor.lastCheckedAt), "MM/dd HH:mm", { locale: ja }) : "Never"}
                        </div>
                        <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mt-1">
                          {monitor.checkIntervalMinutes}m interval
                        </div>
                      </TableCell>
                      <TableCell className="p-4 align-top text-right">
                        <div className="flex justify-end gap-2 opacity-80 group-hover:opacity-100 transition-opacity">
                          <Button 
                            variant="secondary" 
                            size="sm" 
                            onClick={() => handleCheckNow(monitor.id)}
                            disabled={checkingId === monitor.id}
                            className="font-bold shadow-sm"
                          >
                            {checkingId === monitor.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                            {checkingId === monitor.id ? "" : "Check"}
                          </Button>
                          <Button 
                            variant="outline" 
                            size="sm" 
                            onClick={() => handleDelete(monitor.id)}
                            className="text-destructive border-destructive/30 hover:bg-destructive hover:text-destructive-foreground transition-colors"
                            title="Delete"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
