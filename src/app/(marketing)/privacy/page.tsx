import type { Metadata } from "next";
import { LegalList, LegalPage, LegalSection } from "@/components/marketing/LegalPage";

export const metadata: Metadata = { title: "Privacy policy · cumulusOS", description: "What cumulusOS collects, why, where it is stored and how to have it deleted." };

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy policy"
      updated="16 September 2026"
      intro="cumulusOS is inventory software for small product teams. This policy explains what we collect when you use it, why we hold it, who processes it on our behalf, and how to get it back or have it deleted."
    >
      <LegalSection heading="What we collect">
        <LegalList
          items={[
            "Account details: your name, email address and the workspaces you belong to. Passwords are handled by Google Firebase Authentication and are never visible to us.",
            "Workspace data: everything your team enters, such as items, suppliers, stock movements, orders, returns, quotes and files you import.",
            "Billing details: your subscription status, renewal date and Stripe customer reference. Card numbers go straight to Stripe and never reach our servers.",
            "Technical data: request logs, IP address, browser type and error reports, kept so we can keep the service running and secure.",
            "Messages you send to Strato, our assistant, and the workspace records needed to answer them.",
          ]}
        />
      </LegalSection>

      <LegalSection heading="Why we use it">
        <p>We use this data to run the service: to sign you in, show your workspace, sync with the stores and carriers you connect, take payment, answer support questions, and investigate faults or abuse. We do not sell it, and we do not use your workspace data for advertising.</p>
      </LegalSection>

      <LegalSection heading="Who processes it for us">
        <LegalList
          items={[
            "Google Firebase and Google Cloud: accounts, database and file storage.",
            "Vercel: hosting and request logs.",
            "Google Gemini: answers your requests to Strato. The request and the workspace records needed to answer it are sent to Google for processing.",
            "Stripe: subscription payments.",
            "Resend: verification and notification emails.",
            "Calendly: booking a demo, if you choose to book one.",
            "Stores and carriers you connect yourself, such as Shopify, WooCommerce, Shippo and EasyPost.",
          ]}
        />
        <p>Each of these receives only what it needs for that job, and we do not give anyone else access to your workspace.</p>
      </LegalSection>

      <LegalSection heading="Cookies and browser storage">
        <p>We use no advertising or tracking cookies. Your browser stores your sign-in session and small preferences such as the workspace you last opened and the layout of some screens. In local mode, the whole workspace stays in your browser and never reaches our servers.</p>
      </LegalSection>

      <LegalSection heading="Keeping and deleting data">
        <p>Workspace data is kept while the workspace exists. Owners and admins can export everything from the Exports page or from Settings, and can clear a workspace from Settings. Ask us to delete your account and we will remove it and its workspaces, except records we must keep for tax or legal reasons. Backups roll off within 30 days.</p>
      </LegalSection>

      <LegalSection heading="Security">
        <p>Traffic is encrypted in transit. Database rules restrict every workspace to its members, and credentials for connected stores and carriers are held server-side where browsers cannot read them. No system is perfect: tell us at once if you think an account has been compromised.</p>
      </LegalSection>

      <LegalSection heading="Your rights">
        <p>You can ask for a copy of your data, correct it, or have it deleted. Depending on where you live you may also object to certain processing or ask us to restrict it. Write to privacy@cumulusos.com and we will respond within 30 days.</p>
      </LegalSection>

      <LegalSection heading="Children">
        <p>cumulusOS is for businesses. It is not meant for anyone under 16, and we do not knowingly collect their data.</p>
      </LegalSection>

      <LegalSection heading="Changes and contact">
        <p>If this policy changes in a way that affects you, we will say so in the app before the change takes effect. Questions go to privacy@cumulusos.com.</p>
      </LegalSection>
    </LegalPage>
  );
}
