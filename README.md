# UniGenome

Anti-counterfeit tracking for any product. Each item gets a signed QR identity. Every scan along the supply chain (factory, warehouse, shop) is signed and records where and when it happened. One QR on a carton or pallet stands for everything inside it. A buyer scans the product to see whether it is genuine and its whole journey, and can raise a complaint.

- **Portals:** Manufacturer (and quality approver), Warehouse, Retailer, Buyer, Regulator, each with its own screen.
- **DSA, live:** `/dsa` shows all 13 data structures and algorithms running on the app's real data.
- **Code walkthrough:** [docs/DSA-CODE-WALKTHROUGH.md](docs/DSA-CODE-WALKTHROUGH.md) explains each topic with the exact code.
- **Feature walkthrough:** [docs/FEATURE-WALKTHROUGH.md](docs/FEATURE-WALKTHROUGH.md) takes each feature (for example "a copied QR gets flagged") line by line through the code, with the DSA topic at each step. In VS Code, install the CodeTour extension to step through the same thing inside the editor.

## Run it on your laptop

You need [Node.js 20 or newer](https://nodejs.org).

```bash
git clone https://github.com/gaganrasineni08/unigenome.git
cd unigenome
npm install
npm run seed      # loads the demo data (takes about 10 seconds)
npm run dev       # starts the app
```

Open **http://localhost:5173**.

To run the built version on one port instead: `npm run build && npm start`, then open http://localhost:8787.

The data is saved in the `data/` folder (an embedded Postgres). Delete that folder, or use **Reset and reload** at the bottom of the home page, to start again. To use a real Postgres server instead, set `DATABASE_URL`.

## Demo accounts

Every demo account uses the passphrase **demo1234**.

| Portal | Username | Who |
|---|---|---|
| Manufacturer | `sunpharma` | Sun Remedies Ltd, Pune plant |
| Manufacturer (quality approver) | `sunqa` | Co-signs new batches |
| Warehouse | `hydwarehouse` | Deccan Logistics, Hyderabad |
| Warehouse | `mumwarehouse` | Western Cargo, Mumbai |
| Retailer | `apollo` | City Pharmacy, Banjara Hills |
| Retailer | `medplus` | Care Pharmacy, Secunderabad |
| Retailer | `andheri` | Wellness Chemists, Andheri |
| Regulator | `regulator` | Drug Control Authority |

The buyer portal needs no account.

## A 5-minute demo

1. **Manufacturer** (`sunpharma`): Batches → create a batch. It waits for a second signature.
2. **Quality approver** (`sunqa`): Co-sign it.
3. **Manufacturer**: Issue items → Pack (First 12 → Sign and pack) → Labels → Scan & dispatch: type the carton id, Dispatch to *Deccan Logistics*. The expected arrival date is shown.
4. **Warehouse** (`hydwarehouse`): Scan the carton → Receive. "12 items updated by this one scan". Dispatch to *City Pharmacy*.
5. **Retailer** (`apollo`): Scan → Receive → Open carton. The server picks random items for a spot check. Scan an item → Mark sold.
6. **Buyer**: open the item's QR (Labels page in the manufacturer portal, or scan it with a phone). Genuine, with the full journey. Enter the hidden code to claim it, or raise a complaint.
7. **Regulator** (`regulator`): Alerts (priority queue), Recall (BFS + knapsack), Complaints, Expiring.

The demo data already includes a cold-chain failure (insulin batch B-0871), a carton in transit, and a complaint.

**Showing a fake:** change one character of a QR link and open it: Counterfeit. **Showing a copy:** open a sold item's link again with the browser's location set far away (Chrome DevTools → Sensors): Suspicious Clone.

## Phones and the camera

Browsers only allow the camera on `https://` pages or on `localhost`. On a phone connected to your laptop's Wi-Fi (`http://<laptop-ip>:5173`), use **Upload photo** to scan a picture of the QR, or paste the code. With an HTTPS deployment the live camera works.

## Project layout

```
shared/        code used by both the browser and the server
  dsa/         hash map, heap, merkle, trie, AVL, graph (BFS, Dijkstra), knapsack, tree (DFS)
  crypto.ts    SHA-256 and Ed25519
  identity.ts  item and carton identities, QR payloads
  events.ts    signed custody records and the hash chain
  geo.ts       haversine distance and travel speed
server/        API (Hono), database schema, verdict and recall logic, demo data
src/           React app: home page (3D), portals, DSA page
tests/         unit tests for every data structure (npm test)
docs/          DSA code walkthrough
```

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | API on :8787 and web app on :5173, with reload |
| `npm run seed` | Delete all data and load the demo |
| `npm test` | Run the data structure tests |
| `npm run typecheck` | TypeScript check |
| `npm run build` / `npm start` | Production build, served with the API on :8787 |
