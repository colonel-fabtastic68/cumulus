"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, ChevronDown, LogOut, Menu as MenuIcon, Search, Sparkles, UserRound } from "lucide-react";
import { Avatar, AvatarStack, Button, IconButton, Kbd, Menu, Modal } from "@/components/ui";
import { isOnline, useAuth, useCurrentUser } from "@/lib/auth";
import { useCollection } from "@/lib/store/provider";
import { useAgent } from "@/components/agent/AgentProvider";
import { matches } from "@/lib/utils";

export function TopBar({ onMenu }: { onMenu?: () => void }) {
  const { mode, switchUser, signOut } = useAuth();
  const user = useCurrentUser();
  const members = useCollection("members");
  const { open: openAgent, isOpen } = useAgent();
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchNonce, setSearchNonce] = useState(0);
  const openSearch = () => {
    setSearchNonce((n) => n + 1);
    setSearchOpen(true);
  };
  const online = members.filter((m) => m.id !== user.id && isOnline(m));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchNonce((n) => n + 1);
        setSearchOpen(true);
      }
      if (mod && e.key.toLowerCase() === "j") {
        e.preventDefault();
        openAgent();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [openAgent]);

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-bg px-4">
      <button type="button" onClick={onMenu} className="mr-1 rounded p-1.5 text-text-secondary hover:bg-surface-hover md:hidden" aria-label="Menu">
        <MenuIcon className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={openSearch}
        className="flex h-8 w-full max-w-md items-center gap-2 rounded-[var(--radius-sm)] border border-border bg-surface px-2.5 text-[13px] text-text-tertiary shadow-[0_1px_0_rgba(0,0,0,0.03)] hover:border-border-strong"
      >
        <Search className="h-3.5 w-3.5" />
        <span className="flex-1 text-left">Search items, orders, suppliers…</span>
        <Kbd>⌘K</Kbd>
      </button>
      <div className="flex-1" />
      {online.length > 0 && (
        <div className="hidden items-center gap-2 text-[12px] text-text-secondary sm:flex" title={`Online: ${online.map((m) => m.name).join(", ")}`}>
          <AvatarStack members={online} />
          <span>{online.length} online</span>
        </div>
      )}
      <Button variant={isOpen ? "primary" : "secondary"} size="md" icon={<Sparkles />} onClick={() => openAgent()} className="hidden sm:inline-flex">
        Agent <Kbd>⌘J</Kbd>
      </Button>
      <IconButton variant="plain" size="md" className="text-text-secondary" aria-label="Activity" href="/activity" icon={<Bell />} />
      <Menu
        trigger={
          <button type="button" className="flex items-center gap-1.5 rounded-[var(--radius-sm)] px-1.5 py-1 hover:bg-surface-hover">
            <Avatar member={user} size={26} />
            <ChevronDown className="h-3.5 w-3.5 text-text-tertiary" />
          </button>
        }
        items={[
          { label: <span className="text-text-secondary">{user.name} · {user.role}</span>, disabled: true, icon: <UserRound /> },
          "divider",
          ...(mode === "local"
            ? [
                { label: <span className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">Switch user (demo)</span>, disabled: true },
                ...members.map((m) => ({ label: `${m.name}${m.id === user.id ? " ✓" : ""}`, onSelect: () => switchUser(m.id) })),
              ]
            : [{ label: "Sign out", onSelect: () => signOut(), icon: <LogOut /> }]),
        ]}
      />
      <GlobalSearch key={searchNonce} open={searchOpen} onClose={() => setSearchOpen(false)} />
    </header>
  );
}

function GlobalSearch({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const items = useCollection("items");
  const orders = useCollection("orders");
  const suppliers = useCollection("suppliers");
  const rmas = useCollection("rmas");
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const { open: openAgent } = useAgent();

  const results = useMemo(() => {
    if (!q.trim()) return [];
    const out: Array<{ label: string; sub?: string; href: string; kind: string }> = [];
    for (const i of items) if (matches(q, i.sku, i.name, i.category, i.barcode)) out.push({ label: `${i.sku} · ${i.name}`, sub: `${i.onHand} on hand`, href: `/inventory/${i.id}`, kind: "Item" });
    for (const o of orders) if (matches(q, o.number, o.customer)) out.push({ label: `${o.number} · ${o.customer}`, sub: o.status, href: `/orders?highlight=${o.id}`, kind: "Order" });
    for (const r of rmas) if (matches(q, r.number, r.customer, r.reason)) out.push({ label: `${r.number} · ${r.customer}`, sub: r.status, href: `/rmas?highlight=${r.id}`, kind: "RMA" });
    for (const s of suppliers) if (matches(q, s.name)) out.push({ label: s.name, href: `/suppliers?highlight=${s.id}`, kind: "Supplier" });
    return out.slice(0, 12);
  }, [q, items, orders, rmas, suppliers]);

  const go = (i: number) => {
    const r = results[i];
    if (r) {
      router.push(r.href);
      onClose();
    }
  };

  return (
    <Modal open={open} onClose={onClose} size="md">
      <div className="-m-5">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Search className="h-4 w-4 text-text-tertiary" />
          <input
            autoFocus
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setIdx(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setIdx((i) => Math.min(results.length - 1, i + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setIdx((i) => Math.max(0, i - 1));
              } else if (e.key === "Enter") {
                if (results.length) go(idx);
                else if (q.trim()) {
                  openAgent(q);
                  onClose();
                }
              }
            }}
            placeholder="Search by SKU, name, order number, customer…"
            className="h-8 flex-1 bg-transparent text-[14px] outline-none placeholder:text-text-tertiary"
          />
          <Kbd>esc</Kbd>
        </div>
        <div className="max-h-[50vh] overflow-y-auto p-1.5">
          {results.length === 0 ? (
            <div className="px-3 py-6 text-center text-[13px] text-text-tertiary">
              {q.trim() ? (
                <button type="button" className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-accent-soft px-2.5 py-1.5 text-accent" onClick={() => { openAgent(q); onClose(); }}>
                  <Sparkles className="h-3.5 w-3.5" /> Ask the agent: “{q}”
                </button>
              ) : (
                "Type to search across items, orders, returns and suppliers."
              )}
            </div>
          ) : (
            results.map((r, i) => (
              <button
                key={r.href + i}
                type="button"
                onMouseEnter={() => setIdx(i)}
                onClick={() => go(i)}
                className={`flex w-full items-center justify-between gap-3 rounded-[6px] px-3 py-2 text-left text-[13px] ${i === idx ? "bg-surface-hover" : ""}`}
              >
                <span className="min-w-0">
                  <span className="block truncate text-text">{r.label}</span>
                  {r.sub && <span className="block text-[12px] text-text-tertiary">{r.sub}</span>}
                </span>
                <span className="shrink-0 rounded-full bg-surface-hover px-1.5 text-[11px] text-text-secondary">{r.kind}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </Modal>
  );
}
