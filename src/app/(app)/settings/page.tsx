"use client";

import { useEffect, useMemo, type ReactNode } from "react";
import type { WorkspaceSettings } from "@/lib/types";
import { currentInstance, releaseStage } from "@/lib/firebase-config";
import { useSettings } from "@/lib/store/provider";
import { useAuth, useCurrentUser } from "@/lib/auth";
import { useAgent } from "@/components/agent/AgentProvider";
import { Banner, Page, Section } from "@/components/ui";
import {
  AboutSection,
  AgentSection,
  BillingSection,
  CatalogSection,
  CategoriesSection,
  CompanySection,
  DataSection,
  InventoryPolicySection,
  LabsSection,
  LocationsSection,
  PeriodCloseSection,
  labsFeatures,
  QuotingSection,
  ShippingSection,
  TerminologySection,
  TimeMachineSection,
  settingsSection,
} from "@/components/workspace/settings";
import { canManageTeam } from "@/components/workspace/team";
import { useFeatures } from "@/lib/useFeature";

/** One settings block. The id is the anchor search results and links point at (/settings#locations). */
function Row({ id, children }: { id: string; children: ReactNode }) {
  const def = settingsSection(id);
  return (
    <div id={id} data-guide={`settings:${id}`} className="scroll-mt-4 border-t border-border py-6 first:border-t-0 first:pt-0 last:pb-0">
      <Section title={def.title} description={def.description}>
        {children}
      </Section>
    </div>
  );
}

/** JSON with object keys sorted, so the same settings always give the same text whatever order the store returns fields in. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${stableJson((value as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** What the forms show: every setting except the Labs switches and the save stamp, hashed short. */
function settingsFormKey(settings: WorkspaceSettings): string {
  const shown: Partial<WorkspaceSettings> = { ...settings };
  delete shown.features;
  delete shown.updatedAt;
  const text = stableJson(shown);
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export default function SettingsPage() {
  const settings = useSettings();
  const user = useCurrentUser();
  const { mode } = useAuth();
  const { setPageContext } = useAgent();
  const canManage = canManageTeam(user);
  const readOnly = !canManage;
  const features = useFeatures();

  useEffect(() => {
    setPageContext({ page: "Settings" });
  }, [setPageContext]);

  // Links like /settings#locations (search results, help text) arrive before the sections exist,
  // so the browser's own hash scroll finds nothing. Scroll once the page has rendered.
  useEffect(() => {
    const jump = () => {
      const id = window.location.hash.slice(1);
      if (id) document.getElementById(id)?.scrollIntoView({ block: "start" });
    };
    jump();
    window.addEventListener("hashchange", jump);
    return () => window.removeEventListener("hashchange", jump);
  }, []);

  // Forms restart from the stored values when something they show changes: after their own save,
  // or when a teammate changes settings. A Labs switch only changes `features`, so flipping one
  // leaves half-typed edits in other sections alone and nothing above it is rebuilt.
  const formKey = useMemo(() => settingsFormKey(settings), [settings]);

  return (
    <Page medium title="Settings" subtitle="Company details, inventory policy, Strato, your plan and where the data lives">
      {readOnly && (
        <Banner tone="info" title="Read-only" className="mb-5">
          Only owners and admins can change settings. You can still review everything here.
        </Banner>
      )}
      <div className="flex flex-col">
        <Row id="company">
          <CompanySection key={formKey} settings={settings} readOnly={readOnly} />
        </Row>
        <Row id="inventory-policy">
          <div className="flex flex-col gap-4">
            <InventoryPolicySection key={formKey} settings={settings} readOnly={readOnly} />
            {features.periodLocks && <PeriodCloseSection settings={settings} canManage={canManage} />}
          </div>
        </Row>
        <Row id="catalog">
          <div className="flex flex-col gap-4">
            <CatalogSection key={formKey} settings={settings} readOnly={readOnly} />
            {features.partNumbers && <TerminologySection key={`terms-${formKey}`} settings={settings} readOnly={readOnly} />}
            {features.categoryTools && <CategoriesSection readOnly={readOnly} />}
          </div>
        </Row>
        <Row id="locations">
          <LocationsSection readOnly={readOnly} />
        </Row>
        <Row id="shipping">
          <ShippingSection key={formKey} settings={settings} readOnly={readOnly} />
        </Row>
        <Row id="quoting">
          <QuotingSection key={formKey} settings={settings} readOnly={readOnly} />
        </Row>
        <Row id="strato">
          <AgentSection key={formKey} settings={settings} readOnly={readOnly} />
        </Row>
        {!currentInstance() && (
          <Row id="billing">
            <BillingSection settings={settings} />
          </Row>
        )}
        {labsFeatures(releaseStage()).length > 0 && (
          <Row id="labs">
            <LabsSection settings={settings} readOnly={readOnly} />
          </Row>
        )}
        {canManage && (
          <Row id="time-machine">
            <TimeMachineSection />
          </Row>
        )}
        {/* Hosted workspaces: backup, reset and clear live on the admin dashboard. Local mode keeps them here (there is no admin). */}
        {mode !== "firestore" && (
          <Row id="data">
            <DataSection settings={settings} canManage={canManage} />
          </Row>
        )}
        <Row id="about">
          <AboutSection />
        </Row>
      </div>
    </Page>
  );
}
