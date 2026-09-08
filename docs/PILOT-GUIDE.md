# Cumulus pilot guide

Thanks for trying Cumulus. It's an early MVP: the goal of this pilot is to learn whether an agent-first inventory system feels faster and more trustworthy than line-by-line data entry. Nothing here touches your real systems; the demo workspace is a fictional pedal maker, Halcyon Audio, with six months of history.

## Setup (5 minutes)

1. `npm install && npm run dev`, open http://localhost:3000.
2. Add a Gemini key to `.env.local` as `GOOGLE_GENERATIVE_AI_API_KEY` (free at aistudio.google.com/apikey) and restart. Without it, everything works except the agent.
3. Optional: open the app in a second tab or window. Changes sync live between tabs. Use the avatar menu (top right) to switch between demo teammates.

## Scenarios

Work through as many as you like. After each one, note: did it do what you expected, what was confusing, what was missing.

### 1. Morning check (Home)
- Read the "Needs attention" list. Is the reorder quantity what you would order?
- Click an agent suggestion chip. Does the answer match the numbers on screen?

### 2. Receive a delivery (Receiving)
- Receive 100 × ENC-125B-RAW from Hammond at a slightly different cost, dated last week.
- Open the item: check Stock history (is the movement back-dated correctly?) and Batches (a new lot with the new cost).

### 3. Build and ship (Builds, Orders)
- On Builds, see how many Halcyon Overdrive (FG-OD1-BLK) you can build. Build 5.
- Open FG-OD1-BLK → BOM. Explode for 20 units. Which component runs out first?
- On Orders, fulfil the open Sweetwater order. If it refuses, do you understand why?

### 4. Fix bad data (Inventory)
- Select all "Electronics" items and bulk-set the lead time to 7 days.
- Cycle count SW-3PDT-BLU: set the counted quantity and give a reason.
- Write off 2 damaged enclosures.

### Accounts, workspaces and invites (Firestore mode)

1. Sign up at `/sign-up`. A new account lands on its Account page.
2. **Create a workspace** with the company name and currency (tick *Start with sample data* to explore first). You become its owner.
3. Invite the team from **Team → Invite teammate**: enter their email and role. They get an email with a sign-in link; opening it signs them in (or creates their account) and drops them into the workspace. The invite also waits on their Account page, and you can resend or revoke it from Team.
4. One-time Firebase setup for the emails: enable *Email link (passwordless sign-in)* under Authentication → Sign-in method → Email/Password, and add the site's domain under Authentication → Settings → Authorized domains.
5. Switch between workspaces from the company name at the top of the sidebar, or at `/account`, where accounts that arrived by link can also set a password.

### 5. Let Nimbus do the bulk work (⌘J)
Try these, in your own words:
- "Raise the price of all finished goods by 5%." Review the proposal card before applying. Reject it, then ask for 3% instead.
- "Which parts haven't moved in 120 days and aren't in any active BOM? Deactivate them."
- "Draft purchase orders for everything below minimum, grouped by supplier."
- "Set min 50 / max 200 on every Mouser part that has no min."
- "Project next month's demand for the Overdrive using seasonality."

### 6. Returns (Returns)
- Resolve RMA-1003: restock 1, scrap 1. Check that FG-OD1-BLK's stock rose by exactly one.

### 7. Reports
- Low stock: are the days-of-cover and lead-time columns useful for deciding what to order first?
- Shelf life: which batch has sat longest? Would you discount it?
- Consumption: does "sold vs consumed in builds vs written off" give you the breakdown you'd want at year end?

### 8. Bring your own data (Import)
- Export a CSV from your current system (or Shopify/WooCommerce) and import it. Did the column mapping guess right? Try "Map with AI".

## What we want to learn

- Would you trust the agent to make bulk changes with the approval card, or would you rather do it by hand?
- What is the first thing you looked for and could not find?
- Which of the 21 factors in the original brief (labor, receiving, shelf life, RMAs, BOMs within BOMs, min/max, seasonality…) matter most for your operation, and which are noise?
- Would real-time shared editing with teammates change how you run counts and receiving?

Send notes, screenshots and complaints to Baker.
