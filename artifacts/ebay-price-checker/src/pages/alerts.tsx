import { format } from "date-fns";
import { ja } from "date-fns/locale";
import { useQueryClient } from "@tanstack/react-query";
import { 
  useListAlerts, 
  useResolveAlert, 
  useSyncToSpreadsheet,
  getListAlertsQueryKey
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle2, AlertTriangle, ArrowDown, Database, Loader2, Info } from "lucide-react";
import { cn } from "@/lib/utils";

export function Alerts() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const { data: alerts, isLoading, isError, error } = useListAlerts({
    query: {
      queryKey: getListAlertsQueryKey(),
      refetchInterval: 30000,
    }
  });

  const resolveAlert = useResolveAlert();
  const syncData = useSyncToSpreadsheet();

  const handleResolve = (id: number) => {
    resolveAlert.mutate({ id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListAlertsQueryKey() });
        toast({ title: "Marked as resolved" });
      },
      onError: (err) => toast({ variant: "destructive", title: "Error", description: err.message })
    });
  };

  const handleSync = () => {
    syncData.mutate(undefined, {
      onSuccess: (result) => {
        queryClient.invalidateQueries({ queryKey: getListAlertsQueryKey() });
        toast({ 
          title: "Sync Complete", 
          description: `${result.synced} successful, ${result.failed} failed` 
        });
      },
      onError: (err) => toast({ variant: "destructive", title: "Sync Failed", description: err.message })
    });
  };

  if (isLoading) {
    return (
      <div className="p-8 max-w-5xl mx-auto space-y-6">
        <Skeleton className="h-10 w-48 mb-8" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-[400px] w-full mt-8" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-8 max-w-5xl mx-auto">
        <div className="bg-destructive/10 text-destructive border border-destructive/20 p-4 rounded-md font-medium flex items-center">
          <div className="w-2 h-2 rounded-full bg-destructive mr-3"></div>
          {(error as any)?.message || "Failed to load alerts"}
        </div>
      </div>
    );
  }

  const unresolvedAlerts = alerts?.filter(a => !a.isResolved) || [];
  const unsyncedAlerts = alerts?.filter(a => !a.spreadsheetSynced) || [];

  return (
    <div className="p-8 max-w-[1200px] mx-auto space-y-8">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-foreground">Action Required</h1>
          <p className="text-muted-foreground mt-2">Competitors pricing below your listings.</p>
        </div>
        <Button 
          variant="secondary" 
          onClick={handleSync} 
          disabled={syncData.isPending || unsyncedAlerts.length === 0}
          className="font-bold shadow-sm"
        >
          {syncData.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Database className="mr-2 h-4 w-4" />}
          Sync to Sheets {unsyncedAlerts.length > 0 && `(${unsyncedAlerts.length})`}
        </Button>
      </div>

      {unresolvedAlerts.length > 0 && (
        <div className="bg-destructive text-destructive-foreground px-6 py-4 rounded-lg shadow-lg shadow-destructive/20 flex items-center gap-4 animate-in slide-in-from-top-4">
          <AlertTriangle className="h-8 w-8 opacity-80" />
          <div>
            <h3 className="font-bold text-lg leading-tight">{unresolvedAlerts.length} Urgent Alerts</h3>
            <p className="text-destructive-foreground/80 font-medium text-sm">Review your pricing to stay competitive.</p>
          </div>
        </div>
      )}

      <Card className="border-0 shadow-sm ring-1 ring-border/50 overflow-hidden">
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-muted/40">
              <TableRow className="hover:bg-muted/40 border-b border-border">
                <TableHead className="w-12"></TableHead>
                <TableHead className="py-4 font-semibold text-xs uppercase tracking-wider">Item Label</TableHead>
                <TableHead className="py-4 font-semibold text-xs uppercase tracking-wider">Price Drop</TableHead>
                <TableHead className="py-4 font-semibold text-xs uppercase tracking-wider">Detected At</TableHead>
                <TableHead className="py-4 font-semibold text-xs uppercase tracking-wider">Sync</TableHead>
                <TableHead className="text-right py-4 font-semibold text-xs uppercase tracking-wider">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!alerts || alerts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-48 text-center">
                    <div className="flex flex-col items-center justify-center text-muted-foreground">
                      <CheckCircle2 className="h-12 w-12 text-success/30 mb-3" />
                      <p className="font-bold">All clear!</p>
                      <p className="text-sm">No price drops detected.</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                alerts.map((alert) => (
                  <TableRow 
                    key={alert.id} 
                    className={cn(
                      "transition-colors group",
                      !alert.isResolved ? "bg-destructive/[0.03] hover:bg-destructive/[0.05] relative" : "opacity-60 hover:opacity-100 bg-muted/10 hover:bg-muted/30"
                    )}
                  >
                    <TableCell className="p-4 align-top relative">
                      {!alert.isResolved && (
                        <div className="absolute left-0 top-0 bottom-0 w-1 bg-destructive"></div>
                      )}
                      <div className="mt-1">
                        {alert.isResolved ? (
                          <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center">
                            <CheckCircle2 className="h-4 w-4 text-muted-foreground"/>
                          </div>
                        ) : (
                          <div className="w-6 h-6 rounded-full bg-destructive/10 flex items-center justify-center animate-pulse">
                            <AlertTriangle className="h-3 w-3 text-destructive"/>
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="p-4 align-top">
                      <div className={cn("font-bold text-sm mb-1", alert.isResolved ? "line-through text-muted-foreground" : "text-foreground")}>
                        {alert.monitorLabel || `Monitor #${alert.monitorId}`}
                      </div>
                    </TableCell>
                    <TableCell className="p-4 align-top">
                      <div className="flex items-center gap-3 bg-background border rounded-md px-3 py-2 w-fit shadow-sm">
                        <div className="text-right">
                          <span className="text-[10px] uppercase font-bold text-muted-foreground block leading-none mb-1">My Price</span>
                          <span className="font-mono text-sm font-bold text-muted-foreground line-through">${alert.myPrice.toFixed(2)}</span>
                        </div>
                        <div className="flex flex-col items-center justify-center px-1">
                          <ArrowDown className={cn("h-4 w-4", !alert.isResolved ? "text-destructive" : "text-muted-foreground")} />
                        </div>
                        <div>
                          <span className="text-[10px] uppercase font-bold text-muted-foreground block leading-none mb-1">Competitor</span>
                          <span className={cn("font-mono text-lg font-extrabold tabular-nums leading-none", !alert.isResolved ? "text-destructive" : "text-foreground")}>
                            ${alert.competitorPrice.toFixed(2)}
                          </span>
                        </div>
                      </div>
                      <div className="text-xs font-bold mt-2 ml-1 text-muted-foreground">
                        Difference: <span className={cn(!alert.isResolved && "text-destructive")}>-${Math.abs(alert.priceDiff).toFixed(2)}</span>
                      </div>
                    </TableCell>
                    <TableCell className="p-4 align-top">
                      <div className="text-sm font-medium">
                        {format(new Date(alert.createdAt), "yyyy/MM/dd HH:mm", { locale: ja })}
                      </div>
                    </TableCell>
                    <TableCell className="p-4 align-top">
                      {alert.spreadsheetSynced ? (
                        <Badge variant="outline" className="text-blue-600 border-blue-200 bg-blue-50/50 font-medium">Synced</Badge>
                      ) : (
                        <Badge variant="secondary" className="font-medium bg-muted">Pending</Badge>
                      )}
                    </TableCell>
                    <TableCell className="p-4 align-top text-right">
                      {!alert.isResolved && (
                        <Button 
                          size="sm" 
                          onClick={() => handleResolve(alert.id)}
                          disabled={resolveAlert.isPending}
                          className="font-bold shadow-sm"
                        >
                          <CheckCircle2 className="mr-2 h-4 w-4" /> Resolve
                        </Button>
                      )}
                      {alert.isResolved && alert.resolvedAt && (
                        <div className="text-xs text-muted-foreground font-medium flex items-center justify-end">
                          <CheckCircle2 className="h-3 w-3 mr-1" />
                          Resolved {format(new Date(alert.resolvedAt), "MM/dd", { locale: ja })}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
