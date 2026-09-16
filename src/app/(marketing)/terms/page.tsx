import type { Metadata } from "next";
import { LegalList, LegalPage, LegalSection } from "@/components/marketing/LegalPage";

export const metadata: Metadata = { title: "Terms of service · cumulusOS", description: "The terms you agree to when you use cumulusOS, including subscriptions, acceptable use and liability." };

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of service"
      updated="16 September 2026"
      intro="These terms cover your use of cumulusOS. By creating an account or using a workspace, you agree to them. If you are agreeing for a company, you confirm you may bind that company."
    >
      <LegalSection heading="The service">
        <p>cumulusOS is inventory software: parts and assemblies, receiving, builds, orders, returns, reports, connections to stores and carriers, and Strato, an assistant that drafts changes for you to approve. The product is early and features change as we build it.</p>
      </LegalSection>

      <LegalSection heading="Accounts">
        <p>Give accurate details, keep your password to yourself, and confirm your email address when asked. You are responsible for what happens under your account and for the people you invite. Tell us promptly if you suspect someone else has access.</p>
      </LegalSection>

      <LegalSection heading="Workspaces and roles">
        <p>Each workspace belongs to the account that created it. That owner decides who joins and what they may do. Owners and admins can change data, invite and remove people, connect stores, and delete the workspace&apos;s contents.</p>
      </LegalSection>

      <LegalSection heading="Subscriptions and payment">
        <LegalList
          items={[
            "Creating a workspace needs an active subscription. Teammates you invite to it are included at no extra cost.",
            "The Founding Members plan is $99 per month per workspace, charged through Stripe. Founding pricing holds for as long as the subscription stays active.",
            "Subscriptions renew every month until cancelled. Cancel any time and access continues to the end of the period already paid for.",
            "Payments are not refunded for part of a period unless the law requires it.",
            "We will give at least 30 days&apos; notice in the app before changing the price of an existing subscription.",
            "Prices exclude taxes, which are added where they apply.",
          ]}
        />
      </LegalSection>

      <LegalSection heading="Your data">
        <p>Your workspace data stays yours. You give us permission to store and process it so we can run the service for you, and nothing more. Export it whenever you like from the Exports page. Our handling of personal data is described in the privacy policy.</p>
      </LegalSection>

      <LegalSection heading="Acceptable use">
        <LegalList
          items={[
            "Do not break the law, infringe anyone's rights, or store data you have no right to hold.",
            "Do not try to break, overload, scrape or reverse engineer the service, or work around its limits.",
            "Do not resell or rent access to accounts or workspaces without our written agreement.",
          ]}
        />
      </LegalSection>

      <LegalSection heading="Strato and automated suggestions">
        <p>Strato drafts changes from your own data. Its answers can be wrong, so it asks for approval before writing anything unless you turn that off. Whoever approves a change is responsible for it, and you should check important figures before acting on them.</p>
      </LegalSection>

      <LegalSection heading="Connected services">
        <p>When you connect a store, carrier or accounting tool, you authorise us to exchange data with it on your behalf. Those services have their own terms, and we are not responsible for what they do or for outages on their side.</p>
      </LegalSection>

      <LegalSection heading="Availability">
        <p>We work to keep cumulusOS available and quick, but we do not promise a particular uptime while the product is this young. Maintenance and changes can interrupt the service.</p>
      </LegalSection>

      <LegalSection heading="Suspension and ending the agreement">
        <p>You can stop using the service and cancel at any time. We may suspend or close an account that breaks these terms, fails to pay, or puts the service or other customers at risk. If we close your account, we will give you a reasonable chance to export your data first.</p>
      </LegalSection>

      <LegalSection heading="Disclaimers and liability">
        <p>The service is provided as it is, without warranties beyond those the law requires. To the extent the law allows, we are not liable for lost profits, lost data, or indirect losses, and our total liability for any claim is limited to the fees you paid in the 12 months before it arose.</p>
      </LegalSection>

      <LegalSection heading="Changes, law and contact">
        <p>We will announce material changes to these terms in the app before they take effect. The agreement is governed by the laws of the state where cumulusOS is established, and the courts there handle any dispute. Questions go to legal@cumulusos.com.</p>
      </LegalSection>
    </LegalPage>
  );
}
