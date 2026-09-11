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

### 6b. Locations, bins and transfers (Settings → Locations, Transfers)
- Add a second location (a truck, a trailer, a second warehouse). Receiving now asks where the stock lands and takes a bin per line.
- Open an item → Locations to see what is where, and set bins inline.
- Transfers → New transfer: pick lines, scan them, or paste "SKU, qty" from a spreadsheet. The stock leaves now and is "in transit" until the other end receives it. Receive fewer than sent and the difference is written off with the transfer as the reason.
- Inventory → filter by location to see one site's stock; select rows → Transfer to move them.

### 6c. Scan (⌘/ or the barcode button)
- Point the phone camera at a barcode, or use a USB/Bluetooth scanner: it types into the page and Cumulus catches it, no field focus needed (turn that off under Settings → Shipping and scanning if it interferes).
- A scan finds the item by barcode, SKU, a cross-reference (OEM / competitor / supplier number) or the channel id, then offers open, receive, transfer.
- Item → Cross-references: add the other numbers a part is known by. Search finds them too.

### 6d. Ship, partial or with a label (Orders)
- Ship an open order: choose the quantity per line. Ship less than ordered and the rest stays open as a backorder (Orders → Backordered, Reports → Backorders with expected dates from lead times).
- Enter the carrier and tracking by hand, or connect Shippo / EasyPost (Integrations) and set a ship-from address under Settings → Shipping and scanning to compare rates and buy the label. Tracking updates land on the shipment.

### 6e. Connect a store (Integrations, hosted mode only)
- Shopify or WooCommerce: paste the API credentials from your store (the modal lists where to find them). Products come in by SKU, open orders become sales orders, and, when switched on, on-hand counts go back out.
- Nothing is demo data: a fresh workspace stays empty until you connect or import.

### 6f. Quotes, projections and exports (Nimbus menu, Exports)
- Nimbus → Chat is the full-page conversation; every chat is saved for the team in the rail on the left.
- Nimbus → Quotes → New quote: type what the customer wants ("12 overdrive pedals assembled and tested, 2 hours setup") and press Draft lines. Nimbus only uses your items and the labour rate from Settings → Quoting. Adjust, print (Save as PDF), mark sent, and on acceptance raise the sales order in one step.
- Nimbus → Projections: pick the company, a category or a SKU and a horizon. Type a scenario ("orders up 25% through the holidays", "costs up 8% next quarter") and the dials move. Check the per-item table for run-out and order-by dates.
- Exports: tick datasets, choose whole company / filter / specific SKUs (or select rows on Inventory → Export), pick CSV, Excel, JSON, JSON Lines, TSV, Markdown or PDF.

### 7. Reports
- Low stock: are the days-of-cover and lead-time columns useful for deciding what to order first?
- Shelf life: which batch has sat longest? Would you discount it?
- Consumption: does "sold vs consumed in builds vs written off" give you the breakdown you'd want at year end?
- KPIs: turnover, days on hand, fill rate and stockouts for 30 / 90 / 365 days, by category or SKU. Backorders: what is short, by how much, and when it could ship.

### 8. Bring your own data (Import)
- Export a CSV from your current system (or Shopify/WooCommerce) and import it. Did the column mapping guess right? Try "Map with AI".

## What we want to learn

- Would you trust the agent to make bulk changes with the approval card, or would you rather do it by hand?
- What is the first thing you looked for and could not find?
- Which of the 21 factors in the original brief (labor, receiving, shelf life, RMAs, BOMs within BOMs, min/max, seasonality…) matter most for your operation, and which are noise?
- Would real-time shared editing with teammates change how you run counts and receiving?

Send notes, screenshots and complaints to Baker.
