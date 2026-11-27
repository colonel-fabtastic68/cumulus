"use client";

import { useCallback, useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Skeleton } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { signInHref } from "@/lib/auth-routes";
import { useSession } from "@/lib/session";
import { useNextPath } from "./AuthPage";
import { TwoStepCodeForm } from "./TwoStepCodeForm";

/**
 * The second step of signing in, for accounts with two-step sign-in on: a code
 * goes to the account's email when the page opens, and nothing in a workspace
 * opens until it is entered. Accounts with nothing owed go on to where they
 * were going.
 */
export function TwoStep() {
  const session = useSession();
  const { status, needsTwoStep, account, mode } = session;
  const { signOut } = useAuth();
  const router = useRouter();
  const next = useNextPath();

  useEffect(() => {
    if (mode === "local") router.replace(next);
    else if (status === "signed-out") router.replace(signInHref(`/two-step?next=${encodeURIComponent(next)}`));
    else if (account && !needsTwoStep && status !== "loading") router.replace(next);
  }, [mode, status, needsTwoStep, account, next, router]);

  const done = useCallback(() => router.replace(next), [router, next]);

  if (!needsTwoStep) {
    return (
      <Card title="Checking your account">
        <div className="flex flex-col gap-3">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-2/3" />
        </div>
      </Card>
    );
  }

  return (
    <Card
      title="Enter your sign-in code"
      subtitle={
        <>
          Two-step sign-in is on for this account. Enter the 6-digit code we sent to <span className="font-medium text-text">{account?.email}</span>. It expires in 10 minutes.
        </>
      }
    >
      <TwoStepCodeForm purpose="sign-in" submitLabel="Continue" onDone={done} />
      <p className="mt-5 text-center text-[12.5px] text-text-secondary">
        Not you, or no access to that inbox?{" "}
        <button type="button" onClick={() => void signOut()} className="font-medium text-accent hover:underline">
          Sign out
        </button>
      </p>
    </Card>
  );
}

function Card({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <section className="card p-6 sm:p-8">
      <h1 className="text-[20px] font-semibold leading-7 text-text">{title}</h1>
      {subtitle && <p className="mt-1.5 text-[13.5px] leading-5 text-text-secondary">{subtitle}</p>}
      <div className="mt-5">{children}</div>
    </section>
  );
}
