import { Link, useLocation } from "wouter";
import { 
  BarChart3, 
  Settings, 
  Search,
  Bell,
  Activity
} from "lucide-react";
import { cn } from "@/lib/utils";

interface LayoutProps {
  children: React.ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const [location] = useLocation();

  const navigation = [
    { name: "リサーチ", href: "/", icon: Search },
    { name: "監視リスト", href: "/monitors", icon: Activity },
    { name: "アラート履歴", href: "/alerts", icon: Bell },
    { name: "設定", href: "/settings", icon: Settings },
  ];

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Sidebar */}
      <div className="w-56 bg-sidebar flex flex-col hidden md:flex border-r-0 shadow-[4px_0_24px_rgba(0,0,0,0.15)] z-10 relative">
        <div className="h-16 flex items-center px-5 mb-4">
          <div className="w-8 h-8 rounded bg-primary flex items-center justify-center mr-3 shadow-lg shadow-primary/20">
            <BarChart3 className="w-5 h-5 text-primary-foreground" />
          </div>
          <span className="font-bold text-sidebar-foreground tracking-tight">eBay Check</span>
        </div>
        
        <nav className="flex-1 px-3 space-y-1">
          {navigation.map((item) => {
            const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
            return (
              <Link 
                key={item.name} 
                href={item.href}
                className={cn(
                  "flex items-center px-3 py-2.5 text-sm font-medium rounded-md transition-all duration-200",
                  isActive 
                    ? "bg-primary text-primary-foreground shadow-md shadow-primary/10" 
                    : "text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                )}
              >
                <item.icon className={cn("mr-3 h-4 w-4 shrink-0", isActive ? "opacity-100" : "opacity-70")} />
                {item.name}
              </Link>
            );
          })}
        </nav>
        
        <div className="p-4">
          <div className="px-3 py-2 bg-sidebar-accent rounded-md border border-sidebar-border">
            <div className="text-[10px] font-bold text-sidebar-foreground/50 uppercase tracking-wider mb-1">Status</div>
            <div className="flex items-center text-xs text-sidebar-foreground">
              <div className="w-2 h-2 rounded-full bg-success mr-2 shadow-[0_0_8px_rgba(22,163,74,0.8)]"></div>
              System Online
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto bg-slate-50/50">
        <div className="h-full">
          {children}
        </div>
      </main>
    </div>
  );
}
