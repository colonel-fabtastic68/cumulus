"use client";

import { useModKey } from "@/lib/platform";

import { useEffect, useState } from "react";
import { currentInstance } from "@/lib/firebase-config";
import { Bell, ChevronDown, LogOut, Menu as MenuIcon, ScanBarcode, Search, Settings2, Sparkles, UserRound } from "lucide-react";
import { Avatar, AvatarStack, Button, IconButton, Kbd, Menu } from "@/components/ui";
import { isOnline, useAuth, useCurrentUser } from "@/lib/auth";
import { useCollection } from "@/lib/store/provider";
import { useAgent } from "@/components/agent/AgentProvider";
import { ScanModal, useScanWedge } from "@/components/scan";
import { useSettings } from "@/lib/store/provider";
import { GlobalSearch } from "./GlobalSearch";

export function TopBar({ onMenu }: { onMenu?: () => void }) {
  const mod = useModKey();
  const { mode, switchUser, signOut } = useAuth();
  const user = useCurrentUser();
  const members = useCollection("members");
  const { open: openAgent, toggle: toggleAgent, isOpen } = useAgent();
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchNonce, setSearchNonce] = useState(0);
  const [scan, setScan] = useState<{ open: boolean; code?: string }>({ open: false });
  const settings = useSettings();
  // Factor 32: a USB/Bluetooth scanner typing into the page opens what it scanned.
  useScanWedge((code) => setScan({ open: true, code }), { enabled: settings.scanning?.keyboardWedge !== false });
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
        toggleAgent();
      }
      if (mod && e.key === "/") {
        e.preventDefault();
        setScan({ open: true });
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [toggleAgent]);

  return (
    // On a phone the bar is five controls wide: the search field shrinks to its icon and a word, keyboard hints go, and Strato is an icon.
    <header className="flex h-14 shrink-0 items-center gap-1 border-b border-border bg-nav-bg px-3 md:gap-2 md:px-4">
      <button type="button" onClick={onMenu} className="rounded p-2 text-text-secondary hover:bg-surface-hover md:hidden" aria-label="Menu">
        <MenuIcon className="h-5 w-5" />
      </button>
      <button
        type="button"
        onClick={openSearch}
        className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-[var(--radius-sm)] border border-border bg-surface px-3 text-[13px] text-text-tertiary shadow-[var(--shadow-100)] hover:border-border-strong md:h-8 md:max-w-md md:flex-none md:basis-[28rem]"
      >
        <Search className="h-4 w-4 shrink-0 md:h-3.5 md:w-3.5" />
        <span className="min-w-0 flex-1 truncate text-left">
          <span className="md:hidden">Search</span>
          <span className="hidden md:inline">{currentInstance() ? "Search…" : "Search cumulusOS…"}</span>
        </span>
        <span className="hidden md:inline-flex">
          <Kbd>{mod}K</Kbd>
        </span>
      </button>
      <div className="hidden flex-1 md:block" />
      {online.length > 0 && (
        <div className="hidden items-center gap-2 text-[12px] text-text-secondary lg:flex" title={`Online: ${online.map((m) => m.name).join(", ")}`}>
          <AvatarStack members={online} />
          <span>{online.length} online</span>
        </div>
      )}
      <span className="hidden md:inline-flex">
        <Button variant={isOpen ? "primary" : "secondary"} size="md" icon={<Sparkles />} onClick={() => (isOpen ? toggleAgent() : openAgent())}>
          Strato <Kbd>{mod}J</Kbd>
        </Button>
      </span>
      <span className="md:hidden">
        <IconButton variant={isOpen ? "primary" : "plain"} size="md" className={isOpen ? undefined : "text-text-secondary"} aria-label="Strato" onClick={() => (isOpen ? toggleAgent() : openAgent())} icon={<Sparkles />} />
      </span>
      <IconButton variant="plain" size="md" className="text-text-secondary" aria-label={`Scan a barcode (${mod}/)`} title={`Scan (${mod}/)`} onClick={() => setScan({ open: true })} icon={<ScanBarcode />} />
      <IconButton variant="plain" size="md" className="hidden text-text-secondary sm:inline-flex" aria-label="Activity" href="/activity" icon={<Bell />} />
      <Menu
        trigger={
          <button type="button" className="flex items-center gap-1 rounded-[var(--radius-sm)] px-1 py-1 hover:bg-surface-hover md:gap-1.5 md:px-1.5">
            <Avatar member={user} size={26} />
            <ChevronDown className="hidden h-3.5 w-3.5 text-text-tertiary md:block" />
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
            : [
                ...(currentInstance() ? [] : [{ label: "Account and workspaces", href: "/account", icon: <Settings2 /> }]),
                { label: "Sign out", onSelect: () => signOut(), icon: <LogOut /> },
              ]),
        ]}
      />
      <GlobalSearch key={searchNonce} open={searchOpen} onClose={() => setSearchOpen(false)} />
      <ScanModal key={scan.code ?? "scan"} open={scan.open} initialCode={scan.code} onClose={() => setScan({ open: false })} />
    </header>
  );
}

