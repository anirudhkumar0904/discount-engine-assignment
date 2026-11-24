/**
 * RuleComposer.jsx
 *
 * Plain-English rule input → LLM parse → confirmation card → onAdd(rule).
 * Nothing is added to the active rules until the user presses Confirm.
 */

import { useEffect, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import { requestRuleParse, interpretParsedRule } from '../inputs/nlRuleInput.js'
import { processCart, applyCartOffer } from '../engine/discountEngine.js'

const EXAMPLES = [
  '20% off for Natura Casa brand, stackable with other offers',
  'Rs.100 flat discount on all Flipkart items',
  '10% off if cart value is more than Rs.5,000',
  'Give a discount for big orders',
]

const rs = (n) => `Rs.${Math.round(n).toLocaleString('en-IN')}`
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1)

function ruleFields(rule) {
  const rows = [['Scope', cap(rule.scope)]]
  rows.push(rule.scope === 'cart' ? ['Applies to', 'Entire cart'] : ['Applies to', rule.appliesTo])
  rows.push(['Type', cap(rule.type)])
  rows.push(['Value', rule.type === 'percentage' ? `${rule.value}% off` : `${rs(rule.value)} off`])
  if (rule.scope === 'cart') rows.push(['Min cart value', rs(rule.minCartValue)])
  rows.push(['Stackable', rule.stackable ? 'Yes' : 'No'])
  rows.push(['Rule ID', rule.ruleId])
  return rows
}

export default function RuleComposer({ rules, cartItems, onAdd }) {
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(false)
  const [outcome, setOutcome] = useState(null)
  const [submittedText, setSubmittedText] = useState('')
  const inFlight = useRef(null) // AbortController of the request in progress

  // Always interpret a reply against the rules/cart as they are NOW, not as they
  // were when the request started.
  const latest = useRef({ rules, cartItems })
  latest.current = { rules, cartItems }

  function cancelInFlight() {
    inFlight.current?.abort()
    inFlight.current = null
    setLoading(false)
  }

  // Offers or cart changed (upload, reset, removal): a pending card would be
  // stale (rule ID, warnings, preview), so drop it and any request in flight.
  useEffect(() => {
    cancelInFlight()
    setOutcome(null)
  }, [rules, cartItems])

  useEffect(() => () => inFlight.current?.abort(), [])

  async function handleParse() {
    const input = text.trim()
    if (!input || loading) return
    const controller = new AbortController()
    inFlight.current = controller
    setLoading(true)
    setOutcome(null)
    setSubmittedText(input)

    const { parsed, error, aborted } = await requestRuleParse(input, latest.current.cartItems, {
      signal: controller.signal,
    })
    if (aborted || inFlight.current !== controller) return // superseded
    inFlight.current = null
    setLoading(false)
    if (error) return setOutcome({ kind: 'error', message: error })
    setOutcome(interpretParsedRule(parsed, input, latest.current.rules, latest.current.cartItems))
  }

  function handleConfirm() {
    onAdd(outcome.rule)
    setOutcome(null)
    if (text.trim() === submittedText) setText('')
  }

  function pickExample(ex) {
    cancelInFlight()
    setText(ex)
    setOutcome(null)
  }

  let preview = null
  if (outcome?.kind === 'confirm' && cartItems.length > 0) {
    const before = applyCartOffer(processCart(cartItems, rules), rules).total
    const withRule = [...rules, outcome.rule]
    const after = applyCartOffer(processCart(cartItems, withRule), withRule).total
    preview = { before, after }
  }

  return (
    <div>
      <div className="composer">
        <textarea
          placeholder='e.g. "15% off all Nordic Basics products"'
          value={text}
          maxLength={500}
          aria-label="Describe a discount rule"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleParse() }
          }}
        />
        <div className="composer-foot">
          <span className="composer-hint">Press Enter to parse</span>
          <button className="btn btn-primary btn-sm" disabled={!text.trim() || loading} onClick={handleParse}>
            {loading ? <><span className="spinner" /> Reading…</> : <><Icon name="sparkle" size={14} /> Parse offer</>}
          </button>
        </div>
      </div>

      <div className="chips">
        {EXAMPLES.map((ex) => (
          <button key={ex} type="button" className="chip" onClick={() => pickExample(ex)}>
            {ex}
          </button>
        ))}
      </div>

      {outcome?.kind === 'error' && (
        <div className="alert alert-error">
          <div className="alert-title">Couldn't parse that offer</div>
          {outcome.message}
        </div>
      )}

      {outcome?.kind === 'invalid' && (
        <div className="alert alert-error">
          <div className="alert-title">The parsed offer failed validation, so it wasn't added</div>
          <ul>{outcome.errors.map((e) => <li key={e}>{e}</li>)}</ul>
        </div>
      )}

      {outcome?.kind === 'clarify' && (
        <div className="alert alert-warn">
          <div className="alert-title">{outcome.status === 'unsupported' ? "This offer can't be expressed yet" : 'Need a bit more detail'}</div>
          <div style={{ opacity: 0.75, fontStyle: 'italic', marginBottom: 3 }}>“{submittedText}”</div>
          {outcome.message}
        </div>
      )}

      {outcome?.kind === 'confirm' && (
        <div className="confirm">
          <div className="confirm-head">
            <div className="confirm-title">Add this offer?</div>
            {outcome.summary && <div className="confirm-summary">{outcome.summary}</div>}
          </div>
          <div className="confirm-body">
            <dl className="fields">
              {ruleFields(outcome.rule).map(([k, v]) => (
                <div className="field" key={k}><dt>{k}</dt><dd>{v}</dd></div>
              ))}
            </dl>
            {outcome.warnings.map((w) => (
              <div key={w} className="alert alert-warn" style={{ marginTop: 0, marginBottom: '0.6rem' }}>{w}</div>
            ))}
            {preview && (
              <div className="impact num">
                <span>Cart total</span>
                <span>
                  {rs(preview.before)} → <strong>{rs(preview.after)}</strong>
                  {preview.after === preview.before && ' (no change)'}
                </span>
              </div>
            )}
            <div className="confirm-actions">
              <button className="btn btn-primary" onClick={handleConfirm}><Icon name="check" size={14} /> Confirm &amp; add</button>
              <button className="btn btn-secondary" onClick={() => setOutcome(null)}>Discard</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
