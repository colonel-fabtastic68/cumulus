"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AppWindow, Apple, Beaker, Beef, Boxes, BookOpen, Brain, CreditCard, Ellipsis, FilePlus, Gauge, Globe, Hammer, Layers, NotebookPen, Package, PackageOpen, Plug, RotateCcw, ShoppingBag, Store, Table2, Tag, Users, Wrench } from "lucide-react";
import { Badge, Banner, Button } from "@/components/ui";
import { useAgent } from "@/components/agent/AgentProvider";
import { ImportWizard } from "@/components/import/ImportWizard";
import type { ParsedSource, WizardStep } from "@/components/import/types";
import { useSaveSettings } from "@/components/workspace/settings/useSaveSettings";
import { canWrite, useCurrentUser } from "@/lib/auth";
import { APP_HOME } from "@/lib/auth-routes";
import { ITEM_KIND_OPTIONS, SOURCE_OPTIONS, USAGE_OPTIONS, sourceOption, sourcesFromIntake } from "@/lib/onboarding";
import { useSession } from "@/lib/session";
import { useItems, useSettings } from "@/lib/store/provider";
import type { OnboardingAnswers } from "@/lib/types";
import { nowIso } from "@/lib/utils";
import { ChoiceCards, type Choice } from "./ChoiceCards";
import { HelpButton } from "./HelpButton";
import { ImportHub, type ImportVia } from "./ImportHub";
import { StepFrame } from "./StepFrame";

/** 1 tools · 2 goals · 3 items · 4 bring data in · 5 map · 6 review · 7 done */
type Flow = 1 | 2 | 3 | 4 | 5 | 6 | 7;
const TOTAL = 7;
const STEP_NAMES: Record<Flow, string> = { 1: "Your tools", 2: "Your goals", 3: "What you track", 4: "Bring your data in", 5: "Match the columns", 6: "Review", 7: "Done" };
/** The conversational line typed above each step's question. */
const LEADS: Record<Flow, (first: string) => string> = {
  1: (first) => (first ? `Welcome to cumulusOS, ${first}!` : "Welcome to cumulusOS!"),
  2: () => "Good to know. Next question.",
  3: () => "Almost there. One more.",
  4: () => "Now the part that matters: your data.",
  5: () => "Let's line things up.",
  6: () => "One last look before it saves.",
  7: () => "That's it. Nice work.",
};

const SOURCE_ICONS: Record<string, React.ReactNode> = {
  spreadsheet: <Table2 className="h-4 w-4" />,
  quickbooks: <BookOpen className="h-4 w-4" />,
  square: <Store className="h-4 w-4" />,
  shopify: <ShoppingBag className="h-4 w-4" />,
  woocommerce: <Globe className="h-4 w-4" />,
  clover: <CreditCard className="h-4 w-4" />,
  "other-app": <AppWindow className="h-4 w-4" />,
  paper: <NotebookPen className="h-4 w-4" />,
  memory: <Brain className="h-4 w-4" />,
};
const USAGE_ICONS: Record<string, React.ReactNode> = { light: <Gauge className="h-4 w-4" />, partial: <Layers className="h-4 w-4" />, full: <Boxes className="h-4 w-4" /> };
const KIND_ICONS: Record<string, React.ReactNode> = {
  "finished-goods": <Package className="h-4 w-4" />,
  parts: <Wrench className="h-4 w-4" />,
  "raw-materials": <Beaker className="h-4 w-4" />,
  retail: <Tag className="h-4 w-4" />,
  food: <Apple className="h-4 w-4" />,
  supplies: <PackageOpen className="h-4 w-4" />,
  equipment: <Hammer className="h-4 w-4" />,
  livestock: <Beef className="h-4 w-4" />,
  other: <Ellipsis className="h-4 w-4" />,
};

const toggleIn = (list: string[], id: string, exclusive: string[] = []) => {
  if (exclusive.includes(id)) return list.includes(id) ? [] : [id];
  const without = list.filter((x) => x !== id && !exclusive.includes(x));
  return list.includes(id) ? without : [...without, id];
};

/**
 * The guided setup a new workspace lands on: three quick questions, then an
 * import hub shaped by the answers, then the usual map → review → done. Every
 * answer is saved on the workspace settings as it is given, so Strato and
 * the Import page know the business from then on.
 */
export function OnboardingFlow() {
  const router = useRouter();
  const session = useSession();
  const settings = useSettings();
  const items = useItems();
  const user = useCurrentUser();
  const save = useSaveSettings();
  const { setPageContext } = useAgent();
  const writable = canWrite(user);

  const [flow, setFlow] = useState<Flow>(1);
  const [answers, setAnswers] = useState<OnboardingAnswers>(() => ({
    ...settings.onboarding,
    sources: settings.onboarding?.sources ?? sourcesFromIntake(session.profile?.business?.integrations),
  }));
  const [source, setSource] = useState<{ parsed: ParsedSource; via: ImportVia; nonce: number } | null>(null);
  const [scratch, setScratch] = useState(false);
  const [websiteImported, setWebsiteImported] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const startedAt = useRef(settings.onboarding?.startedAt ?? nowIso());

  useEffect(() => {
    setPageContext({ page: `Setup · ${STEP_NAMES[flow]}` });
  }, [flow, setPageContext]);
  useEffect(() => {
    window.scrollTo({ top: 0 });
    document.querySelector("main")?.scrollTo({ top: 0 });
  }, [flow]);

  const persist = useCallback(
    async (patch: Partial<OnboardingAnswers>, done = false) => {
      const next: OnboardingAnswers = { ...answers, ...patch, startedAt: startedAt.current, ...(done ? { completedAt: nowIso() } : {}) };
      setAnswers(next);
      setSaving(true);
      setSaveError(null);
      try {
        await save({ onboarding: next });
      } catch (e) {
        setSaveError(e instanceof Error ? e.message : String(e));
      } finally {
        setSaving(false);
      }
      return next;
    },
    [answers, save],
  );

  const finish = async (via?: ImportVia) => {
    await persist(via ? { importedVia: via } : {}, true);
    router.replace(APP_HOME);
  };
  const skip = () => void finish();

  const companyName = settings.companyName;
  const sourceChoices = useMemo<Choice[]>(() => SOURCE_OPTIONS.map((s) => ({ id: s.id, label: s.label, hint: s.hint, icon: SOURCE_ICONS[s.id] })), []);
  const usageChoices = useMemo<Choice[]>(() => USAGE_OPTIONS.map((u) => ({ id: u.id, label: u.label, hint: u.hint, icon: USAGE_ICONS[u.id] })), []);
  const kindChoices = useMemo<Choice[]>(() => ITEM_KIND_OPTIONS.map((k) => ({ id: k.id, label: k.label, hint: k.hint, icon: KIND_ICONS[k.id] })), []);

  const help = <HelpButton where={STEP_NAMES[flow]} />;
  const firstName = (session.account?.name ?? user.name ?? "").trim().split(/\s+/)[0] ?? "";
  const frame = { total: TOTAL, companyName, onSkip: flow < 7 ? skip : undefined, help, stepName: STEP_NAMES[flow], lead: LEADS[flow](firstName) };

  // The wizard's own steps (2 map, 3 review, 4 done) drive the frame once a table is loaded; step 1 means the table was removed.
  const onWizardStep = useCallback((s: WizardStep) => {
    if (s === 1) {
      setSource(null);
      setFlow(4);
    } else setFlow((s + 3) as Flow);
  }, []);

  const integrationSources = (answers.sources ?? []).map(sourceOption).filter((s) => s?.integrationId);
  const doneActions = (
    <>
      <Button variant="primary" size="lg" icon={<Boxes />} onClick={() => void finish(scratch ? "scratch" : source?.via)}>
        Open {companyName || "your workspace"}
      </Button>
      <Button
        icon={<RotateCcw />}
        onClick={() => {
          setSource(null);
          setScratch(false);
          setFlow(4);
        }}
      >
        Import another file
      </Button>
      {answers.usage === "full" && (
        <Button variant="plain" icon={<Users />} href="/team">
          Invite the team
        </Button>
      )}
      {integrationSources[0] && (
        <Button variant="plain" icon={<Plug />} href={`/integrations?connect=${integrationSources[0].integrationId}`}>
          Connect {integrationSources[0].label}
        </Button>
      )}
    </>
  );

  if (!writable) {
    return (
      <StepFrame step={1} total={1} stepName="Setup" title="Setup needs an owner or admin" subtitle="Your role can look around but not import items. Ask the workspace owner to run the setup, or open the workspace as it is." companyName={companyName} help={help}>
        <Button variant="primary" href={APP_HOME}>
          Open the workspace
        </Button>
      </StepFrame>
    );
  }

  if (flow === 1)
    return (
      <StepFrame {...frame} step={1} title="Where does your inventory live today?" subtitle="Pick everything that applies. The next steps show how to get the data out of each one and into cumulusOS." onContinue={() => void persist({}).then(() => setFlow(2))} continueBusy={saving}>
        <ChoiceCards options={sourceChoices} selected={answers.sources ?? []} onToggle={(id) => setAnswers((a) => ({ ...a, sources: toggleIn(a.sources ?? [], id) }))} other={{ id: "other-app", label: "Which app?", value: answers.otherSource ?? "", onChange: (v) => setAnswers((a) => ({ ...a, otherSource: v })), placeholder: "Zoho, Lightspeed, Odoo, inFlow…" }} />
        {saveError && <Banner tone="critical" className="mt-4">{saveError}</Banner>}
      </StepFrame>
    );

  if (flow === 2)
    return (
      <StepFrame {...frame} step={2} title="What should cumulusOS do for you?" subtitle="This sets what the workspace shows first. Everything stays available; nothing is locked away." onBack={() => setFlow(1)} onContinue={() => void persist({}).then(() => setFlow(3))} continueBusy={saving}>
        <ChoiceCards options={usageChoices} selected={answers.usage ? [answers.usage] : []} single columns={1} onToggle={(id) => setAnswers((a) => ({ ...a, usage: a.usage === id ? undefined : (id as OnboardingAnswers["usage"]) }))} />
        {saveError && <Banner tone="critical" className="mt-4">{saveError}</Banner>}
      </StepFrame>
    );

  if (flow === 3)
    return (
      <StepFrame {...frame} step={3} title="What do you keep track of?" subtitle="Strato uses this to suggest units, categories and sensible reorder levels when your data comes in." onBack={() => setFlow(2)} onContinue={() => void persist({}).then(() => setFlow(4))} continueBusy={saving}>
        <ChoiceCards options={kindChoices} selected={answers.itemKinds ?? []} columns={3} onToggle={(id) => setAnswers((a) => ({ ...a, itemKinds: toggleIn(a.itemKinds ?? [], id) }))} other={{ id: "other", label: "What is it?", value: answers.otherKinds ?? "", onChange: (v) => setAnswers((a) => ({ ...a, otherKinds: v })), placeholder: "Wine bottles, art prints, lab samples…" }} />
        {saveError && <Banner tone="critical" className="mt-4">{saveError}</Banner>}
      </StepFrame>
    );

  if (flow === 4 && !source && !scratch)
    return (
      <StepFrame
        {...frame}
        step={4}
       
        title="Bring your inventory in"
        subtitle="Follow the steps for the tools you named, or use any of the other ways in. Everything is checked on a review screen before it is saved."
        wide
        onBack={() => setFlow(3)}
        secondary={
          <Button variant="plain" icon={<FilePlus />} onClick={() => setScratch(true)}>
            Start from scratch instead
          </Button>
        }
      >
        {items.length > 0 && (
          <Banner tone="info" className="mb-4" title={`${items.length} items are already here`}>
            Another import adds to them; rows with a SKU already in the workspace update that item.
          </Banner>
        )}
        {websiteImported && (
          <Banner tone="success" className="mb-4" title="Your website's catalog is in" action={<Button variant="primary" onClick={() => void finish("website")}>Open the workspace</Button>}>
            Counts and costs are blank until you add them; Strato can ask for them in batches.
          </Banner>
        )}
        <ImportHub answers={answers} onSource={(parsed, via) => setSource({ parsed, via, nonce: Date.now() })} onWebsiteImported={() => setWebsiteImported(true)} />
      </StepFrame>
    );

  if (scratch)
    return (
      <StepFrame {...frame} step={7} lead="That's it. Nice work." stepName="Ready" title="A blank workspace, ready for your first item" subtitle="Add items one at a time from Inventory, scan barcodes from your phone, or come back to Import any time; the same walkthrough lives there." onSkip={undefined}>
        <div className="card p-6">
          <div className="flex flex-wrap gap-2">
            <Badge>Inventory → New item</Badge>
            <Badge>Receiving → scan a delivery</Badge>
            <Badge>Import → spreadsheet, paper or website</Badge>
          </div>
          <p className="mt-4 text-[13.5px] leading-6 text-text-secondary">Strato is a click away in the top bar whenever you want help naming SKUs, setting min/max levels or building a BOM.</p>
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <Button variant="primary" size="lg" icon={<Boxes />} onClick={() => void finish("scratch")}>
              Open {companyName || "the workspace"}
            </Button>
            <Button
              icon={<RotateCcw />}
              onClick={() => {
                setScratch(false);
                setFlow(4);
              }}
            >
              Import something after all
            </Button>
          </div>
        </div>
      </StepFrame>
    );

  // 5, 6, 7: the import wizard's own map / review / done, inside the frame.
  const titles: Record<number, [string, string]> = {
    5: ["Match the columns", "Each column of your table becomes an item field. Most are matched already; fix any that are wrong, or let Strato map them."],
    6: ["Check before it saves", "New items, updates and problems, row by row. Strato can fill in blanks the file left: SKUs, categories, units and reorder levels."],
    7: ["Your inventory is in", "Every quantity went through the stock ledger, so the history starts clean."],
  };
  const [title, subtitle] = titles[flow] ?? titles[5]!;
  return (
    <StepFrame {...frame} step={flow} title={title} subtitle={subtitle} wide stable onSkip={flow < 7 ? skip : undefined}>
      {source && <ImportWizard key={source.nonce} initialSource={source.parsed} hideStepper onStepChange={onWizardStep} doneActions={doneActions} />}
    </StepFrame>
  );
}
