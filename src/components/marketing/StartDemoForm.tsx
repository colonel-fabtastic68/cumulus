"use client";

import { useState, useSyncExternalStore, type FormEvent } from "react";
import { ArrowRight } from "lucide-react";
import { Button, Checkbox, TextField } from "@/components/ui";
import { clearLocalWorkspace, hasLocalWorkspace } from "@/lib/store/local";

const EMAIL_KEY = "cumulus:demo:email";

function readSavedEmail(): string {
  try {
    return localStorage.getItem(EMAIL_KEY) ?? "";
  } catch {
    return "";
  }
}

const listeners = new Set<() => void>();
function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}
const notify = () => listeners.forEach((l) => l());

/** Browser-only values, read after hydration so the server and first client render agree. */
function useBrowserValue<T>(read: () => T, fallback: T): T {
  return useSyncExternalStore(subscribe, read, () => fallback);
}

/**
 * The gate in front of the demo: an email address, then the workspace. The
 * address joins the mailing list under the "demo" source. The start route
 * sets the demo cookie and redirects; that is a plain navigation, not a link,
 * so nothing prefetches a route that sets cookies.
 */
export function StartDemoForm() {
  const [email, setEmail] = useState("");
  const saved = useBrowserValue(readSavedEmail, "");
  const hasData = useBrowserValue(hasLocalWorkspace, false);
  const [fresh, setFresh] = useState(false);
  const [state, setState] = useState<"idle" | "busy" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const open = () => {
    if (fresh) clearLocalWorkspace();
    window.location.assign(new URL("/demo/start", window.location.origin).toString());
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const address = (saved || email).trim();
    if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(address)) {
      setState("error");
      setError("Enter a valid email address.");
      return;
    }
    setState("busy");
    setError(null);
    try {
      const res = await fetch("/api/mailing-list", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: address, source: "demo" }) });
      if (res.status === 400 || res.status === 429) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "Could not save that address.");
      }
      // Any other failure is the server's problem, not the visitor's: let them in.
    } catch (err) {
      if (err instanceof Error && err.message !== "Failed to fetch") {
        setState("error");
        setError(err.message);
        return;
      }
    }
    try {
      localStorage.setItem(EMAIL_KEY, address.toLowerCase());
    } catch {}
    notify();
    open();
  };

  return (
    <form onSubmit={submit} noValidate className="flex max-w-[560px] flex-col gap-3">
      {saved ? (
        <p className="text-[14px] text-text-secondary">
          Continuing as <span className="font-medium text-text">{saved}</span>.{" "}
          <button
            type="button"
            className="text-accent hover:underline"
            onClick={() => {
              try {
                localStorage.removeItem(EMAIL_KEY);
              } catch {}
              notify();
            }}
          >
            Not you?
          </button>
        </p>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
          <TextField type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" autoComplete="email" aria-label="Email" containerClassName="flex-1" error={state === "error" ? (error ?? undefined) : undefined} />
          <Button type="submit" variant="primary" size="lg" iconRight={<ArrowRight />} loading={state === "busy"} disabled={!email.trim() || state === "busy"}>
            Open the demo
          </Button>
        </div>
      )}
      {saved && (
        <div>
          <Button type="submit" variant="primary" size="lg" iconRight={<ArrowRight />} loading={state === "busy"} disabled={state === "busy"}>
            Open the demo
          </Button>
          {state === "error" && error && <p className="mt-2 text-[12.5px] text-critical">{error}</p>}
        </div>
      )}
      {hasData && <Checkbox label="Start with fresh sample data" help="You have been in the demo before on this device. Tick to reset what you changed." checked={fresh} onChange={setFresh} />}
    </form>
  );
}
