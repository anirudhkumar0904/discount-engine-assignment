/**
 * App.jsx
 *
 * Top-level component. Owns session state (active rules, current cart) and
 * wires input adapters → engine → display.
 *
 *   Rules:  CSV upload  ─┐                       ┌─ processCart()     (item-level)
 *           Plain English (LLM) ─┤→ DiscountRule[]  ─┤
 *   Cart:   CSV upload  ─┐                       └─ applyCartOffer()  (cart-level)
 *           PDF upload  ─┤→ CartItem[]
 *
 * Results are derived (useMemo), so the engine re-runs automatically whenever
 * a rule is added/removed or a new cart is loaded — no stale results.
 */

import { useMemo, useState } from 'react'
import FileUploader from './components/FileUploader.jsx'
import DataTable from './components/DataTable.jsx'
import ErrorBanner from './components/ErrorBanner.jsx'
import RuleComposer from './components/RuleComposer.jsx'
import CartSummary from './components/CartSummary.jsx'
import { parseRulesCSV, parseCartCSV } from './inputs/csvInput.js'
import { processCart, applyCartOffer } from './engine/discountEngine.js'
import sampleRules from '../sample-data/rules.csv?raw'
import sampleCart from '../sample-data/cart.csv?raw'

const rs = (n) => `Rs.${Math.round(n).toLocaleString('en-IN')}`
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1)

// ── Styles ───────────────────────────────────────────────────────

const S = {
  page: { minHeight: '100vh', background: '#f7f7f9', fontFamily: 'Arial, sans-serif' },
  header: { background: '#131A48', padding: '0.85rem 1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  logoTxt: { fontFamily: 'Georgia, serif', fontSize: 17, fontWeight: 700, color: '#fff', letterSpacing: '-0.02em' },
  logoSpan: { color: '#FF5800' },
  headerSub: { fontSize: 11, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.07em' },
  main: { maxWidth: 1040, margin: '0 auto', padding: '1.5rem 1rem' },
  section: { background: '#fff', border: '1px solid #CECECE', borderRadius: 6, padding: '1.1rem 1.2rem', marginBottom: '1.1rem', minWidth: 0 },
  sectionTitle: { fontFamily: 'Georgia, serif', fontWeight: 700, fontSize: 14, color: '#131A48', marginBottom: '0.7rem', paddingBottom: 6, borderBottom: '2px solid #FF5800', display: 'inline-block' },
  subTitle: { fontSize: 11, fontWeight: 700, color: '#131A48', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '1rem 0 0.4rem' },
  meta: { fontSize: 11, color: '#888', marginBottom: 4 },
  linkBtn: { background: 'none', border: 'none', color: '#FF5800', fontWeight: 700, fontSize: 12, cursor: 'pointer', padding: 0 },
  removeBtn: { background: 'none', border: 'none', color: '#c0392b', cursor: 'pointer', fontSize: 11, padding: 0 },
  notice: { fontSize: 12, color: '#1e5c2c', background: '#f0faf2', border: '1px solid #b9dfc1', borderRadius: 4, padding: '0.45rem 0.7rem', marginTop: '0.5rem' },
}

// ── Component ────────────────────────────────────────────────────

export default function App() {
  const [rules, setRules] = useState([])
  const [rulesErrors, setRulesErrors] = useState([])
  const [rulesSource, setRulesSource] = useState('')

  const [cartItems, setCartItems] = useState([])
  const [cartErrors, setCartErrors] = useState([])
  const [cartSource, setCartSource] = useState('')
  const [cartNotice, setCartNotice] = useState('')
  const [pdfBusy, setPdfBusy] = useState(false)

  // Engine runs on every change of rules or cart.
  const results = useMemo(() => processCart(cartItems, rules), [cartItems, rules])
  const summary = useMemo(() => applyCartOffer(results, rules), [results, rules])

  // ── Handlers ──

  function loadRules(csvText, name) {
    const { data, errors } = parseRulesCSV(csvText)
    setRules(data)
    setRulesErrors(errors)
    setRulesSource(name)
  }

  function replaceCart(items, errors, name, notice = '') {
    setCartItems(items)
    setCartErrors(errors)
    setCartSource(name)
    setCartNotice(notice)
  }

  function loadCartCSV(csvText, name) {
    const { data, errors } = parseCartCSV(csvText)
    replaceCart(data, errors, name)
  }

  async function loadCartPDF(buffer, name) {
    setPdfBusy(true)
    let parsed
    try {
      // pdf.js is ~400 kB — only download it when someone actually uploads a PDF.
      const { parseCartPDF } = await import('./inputs/pdfCartInput.js')
      parsed = await parseCartPDF(buffer)
    } catch (e) {
      parsed = { items: [], errors: [`The PDF reader failed to load (${e.message}).`], skipped: 0 }
    } finally {
      setPdfBusy(false)
    }
    const { items, errors, skipped } = parsed
    if (items.length === 0) {
      // Nothing usable — keep the current cart rather than wiping it.
      setCartErrors([`${name}: no cart items could be read, so your current cart was kept.`, ...errors])
      setCartNotice('')
      return
    }
    replaceCart(
      items,
      errors,
      name,
      `Cart replaced with ${items.length} item${items.length > 1 ? 's' : ''} from ${name}` +
        (skipped ? ` (${skipped} row${skipped > 1 ? 's' : ''} skipped — see below).` : '.')
    )
  }

  function loadSampleData() {
    loadRules(sampleRules, 'sample-data/rules.csv')
    loadCartCSV(sampleCart, 'sample-data/cart.csv')
  }

  function addRule(rule) {
    setRules((prev) => [...prev, rule])
  }

  function removeRule(ruleId) {
    setRules((prev) => prev.filter((r) => r.ruleId !== ruleId))
  }

  const ruleColumns = [
    { key: 'ruleId', label: 'Rule ID', nowrap: true },
    { key: 'scope', label: 'Scope', render: (v) => cap(v) },
    { key: 'appliesTo', label: 'Applies To', render: (v, r) => (r.scope === 'cart' ? 'Entire cart' : v) },
    {
      key: 'value',
      label: 'Offer',
      render: (v, r) =>
        (r.type === 'percentage' ? `${v}% off` : `${rs(v)} off`) +
        (r.scope === 'cart' ? ` · cart ≥ ${rs(r.minCartValue)}` : ''),
    },
    { key: 'stackable', label: 'Stackable', render: (v) => (v ? 'Yes' : 'No') },
    { key: 'remove', label: '', render: (_, r) => <button style={S.removeBtn} title="Remove rule" onClick={() => removeRule(r.ruleId)}>✕</button> },
  ]

  const cartColumns = [
    { key: 'itemId', label: 'Item' },
    { key: 'product', label: 'Product' },
    { key: 'brand', label: 'Brand' },
    { key: 'platform', label: 'Platform' },
    { key: 'basePrice', label: 'Base Price', render: (v) => rs(v) },
  ]

  // ── Render ──

  return (
    <div style={S.page}>
      <div style={S.header}>
        <div style={S.logoTxt}>O<span style={S.logoSpan}>pp</span>tra</div>
        <div style={S.headerSub}>Discount Engine</div>
      </div>

      <div style={S.main}>
        <div style={{ textAlign: 'right', marginBottom: '0.6rem' }}>
          <button style={S.linkBtn} onClick={loadSampleData}>Load sample rules + cart →</button>
        </div>

        <div className="grid2">
          {/* ── Rules ── */}
          <div style={S.section}>
            <div style={S.sectionTitle}>Discount Rules</div>
            <FileUploader
              label="rules.csv"
              description="Upload your discount rules CSV"
              accept=".csv"
              onLoad={loadRules}
              hasData={!!rulesSource}
              fileName={rulesSource}
            />
            <ErrorBanner errors={rulesErrors} />

            <div style={S.subTitle}>Or describe a rule in plain English</div>
            <RuleComposer rules={rules} cartItems={cartItems} onAdd={addRule} />

            {rules.length > 0 && (
              <>
                <div style={S.subTitle}>Active rules</div>
                <div style={S.meta}>{rules.length} rule{rules.length > 1 ? 's' : ''} active</div>
                <DataTable columns={ruleColumns} rows={rules} />
              </>
            )}
          </div>

          {/* ── Cart ── */}
          <div style={S.section}>
            <div style={S.sectionTitle}>Cart Items</div>
            <div style={{ display: 'grid', gap: '0.5rem' }}>
              <FileUploader
                label="cart.csv"
                description="Upload your cart CSV"
                accept=".csv"
                onLoad={loadCartCSV}
                hasData={!!cartSource && cartSource.toLowerCase().endsWith('.csv')}
                fileName={cartSource}
              />
              <FileUploader
                label="cart.pdf"
                description="Or upload an order PDF (Product, Brand, Platform, Base Price)"
                accept=".pdf,application/pdf"
                readAs="arrayBuffer"
                onLoad={loadCartPDF}
                hasData={!!cartSource && cartSource.toLowerCase().endsWith('.pdf')}
                fileName={cartSource}
                busy={pdfBusy}
              />
            </div>
            {cartNotice && <div style={S.notice}>{cartNotice}</div>}
            <ErrorBanner errors={cartErrors} />
            {cartItems.length > 0 && (
              <div style={{ marginTop: '0.75rem' }}>
                <div style={S.meta}>{cartItems.length} item{cartItems.length > 1 ? 's' : ''} in cart</div>
                <DataTable columns={cartColumns} rows={cartItems} />
              </div>
            )}
          </div>
        </div>

        {/* ── Results ── */}
        <div style={S.section}>
          <div style={S.sectionTitle}>Cart Summary</div>
          {cartItems.length === 0 ? (
            <div style={{ fontSize: 13, color: '#888' }}>
              Load a cart (CSV or PDF) to see prices. Results update automatically as rules and carts change.
            </div>
          ) : (
            <CartSummary results={results} summary={summary} />
          )}
        </div>
      </div>
    </div>
  )
}
