import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import {
  Activity,
  BookOpen,
  ChevronDown,
  ChevronRight,
  Crosshair,
  Cpu,
  Database,
  GitCompare,
  Bot,
  List,
  Menu,
  Network,
  Search,
  Settings2,
  Telescope,
  X,
} from "lucide-react";

const mainNav = [
  { name: "Overview", href: "/", icon: Crosshair },
  { name: "Entity ledger", href: "/profiles", icon: List },
  { name: "Discover", href: "/search", icon: Search },
  { name: "Connections", href: "/network", icon: Network },
  { name: "Intelligence Reactor", href: "/reactor", icon: Cpu },
];

const referenceNav = [
  { name: "Field manual", href: "/manual", icon: BookOpen },
];

const toolsNav = [
  { name: "System status", href: "/status", icon: Activity },
  { name: "Data sources", href: "/data-sources", icon: Database },
  { name: "Source directory", href: "/osint-tools", icon: Telescope },
  { name: "Persona review", href: "/improvements", icon: Bot },
  { name: "Duplicate review", href: "/duplicates", icon: GitCompare },
  { name: "Workspace activity", href: "/jobs", icon: Settings2 },
];

const allNav = [...mainNav, ...referenceNav, ...toolsNav];

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);

  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);

  useEffect(() => {
    setSidebarOpen(false);
    if (toolsNav.some((item) => location === item.href || location.startsWith(item.href))) {
      setToolsOpen(true);
    }
  }, [location]);

  const isActive = (href: string) =>
    location === href || (href !== "/" && location.startsWith(href));

  const NavLink = ({ item }: { item: typeof allNav[number] }) => {
    const active = isActive(item.href);
    return (
      <Link
        href={item.href}
        aria-current={active ? "page" : undefined}
        data-testid={`link-nav-${item.name.toLowerCase().replace(/\s+/g, "-")}`}
        className={cn(
          "group flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] transition-colors",
          active
            ? "bg-primary/10 text-primary"
            : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
        )}
      >
        <item.icon className={cn("h-[17px] w-[17px] shrink-0", active ? "text-primary" : "text-muted-foreground/80")} />
        <span className="truncate">{item.name}</span>
        {active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" />}
      </Link>
    );
  };

  const Sidebar = ({ mobile = false }: { mobile?: boolean }) => (
    <aside className={cn(
      "flex h-full flex-col border-r border-sidebar-border bg-sidebar",
      mobile ? "w-[min(300px,86vw)]" : "w-[250px] shrink-0",
    )}>
      <div className="flex h-[76px] shrink-0 items-center border-b border-sidebar-border px-5">
        <div className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground shadow-[0_0_15px_rgba(var(--primary),0.3)]">
          <Crosshair className="h-[18px] w-[18px]" />
        </div>
        <div className="ml-3 min-w-0">
          <div className="font-display text-[15px] font-bold tracking-[0.14em] text-foreground">APEX ATLAS</div>
          <div className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.2em] text-muted-foreground/70">Private workspace</div>
        </div>
        {mobile && (
          <button
            onClick={() => setSidebarOpen(false)}
            aria-label="Close menu"
            data-testid="button-close-menu"
            className="ml-auto rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-6">
        <div className="mb-2 px-3 font-mono text-[9px] uppercase tracking-[0.2em] text-muted-foreground/50">Research desk</div>
        <div className="space-y-1">
          {mainNav.map((item) => <NavLink key={item.href} item={item} />)}
        </div>
        <div className="mt-7 mb-2 px-3 font-mono text-[9px] uppercase tracking-[0.2em] text-muted-foreground/50">Reference</div>
        <div className="space-y-1">
          {referenceNav.map((item) => <NavLink key={item.href} item={item} />)}
        </div>
        <button
          onClick={() => setToolsOpen((open) => !open)}
          aria-expanded={toolsOpen}
          data-testid="button-toggle-tools"
          className="mt-7 flex w-full items-center justify-between rounded-lg px-3 py-2 text-left font-mono text-[9px] uppercase tracking-[0.2em] text-muted-foreground/50 transition-colors hover:bg-muted/50 hover:text-muted-foreground"
        >
          <span>Workspace settings</span>
          {toolsOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>
        {toolsOpen && (
          <div className="mt-1 space-y-1">
            {toolsNav.map((item) => <NavLink key={item.href} item={item} />)}
          </div>
        )}
      </nav>

      <div className="border-t border-sidebar-border px-5 py-4">
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground/60">
          <span className="h-1.5 w-1.5 rounded-full bg-primary" />
          Public records workspace
        </div>
      </div>
    </aside>
  );

  const active = allNav.find((item) => isActive(item.href));
  const mobileTitle = location.startsWith("/profile/") ? "Profile" : active?.name ?? "Overview";
  const isReactorRoute = location === "/reactor";

  return (
    <div className="atlas-noise flex min-h-[100dvh] overflow-hidden bg-background text-foreground">
      <div className="hidden md:flex"><Sidebar /></div>
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden">
          <button
            aria-label="Close menu"
            data-testid="button-overlay-close-menu"
            className="absolute inset-0 bg-background/80 backdrop-blur-sm"
            onClick={() => setSidebarOpen(false)}
          />
          <div className="relative z-10 h-full"><Sidebar mobile /></div>
        </div>
      )}
      <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="atlas-grid pointer-events-none absolute inset-0" />
        <header className="relative z-20 flex h-14 shrink-0 items-center border-b border-border/80 bg-background/85 px-4 backdrop-blur-md md:hidden">
          <div className="grid h-7 w-7 place-items-center rounded-md bg-primary text-primary-foreground shadow-[0_0_10px_rgba(var(--primary),0.3)]">
            <Crosshair className="h-4 w-4" />
          </div>
          <span className="ml-2 font-mono text-[11px] font-bold tracking-[0.14em] text-foreground">APEX ATLAS</span>
          <span className="mx-2 text-muted-foreground/40">/</span>
          <span className="truncate text-xs text-muted-foreground">{mobileTitle}</span>
          <button
            onClick={() => setSidebarOpen(true)}
            aria-label="Open menu"
            data-testid="button-open-menu"
            className="ml-auto rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Menu className="h-5 w-5" />
          </button>
        </header>
        <div className={`relative z-10 flex min-h-0 flex-1 flex-col overflow-x-hidden ${isReactorRoute ? "overflow-hidden" : "overflow-y-auto"}`}>
          {children}
        </div>
      </main>
    </div>
  );
}