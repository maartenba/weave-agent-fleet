"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  LayoutGrid,
  GitBranch,
  ListTodo,
  FileText,
  Bell,
  History,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

const navItems = [
  { href: "/", label: "Fleet", icon: LayoutGrid },
  { href: "/pipelines", label: "Pipelines", icon: GitBranch },
  { href: "/queue", label: "Queue", icon: ListTodo, badge: 4 },
  { href: "/templates", label: "Templates", icon: FileText },
  { href: "/alerts", label: "Alerts", icon: Bell, badge: 2 },
  { href: "/history", label: "History", icon: History },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex h-screen w-56 flex-col border-r border-sidebar-border bg-sidebar">
      {/* Weave branding */}
      <div className="flex items-center gap-3 border-b border-sidebar-border px-4 py-4">
        <Image
          src="/weave_logo.png"
          alt="Weave"
          width={32}
          height={32}
          className="rounded-md"
        />
        <div>
          <h1 className="text-sm font-semibold font-mono weave-gradient-text">
            Weave
          </h1>
          <p className="text-[10px] text-muted-foreground font-mono">
            Agent Fleet
          </p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-1 p-2">
        {navItems.map((item) => {
          const isActive =
            pathname === item.href ||
            (item.href !== "/" && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground"
              )}
            >
              <item.icon className="h-4 w-4" />
              <span className="flex-1">{item.label}</span>
              {item.badge && (
                <Badge
                  variant="secondary"
                  className="h-5 min-w-5 justify-center px-1.5 text-xs"
                >
                  {item.badge}
                </Badge>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="border-t border-sidebar-border p-2">
        <Link
          href="/settings"
          className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground"
        >
          <Settings className="h-4 w-4" />
          <span>Settings</span>
        </Link>
      </div>
    </aside>
  );
}
