/**
 * App.jsx
 *
 * Top-level component. Owns session state (active rules, current cart) and
 * wires input adapters → engine → display.
 *
 *   Offers: CSV upload ───────────┐
 *           Plain English (LLM) ──┤→ DiscountRule[] ─┐
 *                                                     ├→ processCart() → applyCartOffer()
 *   Cart:   CSV upload ───────────┤→ CartItem[] ─────┘
 *           PDF upload ───────────┘
 *
 * Results are derived (useMemo), so the engine re-runs automatically whenever
 * an offer is added/removed or a new cart is loaded — no stale results.
 */

import { useMemo, useRef, useState } from 'react'
import FileUploader from './components/FileUploader.jsx'
import ErrorBanner from './components/ErrorBanner.jsx'
import RuleComposer from './components/RuleComposer.jsx'
import OfferList from './components/OfferList.jsx'
import CartSummary from './components/CartSummary.jsx'
import Icon from './components/Icon.jsx'
import { parseRulesCSV, parseCartCSV } from './inputs/csvInput.js'
import { processCart, applyCartOffer } from './engine/discountEngine.js'
import { nextRuleId } from './engine/ruleSchema.js'
import sampleRules from '../sample-data/rules.csv?raw'
import sampleCart from '../sample-data/cart.csv?raw'

const readText = (file) => file.text()
const readBuffer = (file) => file.arrayBuffer()

export default function App() {
  const [rules, setRules] = useState([])
  const [rulesErrors, setRulesErrors] = useState([])
  const [rulesSource, setRulesSource] = useState('')
  const [newRuleIds, setNewRuleIds] = useState(new Set())

  const [cartItems, setCartItems] = useState([])
  const [cartErrors, setCartErrors] = useState([])
  const [cartSource, setCartSource] = useState('')
  const [cartNotice, setCartNotice] = useState('')
  const [cartBusy, setCartBusy] = useState(false)
  const [cartErrorsFatal, setCartErrorsFatal] = useState(false)
  // Bumped on every cart change; a slow PDF parse only applies if it is still the latest.
  const cartVersion = useRef(0)

  // Engine runs on every change of rules or cart.
  const results = useMemo(() => processCart(cartItems, rules), [cartItems, rules])
  const summary = useMemo(() => applyCartOffer(results, rules), [results, rules])

  // ── Offers ──

  function loadRules(csvText, name) {
    const { data, errors } = parseRulesCSV(csvText)
    setRules(data)
    setRulesErrors(errors)
    setRulesSource(name)
    setNewRuleIds(new Set())
  }

  async function handleRulesFile(file) {
    loadRules(await readText(file), file.name)
  }

  function addRule(rule) {
    // The ID was proposed when the card opened; re-check it against the live list.
    const taken = rules.some((r) => r.ruleId.toUpperCase() === rule.ruleId.toUpperCase())
    const safe = taken ? { ...rule, ruleId: nextRuleId(rules) } : rule
    setRules([...rules, safe])
    setNewRuleIds((prev) => new Set(prev).add(safe.ruleId))
  }

  function removeRule(ruleId) {
    setRules((prev) => prev.filter((r) => r.ruleId !== ruleId))
  }

  // ── Cart ── (route by file type to the matching input adapter)

  function replaceCart(items, errors, name, notice = '') {
    cartVersion.current++
    setCartErrorsFatal(false)
    setCartItems(items)
    setCartErrors(errors)
    setCartSource(name)
    setCartNotice(notice)
  }

  async function handleCartFile(file) {
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
    if (!isPdf) {
      const { data, errors } = parseCartCSV(await readText(file))
      return replaceCart(data, errors, file.name)
    }

    const version = ++cartVersion.current
    setCartBusy(true)
    let parsed
    try {
      // pdf.js is ~400 kB — only download it when someone actually uploads a PDF.
      const { parseCartPDF } = await import('./inputs/pdfCartInput.js')
      parsed = await parseCartPDF(await readBuffer(file))
    } catch (e) {
      parsed = { items: [], errors: [`The PDF reader could not be loaded (${e.message}). Check your connection and try again.`], skipped: 0 }
    } finally {
      setCartBusy(false)
    }
    // The user loaded another cart / sample / reset while this PDF was parsing.
    if (version !== cartVersion.current) return

    const { items, errors, skipped } = parsed
    if (items.length === 0) {
      // Nothing usable — keep the current cart rather than wiping it.
      setCartErrors([`No cart items could be read from ${file.name}, so your current cart was kept.`, ...errors])
      setCartErrorsFatal(true)
      setCartNotice('')
      return
    }
    replaceCart(
      items,
      errors,
      file.name,
      `Cart replaced with ${items.length} item${items.length > 1 ? 's' : ''} from ${file.name}` +
        (skipped ? `. ${skipped} row${skipped > 1 ? 's' : ''} couldn't be read and ${skipped > 1 ? 'were' : 'was'} skipped.` : '.')
    )
  }

  // ── Session ──

  function loadSampleData() {
    loadRules(sampleRules, 'sample-data/rules.csv')
    const { data, errors } = parseCartCSV(sampleCart)
    replaceCart(data, errors, 'sample-data/cart.csv')
  }

  function resetAll() {
    setRules([]); setRulesErrors([]); setRulesSource(''); setNewRuleIds(new Set())
    replaceCart([], [], '')
  }

  const hasCartRules = rules.some((r) => r.scope === 'cart')

  // ── Render ──

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="logo">O<span>pp</span>tra</div>
          <div className="topbar-title">Discount Engine · checkout preview</div>
          <div className="topbar-actions">
            <button className="btn btn-ghost-dark btn-sm" onClick={loadSampleData}>Load sample data</button>
            {(rules.length > 0 || cartItems.length > 0) && (
              <button className="btn btn-ghost-dark btn-sm" onClick={resetAll} title="Clear offers and cart">
                <Icon name="reset" size={13} /> Reset
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="layout">
        {/* ── Setup ── */}
        <div className="stack">
          <section className="card">
            <div className="card-head">
              <h2 className="card-title">Cart</h2>
              <span className="card-sub">{cartItems.length ? `${cartItems.length} items` : 'empty'}</span>
            </div>
            <FileUploader
              title="Upload cart"
              hint="CSV or order PDF (Product, Brand, Platform, Base Price)"
              accept=".csv,.pdf,text/csv,application/pdf"
              onFile={handleCartFile}
              loadedName={cartSource}
              busy={cartBusy}
            />
            {cartNotice && <div className="alert alert-ok">{cartNotice}</div>}
            <ErrorBanner
              errors={cartErrors}
              tone={cartErrorsFatal || cartItems.length === 0 ? 'error' : 'warn'}
              title={cartErrorsFatal ? "This file couldn't be used" : cartItems.length > 0 ? 'Some rows were skipped' : undefined}
            />
          </section>

          <section className="card">
            <div className="card-head">
              <h2 className="card-title">Offers</h2>
              <span className="card-sub">{rules.length} active</span>
            </div>

            <FileUploader
              title="Upload offers"
              hint="rules.csv"
              accept=".csv,text/csv"
              onFile={handleRulesFile}
              loadedName={rulesSource}
            />
            <ErrorBanner errors={rulesErrors} title="Some rules were skipped" tone="warn" />

            <div className="section-label">Describe an offer in plain English</div>
            <RuleComposer rules={rules} cartItems={cartItems} onAdd={addRule} />

            <div className="section-label">Active offers</div>
            <OfferList rules={rules} newIds={newRuleIds} onRemove={removeRule} />
          </section>
        </div>

        {/* ── Checkout ── */}
        <section className="card">
          <div className="card-head">
            <h2 className="card-title">Checkout</h2>
            {cartItems.length > 0 && <span className="card-sub">Best offer applied automatically</span>}
          </div>
          {cartItems.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon"><Icon name="cart" size={26} /></div>
              <h3>Your cart is empty</h3>
              <p>Upload a cart CSV or order PDF, or start with the sample data.</p>
              <button className="btn btn-primary" onClick={loadSampleData}>Load sample data</button>
            </div>
          ) : (
            <CartSummary results={results} summary={summary} hasCartRules={hasCartRules} />
          )}
        </section>
      </main>
    </>
  )
}
