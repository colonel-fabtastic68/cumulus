"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Building2, Check, ChevronDown, ChevronsUpDown, Mail, Plus } from "lucide-react";
import { CloudMark, Kbd, Menu, type MenuItem } from "@/components/ui";
import { cn } from "@/lib/utils";
import { useCollection, useSettings } from "@/lib/store/provider";
import { isLowStock } from "@/lib/inventory";
import { useSession } from "@/lib/session";
import { APP_HOME } from "@/lib/auth-routes";
import { isChildNavActive, isNavActive, NAV, NAV_SECONDARY, type NavItem } from "./nav";

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const session = useSession();
  const navRef = useRef<HTMLElement>(null);
  const settings = useSettings();
  const items = useCollection("items");
  const orders = useCollection("orders");
  const rmas = useCollection("rmas");
  const lowCount = items.filter(isLowStock).length;
  const openOrders = orders.filter((o) => o.status === "open").length;
  const openRmas = rmas.filter((r) => r.status === "open" || r.status === "inspecting").length;
  const counts: Record<string, number> = { "/inventory": lowCount, "/orders": openOrders, "/rmas": openRmas };

  // Keep the active entry visible when the page changes from the keyboard (Shift+↑/↓) on short windows.
  useEffect(() => {
    navRef.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: "nearest" });
  }, [pathname]);

  const renderLink = (n: NavItem) => {
    const Icon = n.icon;
    const active = isNavActive(n.href, pathname);
    const count = counts[n.href];
    // A group: the parent row opens its first page; the children show while any of them is open.
    if (n.children?.length) {
      return (
        <div key={n.href} className="flex flex-col gap-0.5">
          <Link
            href={n.children[0]!.href}
            onClick={onNavigate}
            aria-expanded={active}
            className={cn("group flex h-8 items-center gap-2.5 rounded-[var(--radius-sm)] px-2.5 text-[13px] font-[550] transition-colors", active ? "text-text" : "text-text hover:bg-[rgba(0,0,0,0.04)]")}
          >
            <Icon className={cn("h-4 w-4", active ? "text-text" : "text-icon")} />
            <span className="flex-1">{n.label}</span>
            <ChevronDown className={cn("h-3.5 w-3.5 text-text-tertiary transition-transform", active ? "rotate-0" : "-rotate-90")} />
          </Link>
          {active &&
            n.children.map((c) => {
              const ChildIcon = c.icon;
              const childActive = isChildNavActive(c, n.children!, pathname);
              return (
                <Link
                  key={c.href}
                  href={c.href}
                  onClick={onNavigate}
                  aria-current={childActive ? "page" : undefined}
                  className={cn(
                    "group ml-4 flex h-7 items-center gap-2 rounded-[var(--radius-sm)] px-2.5 text-[12.5px] font-[550] transition-colors",
                    childActive ? "bg-surface text-text shadow-[var(--shadow-100),0_0_0_1px_rgba(26,26,26,0.07)]" : "text-text-secondary hover:bg-[rgba(0,0,0,0.04)] hover:text-text",
                  )}
                >
                  <ChildIcon className={cn("h-3.5 w-3.5", childActive ? "text-text" : "text-icon")} />
                  <span className="flex-1">{c.label}</span>
                </Link>
              );
            })}
        </div>
      );
    }
    return (
      <Link
        key={n.href}
        href={n.href}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        className={cn(
          "group flex h-8 items-center gap-2.5 rounded-[var(--radius-sm)] px-2.5 text-[13px] font-[550] transition-colors",
          active ? "bg-surface text-text shadow-[var(--shadow-100),0_0_0_1px_rgba(26,26,26,0.07)]" : "text-text hover:bg-[rgba(0,0,0,0.04)]",
        )}
      >
        <Icon className={cn("h-4 w-4", active ? "text-text" : "text-icon")} />
        <span className="flex-1">{n.label}</span>
        {count ? <span className={cn("rounded-full px-1.5 text-[11px] font-medium", n.href === "/inventory" ? "bg-warning-soft text-warning" : "bg-surface-hover text-text-secondary")}>{count}</span> : null}
      </Link>
    );
  };

  return (
    <aside className="flex h-full w-[232px] shrink-0 flex-col border-r border-border bg-nav-bg">
      {session.mode === "firestore" ? (
        <Menu
          align="left"
          className="w-full"
          trigger={
            <button type="button" className="flex h-14 w-full items-center gap-2.5 px-4 text-left hover:bg-[rgba(0,0,0,0.04)]" aria-label="Switch workspace">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-primary text-white">
                <CloudMark />
              </span>
              <span className="min-w-0 flex-1 leading-tight">
                <span className="block truncate text-[13.5px] font-semibold text-text">{settings.companyName}</span>
                <span className="block text-[11px] text-text-tertiary">{session.pendingInvites.length ? `${session.pendingInvites.length} pending invite${session.pendingInvites.length === 1 ? "" : "s"}` : "Cumulus"}</span>
              </span>
              <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
            </button>
          }
          items={[
            ...session.workspaces.map<MenuItem>((w) => ({
              label: w.name,
              icon: w.id === session.workspaceId ? <Check /> : <Building2 />,
              onSelect: () => {
                if (w.id === session.workspaceId) return;
                session.switchWorkspace(w.id);
                router.push(APP_HOME);
                onNavigate?.();
              },
            })),
            "divider",
            { label: session.pendingInvites.length ? `Invites (${session.pendingInvites.length})` : "Account and workspaces", icon: <Mail />, href: "/account" },
            { label: "Create a workspace", icon: <Plus />, href: "/account#create" },
          ]}
        />
      ) : (
        <div className="flex h-14 items-center gap-2.5 px-4">
          <span className="flex h-7 w-7 items-center justify-center rounded-[8px] bg-primary text-white">
            <CloudMark />
          </span>
          <div className="min-w-0 leading-tight">
            <div className="truncate text-[13.5px] font-semibold text-text">{settings.companyName}</div>
            <div className="text-[11px] text-text-tertiary">Cumulus</div>
          </div>
        </div>
      )}
      <nav ref={navRef} className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 pb-3">
        {NAV.map(renderLink)}
        <div className="mt-4 mb-1 px-2.5 text-[12px] font-[550] text-text-secondary">Workspace</div>
        {NAV_SECONDARY.map(renderLink)}
      </nav>
      <div className="flex items-center gap-1.5 border-t border-border px-4 py-2 text-[11px] text-text-tertiary" title="Hold Shift and press the up or down arrow to move between pages">
        <Kbd>⇧</Kbd>
        <Kbd>↑</Kbd>
        <Kbd>↓</Kbd>
        <span>switch pages</span>
      </div>
    </aside>
  );
}
