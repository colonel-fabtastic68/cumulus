# Cumulus

Agentic, collaborative inventory management for small teams. Think Base44/Lovable meets Google Docs, for inventory.

This is an MVP for pilot testing. Everything runs locally with **no backend** except:

- a Gemini API key for the agent, and
- optionally Google Cloud Firestore for shared, real-time data (local mode works with zero setup).

## Run it

```bash
npm install
cp .env.example .env.local   # add GOOGLE_GENERATIVE_AI_API_KEY
npm run dev
```

Open http://localhost:3000. The workspace is pre-seeded with a demo company (Halcyon Audio, a guitar-pedal maker) with six months of history so reports and the agent have something to chew on. Reset or clear it from **Settings → Data**.

### Modes

| Mode | When | Where data lives | Collaboration |
| --- | --- | --- | --- |
| **Local** (default) | No `FIREBASE_*` vars | Browser `localStorage` | Open two tabs — changes sync live via `BroadcastChannel`. Use the avatar menu to switch between demo users. |
| **Firestore** | Firebase env vars set | `workspaces/{id}/…` in Firestore | Real-time across every user and device. Email/password or guest sign-in via Firebase Auth. |

To use Firestore: create a Firebase project, enable **Firestore**, enable **Email/Password** and **Anonymous** under Authentication → Sign-in method, register a Web app, and copy its config into `.env.local` as `FIREBASE_API_KEY`, `FIREBASE_PROJECT_ID`, `FIREBASE_APP_ID` (plus the optional `FIREBASE_AUTH_DOMAIN`, `FIREBASE_STORAGE_BUCKET`, `FIREBASE_MESSAGING_SENDER_ID`). Use the same names in Vercel; no `NEXT_PUBLIC_` prefix is needed because the server reads them at request time and passes the config to the browser. Accounts live on their own pages: `/sign-in`, `/sign-up` and `/reset-password` (email and password, or continue as a guest). A new account lands on its Account page: create a company (you become its owner, optionally starting from the sample data) or join one you were invited to. Owners and admins invite from **Team → Invite teammate** by email: Cumulus emails a sign-in link (Firebase "email link" auth) that signs the person in, creates their account if the address is new, and lands them in the workspace; the invite also shows up on their Account page. For that to work, enable **Email link (passwordless sign-in)** under Authentication → Sign-in method → Email/Password, and add the site's domain (for example `cumulus-six.vercel.app`) under Authentication → Settings → Authorized domains; the email wording is editable under Authentication → Templates. Accounts can belong to several workspaces and switch from the company name in the sidebar or at `/account`, where they can also set a password. Data is stored as `users/{uid}` (profile and memberships), `workspaces/{id}` (each with its own collections) and `invites/{code}`. Deploy `firestore.rules` (`firebase deploy --only firestore:rules`): it restricts every workspace to its members and lets accounts create workspaces and redeem invites. Members of the pre-account workspace named by `CUMULUS_WORKSPACE` keep their access. Signed-out visitors to any app page are sent to `/sign-in` and brought back afterwards. The marketing page is at `/` and the app home at `/home`. A new Firestore workspace starts empty and asks for the company name; Settings → Data → Clear workspace wipes everything but the team and starts that over. Rules are in `firestore.rules` (`allow read, write: if request.auth != null;`), which covers guests too.

### Nimbus, the agent

Nimbus, the agent, is Gemini Flash via the Vercel AI SDK (`/api/agent`). It has read tools (search, item detail, BOM explosion, where-used, reports) and write tools (bulk update, create items, adjust/receive/build, BOM edits, deactivate, orders, RMAs, suppliers). All tools execute **in the browser** against the active store, so the server never holds your data. Write tools render as proposal cards you approve or reject; flip **Settings → Agent → Auto-apply** to skip approvals.

Open it with the **Nimbus** button or `⌘J`. `⌘K` is global search, and `Shift+↑` / `Shift+↓` move between the sidebar pages; typing a question with no matches hands it to the agent. If Gemini answers 503 "high demand", the route automatically retries on the models in `GEMINI_FALLBACK_MODELS` (default `gemini-3.7-flash,gemini-3.5-flash,gemini-3.5-flash-lite,gemini-3.6-flash`), and any model that takes more than 15 s to start answering is skipped.

### MCP endpoint (for other agents)

Cumulus exposes its tool set over the [Model Context Protocol](https://modelcontextprotocol.io) at `POST /api/mcp` (JSON-RPC 2.0 over Streamable HTTP, stateless). Any MCP-capable host — Claude Code, Claude Desktop, Cursor, or a custom agent — gets the same tools Nimbus uses: workspace summary, item search and detail, BOM explosion, reports, and the write operations (adjust, receive, build, orders, returns, bulk updates).

```bash
claude mcp add --transport http cumulus http://localhost:3000/api/mcp --header "Authorization: Bearer $CUMULUS_MCP_TOKEN"
```

Set `CUMULUS_MCP_TOKEN` to require a bearer token. To serve the **live workspace**, give the server a Firebase service account: Firebase console → Project settings → Service accounts → Generate new private key, then put the JSON (one line) in `FIREBASE_SERVICE_ACCOUNT_JSON` locally and on Vercel. The endpoint then reads and writes `workspaces/<CUMULUS_WORKSPACE>` through the Admin SDK. Without it, the endpoint serves an in-memory demo workspace. The Nimbus page has a "Connect other agents" section with the endpoint, connection snippets, a token generator and a live test call.

## What's in the MVP

| Factor (from the brief) | Where |
| --- | --- |
| 3 · Bad data in = bad data out | Every quantity change is a ledger movement with a running balance (`Item → Stock history`). On-hand is never edited directly. |
| 2 / 19 / 20 · Shelf, sub-assemblies, relieving correctly | BOMs within BOMs. Builds relieve sub-assemblies from stock or explode them to parts. Settings → relieve on build vs on fulfilment. Optional in-use tracking flag. |
| 4 / 18 · Consumption at every layer | Reports → Consumption: sold vs consumed in builds vs written off vs returned, per item. Orders record who bought what. |
| 5 / 17 · Projections & seasonality | Reports → Seasonality (monthly sales/consumption). The agent can project from it. |
| 6 · Price & cost changes | Receiving updates standard cost. Agent bulk price/cost changes by % with margin preview. Sale price + quantity breaks per item. |
| 7 · Receiving, back-dating | Receiving with a back-datable receipt date; today's totals stay correct. |
| 8 · Waste | Expected waste % per item and per BOM line, applied on build. |
| 9 · Lead times | Per item and per supplier; low-stock report shows lead time and days of cover. |
| 10 · Shelf life | Lots per receipt/build with FIFO relief. Reports → Shelf life: oldest batch, average age. |
| 11 · RMAs | Returns with condition and disposition; restock flows back into inventory automatically. |
| 12 · Write-offs | Adjust stock → write-off with reason codes; separate report. |
| 13 · Sale prices & qty breaks | Item → Pricing. Orders pick the right price for the quantity. |
| 15 · BOM customisation & where-used | Item → BOM and Where used (direct + all ancestors). BOM tree with buildable quantity. |
| 16 · Deactivating old part numbers | Superseded status with replacement link; agent sweep for inactive parts; bulk deactivate. |
| 21 · Min/Max | Per item; Home + Reports → Low stock with reorder quantities grouped by supplier. |
| Import / migration | Import → CSV with AI column mapping, preview, upsert by SKU. |
| Exports | Exports → any dataset (items, ledger, orders, quotes, …) as CSV, TSV, Excel, JSON, JSON Lines, Markdown or a print view for PDF; whole company, a filter, or specific SKUs. Built in the browser, nothing uploaded. |
| Nimbus · Chat | Full-page chat with saved conversations for the whole team, plus the docked panel (⌘J) on every page. |
| Nimbus · Quotes | Quotes priced from your items, labour rate and margins; Nimbus drafts lines from a sentence; print/PDF, mark sent/accepted/declined, raise the sales order on acceptance. |
| Nimbus · Projections | Stock, demand, value and cost projected from the ledger for the company, a category or a SKU; seasonality, growth and price/cost scenarios, or describe a what-if in words. |
| 24 · Cross-referencing / part interchange | Item → Cross-references: OEM, aftermarket, competitor, supplier numbers and nicknames. Search, scan and Nimbus all match them; superseded numbers resolve to the replacement. |
| 29 · Bins and locations | Settings → Locations (warehouses, stores, trucks, trailers). Stock is held per location with a bin per item; Item → Locations, inventory list filter by location, put-away bin on receiving. |
| 30 · Warehouse transfers | Transfers page: pick, scan or paste a list, send between locations (in transit at neither end), receive with shortfalls written off. |
| 32 · Barcode scanning | Scan button / ⌘/ in the top bar: phone camera or a USB/Bluetooth scanner typing into the page (keyboard wedge). Scan into receiving, transfers and search; matches barcodes, SKUs and cross-references. |
| 34 · Backorders | Ship part of an order; the rest stays open and shows under Orders → Backordered and Reports → Backorders with expected dates from supplier lead times. Receiving flags which backorders it covers. |
| 38 · KPI dashboards | Reports → KPIs: inventory turnover, days on hand, fill rate and stockouts, company-wide and by category or SKU, for 30 / 90 / 365 days. |
| 40 · Multi-channel sales sync | Integrations → Shopify and WooCommerce, two-way: products and open orders in, and out again go new items (draft or live), edits (name, price, description, weight, barcode, active/inactive), stock levels, and deletions (WooCommerce trash / Shopify archive). Store-side edits and deletions come back via webhooks. Credentials are verified with the platform and kept server-side; WooCommerce falls back to signed OAuth 1.0a requests when a host hides HTTPS from WordPress. |
| 41 · Shipping carriers | Integrations → Shippo or EasyPost: rate-shop the carriers on your account when shipping an order, buy the label, track it. Manual carrier and tracking entry always works. |

Not yet: live vendor price feeds (6b), product configurators (15a/b), automatic sourcing search (14), scheduled automations actually running on a schedule (they're defined on the Agents page and can be run on demand), and QuickBooks / Square sync (CSV import covers migration for now).

Pilot testers: start with [docs/PILOT-GUIDE.md](docs/PILOT-GUIDE.md).

### Live connections (stores and carriers)

Channels and carriers run through the app's own API routes, so they only work in Firestore mode with a service account on the server (`FIREBASE_SERVICE_ACCOUNT_JSON`, the same one the MCP endpoint uses). Nothing is pre-filled: each workspace connects its own accounts under Integrations.

- **Shopify**: create a custom app in Shopify admin (Settings → Apps and sales channels → Develop apps) with `read_products`, `read_inventory`, `write_inventory`, `read_orders`, `read_locations`, install it and paste the Admin API access token. The API secret key is optional and lets webhooks be signature-checked.
- **WooCommerce**: WooCommerce → Settings → Advanced → REST API → Add key (Read/Write); paste the consumer key and secret. The site must be https.
- **Shippo / EasyPost**: paste the API token (test tokens buy free sample labels). Set a ship-from address and default parcel under Settings → Shipping and scanning.

Credentials are verified with the platform on connect, then stored in `workspaces/{ws}/secrets/{integration}`, which `firestore.rules` denies to every client (redeploy the rules after pulling this: `firebase deploy --only firestore:rules`). Webhooks are registered at connect time against `APP_URL` (or the request's origin). `vercel.json` schedules a daily reconciliation at `/api/integrations/cron`; set `CRON_SECRET` on Vercel so only the scheduler can call it. What a channel syncs is per connection: products in, orders in, stock out, accept counts from the store, and which Cumulus location mirrors it.

## Architecture

```
src/
  lib/types.ts          domain model (Item, StockMovement, Lot, Receipt, Build, SalesOrder, Rma, …)
  lib/store/            Store interface + LocalStore (localStorage) + FirestoreStore
  lib/inventory.ts      all mutations & reports (BOM explosion, receiving, builds, transfers, shipping, imports…)
  lib/kpis.ts           turnover, days on hand, fill rate, stockouts from the ledger
  lib/quotes.ts         quote totals, drafting from Nimbus, status flow, order from quote
  lib/projections.ts    rebuilt stock history + usage/seasonality/growth forecast
  lib/export/           dataset tables, CSV/TSV/JSON/JSONL/Markdown/PDF, dependency-free XLSX + ZIP writers
  lib/gemini.ts         structured Gemini calls (quote drafter, scenario reader) with model fallback
  lib/scan.ts           barcode / SKU / cross-reference matching
  lib/integrations/     server-side channel + carrier clients (Shopify, WooCommerce, Shippo, EasyPost)
  app/api/integrations  connect / disconnect / sync / webhook / push-stock / cron routes
  app/api/shipping      rates / buy label / track / carrier webhooks
  lib/agent/tools.ts    tool schemas shared by server and client
  lib/agent/execute.ts  client-side tool execution against the store
  app/api/agent         streamText + Gemini (no data access; tools run on the client)
  components/ui         small Polaris-flavoured component kit
  app/(app)/…           pages
```

Design language: flat white / off-white, quiet borders, 10–14px radii, Inter. Tokens live in `src/app/globals.css`.
