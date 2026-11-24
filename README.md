# Opptra Discount Engine — FDE Intern Assignment

**Live demo:** _LIVE_URL_PLACEHOLDER_

A customer-facing cart pricing engine. It picks the biggest saving per item, stacks stackable offers, applies cart-level offers, and explains every price in plain language. Rules can come from a CSV or from plain English (parsed by Google Gemini). Carts can come from a CSV or a PDF.

## Run locally (3 steps)

```bash
npm install
cp .env.example .env        # then paste a free GEMINI_API_KEY from aistudio.google.com/apikey (only for plain-English rules)
npm run dev                 # http://localhost:5173
```

Click **Load sample data** to see the expected results right away. `npm test` runs the test suite (21 tests, no API key needed).

## What was built

| Task | Where |
|---|---|
| Foundation: engine verified against the brief (ITEM-01…06, Rs.5,932 → Rs.5,339) | `src/engine/discountEngine.js`, `test/engine.test.js` |
| Task 1: cart-level offers (`scope: cart`, `min_cart_value`) | `applyCartOffer()` in the engine; `CartSummary.jsx` shows the cart offer line and a progress bar to the threshold |
| Task 2: plain-English rules → LLM → confirmation → engine re-runs | `server/parseRule.js`, `api/parse-rule.js`, `src/inputs/nlRuleInput.js`, `RuleComposer.jsx` |
| Task 3: PDF cart upload → replaces cart → engine re-runs | `src/inputs/cartTableParser.js`, `src/inputs/pdfCartInput.js` |

### Expected results (verified by `npm test` and in the UI)

| Item | Base | Applied | Final | Status |
|---|---|---|---|---|
| ITEM-01 | Rs.1,299 | RULE-01 (Rs.195) beats RULE-02 (Rs.150) | **Rs.1,104** | Max discount |
| ITEM-02 | Rs.849 | RULE-02 −Rs.150, then RULE-03 −10% | **Rs.629** | Stacked |
| ITEM-03 | Rs.599 | RULE-01 15% | **Rs.509** | Discount applied |
| ITEM-04 | Rs.2,499 | none | **Rs.2,499** | No offer |
| ITEM-05 | Rs.449 | RULE-01 15% | **Rs.382** | Discount applied |
| ITEM-06 | Rs.899 | RULE-03 10% (stackable, on its own) | **Rs.809** | Discount applied |
| Cart | Rs.5,932 | RULE-04: ≥ Rs.4,000 → 10% off, −Rs.593 | **Rs.5,339** | Cart offer |

## Architecture

```
src/
  engine/                  ← pure logic, no UI, no I/O
    discountEngine.js      processCart() item-level · applyCartOffer() cart-level
    ruleSchema.js          normaliseRule() / normaliseCartItem() — the ONE validation gate
  inputs/                  ← adapters: "some format" → raw objects → ruleSchema → engine
    csvInput.js            CSV rules + CSV cart
    cartTableParser.js     positioned text lines → CartItem[] (pure, unit-tested)
    pdfCartInput.js        PDF bytes → lines via pdf.js (lazy-loaded) → cartTableParser
    nlRuleInput.js         calls /api/parse-rule, then validates + grounds the LLM output
  components/              FileUploader (drag & drop), RuleComposer, OfferList, CartSummary (checkout view), ErrorBanner, Icon
  App.jsx                  session state; results are derived with useMemo
server/parseRule.js        Gemini call (JSON-schema output) — shared by Vercel + dev server
api/parse-rule.js          Vercel serverless function
```

**Adding a third input mode** (say, an Excel cart or a rules API) means writing one adapter in `src/inputs/` that produces raw objects and passes them through `normaliseCartItem` / `normaliseRule`. The calculator does not change. The engine's only additions for this assignment were the `cart` scope and `applyCartOffer`, which Task 1 needs. Neither new input forced an engine change.

**Results are derived, not stored.** `processCart` and `applyCartOffer` re-run whenever rules or the cart change: a confirmed rule, a removed rule, or a new CSV/PDF. Reasoning strings can never go stale, so the "Calculate" button from the base app was removed.

## Decisions and trade-offs

### Discount logic
- **Biggest rupee saving wins** among non-stackable rules, regardless of scope. Ties go to the rule listed first.
- **Stackable rules apply on top of the winner, in list order**, each on the already-discounted price (ITEM-02: 849 → 699 → 629).
- **Rounding:** each discount step is rounded to whole rupees, which matches every number in the brief (194.85 → 195, 69.9 → 70). Base prices are whole rupees.
- **A flat discount is capped at the price.** Rs.150 off a Rs.100 item gives Rs.0, never −Rs.50. The base code could go negative.
- **Cart threshold uses ≥** against the sum of *final item prices*. Exactly Rs.4,000 qualifies (tested).
- **Multiple cart rules** use the same policy as item rules: best non-stackable plus any stackable ones.
- **Just below the threshold:** the cart-offer row does not appear (as the brief requires). The customer instead sees a nudge: *"Add Rs.15 more to unlock Cart offer: 10% off"*. Try `sample-data/cart-below-threshold.csv` (Rs.3,985). The nudge only appears if unlocking that offer would actually save more than the customer gets now.
- **"No offer" is specific:** ITEM-04 reads *"No offers available — no current offer covers LivSpace Pro products on Noon"*.
- The base repo's `rules.csv` was missing RULE-04 and the `min_cart_value` column from the brief. Both were added. Old CSVs without that column still load.

### Plain-English rules (LLM)
- **The API key stays server-side.** The brief says a backend is optional, but calling an LLM from the browser would put the API key in public JavaScript. A small serverless function (`api/parse-rule.js`) is the minimum safe option. In dev, the same handler is mounted on the Vite server (`vite.config.js`), so local and deployed behaviour match.
- **Structured output:** Gemini (`gemini-2.5-flash`, falling back to `gemini-2.5-flash-lite` then `gemini-3.5-flash` if a model is overloaded, rate-limited or retired; temperature 0, free tier) must return `{ status: ok | ambiguous | unsupported, rule, message }`. The JSON schema is generated from a zod schema, and the response is re-checked against that zod schema on the server. The provider sits behind one function (`parseRuleText`), so swapping models touches one file.
- **The model's answer is a candidate, not a rule.** Before anything reaches the confirmation card:
  1. `ambiguous` / `unsupported` → shown as a specific question, not a rule. ("Give a discount for big orders" → asks for the amount and threshold.)
  2. The rule goes through **the same `normaliseRule()` as CSV rows** (percent ≤ 100, positive values, brand/platform rules need a target, cart rules need a threshold).
  3. **Grounding check:** every number in the rule must literally appear in what the user typed (`Rs.5,000`, `5k`, `20%`). If the model invents "10%" for a vague request, the result is rejected and the user is asked for the number. The trade-off: "five percent" written in words is rejected too. I think a rare re-type is better than a hallucinated discount at checkout.
  4. **Soft warnings** don't block: the brand/platform isn't in the current cart (possible typo), or the rule duplicates an active one.
- **The confirmation card** shows every parsed field, the warnings, and a preview (*Cart total if added: Rs.5,339 → Rs.X*). Confirm adds it, Discard drops it. Added rules can also be removed (✕) from the active rules table.
- Network errors, rate limits, timeouts, a missing key and blocked prompts each show a readable message. The input is capped at 500 characters, and the brands and platforms in the cart are sent as context so "natura casa" becomes "Natura Casa".

### PDF upload
- **Parsed in the browser** with pdf.js, so no server is needed for PDFs. It is lazy-loaded, so the ~370 kB library only downloads when someone uploads a PDF.
- **Column detection:** the parser finds the `Product | Brand | Platform | Base Price` header and uses its x-positions as column boundaries. Lines above the header (order number, date) are ignored. If a row was drawn as a single monospace string (like the brief's example), it falls back to splitting on runs of 2+ spaces. Both layouts are tested (`cart.pdf`, `cart-monospace.pdf`).
- **Malformed rows are skipped, not guessed.** Each skipped row is listed with its text and the reason ("missing brand", "base price must be a positive amount, got 'Rs.TBD'"), and the valid rows load. Separator lines, `Total` footers and repeated headers on later pages are ignored. See `sample-data/cart-malformed.pdf`.
- **If no valid rows are found, the current cart is kept**, so a bad upload never wipes a good cart. A scanned (image-only) PDF gets a specific message.
- Item IDs are assigned `ITEM-01…` in PDF order, since order PDFs don't carry them.

### Where I'd push back / alternatives
- **Confirmation step:** I kept it, and I think it should stay for any rule that changes customer prices. With volume, I'd suggest auto-applying only rules that pass validation *and* the grounding check *and* match existing items, sending everything else to review.
- **PDF format assumption:** a fixed 4-column table is fragile across real suppliers' invoices. The next step would be a vision-LLM fallback for PDFs whose header can't be found, with the same "confirm before replacing the cart" step used for rules.
- **Per-step rounding** can differ by a rupee from rounding once at the end. I matched the brief's numbers, but finance should sign off on one convention.

## Sample files

| File | Shows |
|---|---|
| `sample-data/rules.csv`, `cart.csv` | the brief's data |
| `sample-data/cart.pdf` | the brief's cart as a PDF table → same Rs.5,339 |
| `sample-data/cart-monospace.pdf` | same cart, rows drawn as plain monospace text |
| `sample-data/cart-malformed.pdf` | 3 bad rows (missing price, `Rs.TBD`, missing brand) and a total footer |
| `sample-data/cart-below-threshold.csv` | Rs.3,985: no cart offer, "add Rs.15 more" nudge |

Regenerate the PDFs with `npm run sample-pdfs`.

## Deploying (Vercel)

1. Import the repo in Vercel (framework: Vite; `api/` is picked up automatically).
2. Add the environment variable `GEMINI_API_KEY` (free from https://aistudio.google.com/apikey).
3. Deploy. The CSV, PDF and cart-offer features work without the key; only plain-English rules need it.
