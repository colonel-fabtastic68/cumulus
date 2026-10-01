import type { Metadata } from "next";
import { LegalList, LegalPage, LegalSection } from "@/components/marketing/LegalPage";

export const metadata: Metadata = { title: "Privacy policy · cumulusOS", description: "What cumulusOS collects, why, where it is stored and how to have it deleted." };

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy policy"
      updated="30 September 2026"
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

      <LegalSection heading="Your customers' data from connected stores">
        <p>When you connect Shopify, WooCommerce or Square, cumulusOS reads orders so they can become sales orders here. From each order we keep the buyer&apos;s name, email address, phone number and shipping address, the items and quantities, and the order number. We use them for exactly two things: to show and fulfill the order, and to print the shipping label. We read nothing else about your customers, we do not build profiles, we make no automated decisions about people, and we never sell, share or use this data for advertising or for anyone other than your workspace.</p>
        <p>You are the controller of this data and we process it on your instructions under the <a href="/dpa" className="text-accent hover:underline">data processing addendum</a>. Deletion requests from the store are applied automatically through the store&apos;s compliance webhooks, and your team can erase a person&apos;s details from any customer record in the app (Customers, Erase personal data), which anonymizes every order, return and quote that named them while keeping quantities and totals for the books. Where a customer asks not to be contacted, the record carries a Do not contact flag that every outbound message respects.</p>
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
        <p>Workspace data is kept while the workspace exists. Owners and admins can export everything from the Exports page, restore or delete snapshots under Time Machine, and clear a workspace from Settings. Ask us to delete your account and we will remove it and its workspaces within 30 days, except records we must keep for tax or legal reasons. Daily snapshots are kept for 14 days and manual ones until you delete them; a deleted workspace&apos;s snapshots go with it. Customer details from a connected store are kept only as long as the order that carried them, and are removed at once when the store or the person asks. Disconnecting a store deletes its credentials immediately.</p>
      </LegalSection>

      <LegalSection heading="Security">
        <p>All traffic is encrypted in transit (TLS). All stored data, including snapshots, uploaded documents and the credentials of connected stores, is encrypted at rest by Google Cloud (AES-256). Database rules restrict every workspace to its members; store and carrier credentials live in a server-only collection that browsers cannot read. Production data is kept apart from development: the demo and local mode run entirely in the browser and never touch the production database. Access to production systems is limited to the people who run cumulusOS, protected by two-factor authentication, and every read and write of customer data is logged by Google Cloud audit logging, with changes also recorded in each workspace&apos;s own activity log. Accounts need a password of at least ten characters or a one-time code sent by email. If we learn of a breach affecting your data we will tell you without undue delay and within 72 hours of confirming it, with what happened and what we are doing. No system is perfect: tell us at once if you think an account has been compromised.</p>
      </LegalSection>

      <LegalSection heading="Your rights">
        <p>You can ask for a copy of your data, correct it, or have it deleted. Depending on where you live you may also object to certain processing, ask us to restrict it, or opt out of any sharing (we do none). Write to privacy@cumulusos.com and we will respond within 30 days. If you are a customer of a shop that uses cumulusOS, your request goes to that shop, which can act on it in the app; we help them do so.</p>
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
