"use client";

import { useEffect, useState } from "react";
import { Bell, ChevronDown, LogOut, Menu as MenuIcon, ScanBarcode, Search, Settings2, Sparkles, UserRound } from "lucide-react";
import { Avatar, AvatarStack, Button, IconButton, Kbd, Menu } from "@/components/ui";
import { isOnline, useAuth, useCurrentUser } from "@/lib/auth";
import { useCollection } from "@/lib/store/provider";
import { useAgent } from "@/components/agent/AgentProvider";
import { ScanModal, useScanWedge } from "@/components/scan";
import { useSettings } from "@/lib/store/provider";
import { GlobalSearch } from "./GlobalSearch";

export function TopBar({ onMenu }: { onMenu?: () => void }) {
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
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-nav-bg px-4">
      <button type="button" onClick={onMenu} className="mr-1 rounded p-1.5 text-text-secondary hover:bg-surface-hover md:hidden" aria-label="Menu">
        <MenuIcon className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={openSearch}
        className="flex h-8 w-full max-w-md items-center gap-2 rounded-[var(--radius-sm)] border border-border bg-surface px-3 text-[13px] text-text-tertiary shadow-[var(--shadow-100)] hover:border-border-strong"
      >
        <Search className="h-3.5 w-3.5" />
        <span className="flex-1 text-left">Search Cumulus…</span>
        <Kbd>⌘K</Kbd>
      </button>
      <div className="flex-1" />
      {online.length > 0 && (
        <div className="hidden items-center gap-2 text-[12px] text-text-secondary sm:flex" title={`Online: ${online.map((m) => m.name).join(", ")}`}>
          <AvatarStack members={online} />
          <span>{online.length} online</span>
        </div>
      )}
      <Button variant={isOpen ? "primary" : "secondary"} size="md" icon={<Sparkles />} onClick={() => (isOpen ? toggleAgent() : openAgent())} className="hidden sm:inline-flex">Nimbus <Kbd>⌘J</Kbd>
      </Button>
      <IconButton variant="plain" size="md" className="text-text-secondary" aria-label="Scan a barcode (⌘/)" title="Scan (⌘/)" onClick={() => setScan({ open: true })} icon={<ScanBarcode />} />
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
            : [
                { label: "Account and workspaces", href: "/account", icon: <Settings2 /> },
                { label: "Sign out", onSelect: () => signOut(), icon: <LogOut /> },
              ]),
        ]}
      />
      <GlobalSearch key={searchNonce} open={searchOpen} onClose={() => setSearchOpen(false)} />
      <ScanModal key={scan.code ?? "scan"} open={scan.open} initialCode={scan.code} onClose={() => setScan({ open: false })} />
    </header>
  );
}

