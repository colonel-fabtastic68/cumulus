"use client";

import { useCallback, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { Banner, Button, Modal, useToast } from "@/components/ui";
import { TwoStepCodeForm } from "@/components/auth/TwoStepCodeForm";
import { getRuntimeConfig } from "@/lib/firebase-config";
import { useSession } from "@/lib/session";
import { accountFeatureEnabled } from "@/lib/useFeature";

/**
 * Account → Two-step sign-in. Turning it on or off takes a code emailed to the
 * account's address. Shown while the feature is on for the deployment, and
 * always to an account that already has it on, so it can be turned off.
 */
export function TwoStepSetting() {
  const session = useSession();
  const toast = useToast();
  const [dialog, setDialog] = useState<"enable" | "disable" | null>(null);
  const enabled = session.twoStepEnabled;
  const email = session.account?.email ?? "";
  const close = useCallback(() => setDialog(null), []);
  const turnedOn = useCallback(() => {
    setDialog(null);
    toast("Two-step sign-in is on. New sign-ins will ask for an emailed code.", "success");
  }, [toast]);
  const turnedOff = useCallback(() => {
    setDialog(null);
    toast("Two-step sign-in is off.", "success");
  }, [toast]);

  if (!session.account || session.account.isAnonymous || !email) return null;
  if (!enabled && !accountFeatureEnabled("twoStep")) return null;
  const codesWork = getRuntimeConfig().emailCodes === true;

  return (
    <div data-guide="account:two-step" className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
      <div className="flex min-w-0 flex-1 items-start gap-2 text-[13px] text-text-secondary">
        <ShieldCheck className={`mt-0.5 h-4 w-4 shrink-0 ${enabled ? "text-success" : "text-text-tertiary"}`} />
        <span>
          <span className="font-medium text-text">Two-step sign-in</span> · {enabled ? "on. Every new sign-in asks for a code we email you." : "off. Turn it on to ask for an emailed code each time you sign in, so a password alone does not open your account."}
          {!enabled && !codesWork && <span className="mt-1 block text-[12px] text-text-tertiary">Email codes are not set up on this installation yet.</span>}
        </span>
      </div>
      <Button size="sm" variant={enabled ? "secondary" : "primary"} onClick={() => setDialog(enabled ? "disable" : "enable")} disabled={!enabled && !codesWork}>
        {enabled ? "Turn off" : "Turn on"}
      </Button>

      <Modal open={dialog === "enable"} onClose={close} size="sm" title="Turn on two-step sign-in" subtitle={<>We sent a code to <span className="font-medium text-text">{email}</span>. Enter it to turn two-step sign-in on.</>}>
        {dialog === "enable" && (
          <TwoStepCodeForm
            purpose="enable"
            submitLabel="Turn on"
            onDone={turnedOn}
            extra={<p className="text-[12.5px] leading-5 text-text-secondary">From then on, signing in on any device asks for a code sent to this address. Other devices signed in right now will ask for one too, within the hour.</p>}
          />
        )}
      </Modal>

      <Modal open={dialog === "disable"} onClose={close} size="sm" title="Turn off two-step sign-in" subtitle={<>We sent a code to <span className="font-medium text-text">{email}</span>. Enter it to turn two-step sign-in off.</>}>
        {dialog === "disable" && (
          <>
            <Banner tone="warning" className="mb-4">
              With it off, anyone who has your password can sign in.
            </Banner>
            <TwoStepCodeForm purpose="disable" submitLabel="Turn off" onDone={turnedOff} />
          </>
        )}
      </Modal>
    </div>
  );
}
