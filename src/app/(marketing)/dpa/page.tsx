import type { Metadata } from "next";
import { LegalList, LegalPage, LegalSection } from "@/components/marketing/LegalPage";

export const metadata: Metadata = { title: "Data processing addendum · cumulusOS", description: "How cumulusOS processes personal data on behalf of the businesses that use it: roles, instructions, security, subprocessors, deletion and breach notice." };

export default function DpaPage() {
  return (
    <LegalPage
      title="Data processing addendum"
      updated="30 September 2026"
      intro="This addendum is part of the terms of service for every workspace. It covers personal data that cumulusOS processes for you, including your customers' details that arrive from connected stores. You are the controller of that data; cumulusOS is your processor."
    >
      <LegalSection heading="What we process, and why">
        <p>Customer names, email addresses, phone numbers and shipping addresses, together with order lines, quantities and order numbers, arriving from stores you connect or entered by your team. We process them only to run the workspace: showing and fulfilling orders, printing labels, syncing stock, and producing the reports and exports you ask for. Account details of your team members are processed to sign them in and record who did what.</p>
      </LegalSection>

      <LegalSection heading="Your instructions">
        <p>We act only on your documented instructions: the settings you choose, the stores you connect, the actions your team takes in the app, and this addendum. We do not use personal data for any other purpose, do not sell or share it, do not profile people, and make no automated decisions about them. If a law requires us to process data otherwise, we will tell you first unless the law forbids it.</p>
      </LegalSection>

      <LegalSection heading="Security measures">
        <LegalList
          items={[
            "Encryption in transit (TLS) for every connection, and at rest (AES-256, managed by Google Cloud) for all stored data, backups and uploaded files.",
            "Workspace isolation enforced by database security rules; store and carrier credentials in a server-only collection.",
            "Production data kept separate from development and testing; the demo and local mode never reach production.",
            "Access to production limited to the people who operate cumulusOS, with two-factor authentication, and all data access logged by Google Cloud audit logging. Every change inside a workspace is written to its activity log.",
            "Daily encrypted snapshots kept for 14 days, with point-in-time restore available to workspace owners, as the loss-prevention measure.",
            "A security incident process: contain, assess, notify affected customers without undue delay and within 72 hours of confirmation, remediate, and record.",
          ]}
        />
      </LegalSection>

      <LegalSection heading="Subprocessors">
        <p>We use these providers to deliver the service, each bound by its own data processing terms: Google Cloud and Firebase (database, authentication, file storage, backups), Vercel (hosting and request logs), Google Gemini (processing requests to Strato and reading photographed checklists), Stripe (billing, with no customer data of yours), Resend (transactional email). Connected stores and carriers are services you contract with directly. We will post changes to this list on this page at least 30 days before they take effect, and you may end the agreement if you object.</p>
      </LegalSection>

      <LegalSection heading="Deletion and data subject requests">
        <LegalList
          items={[
            "Deletion requests from a connected store are applied automatically through its compliance webhooks.",
            "Your team can erase a person's details from any customer record; every order, return and quote that named them is anonymized in the same step.",
            "Disconnecting a store deletes its credentials at once. Clearing or deleting a workspace deletes its records and, within 30 days, its snapshots.",
            "On termination we delete your workspace data within 30 days of your request, unless a law requires us to keep specific records.",
            "We assist with access, correction, portability and objection requests you receive: the Exports page produces a complete copy, and we answer questions at privacy@cumulusos.com within 30 days.",
          ]}
        />
      </LegalSection>

      <LegalSection heading="Confidentiality, audits and location">
        <p>Everyone who operates cumulusOS is bound to confidentiality. On request, no more than once a year, we will provide the information needed to show compliance with this addendum, including our providers&apos; current certifications. Data is stored in Google Cloud regions in the United States; where transfers out of the EEA or UK occur, they rely on the providers&apos; standard contractual clauses.</p>
      </LegalSection>

      <LegalSection heading="Contact">
        <p>Questions about this addendum, or to report a security concern: privacy@cumulusos.com.</p>
      </LegalSection>
    </LegalPage>
  );
}
