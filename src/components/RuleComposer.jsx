/**
 * RuleComposer.jsx
 *
 * Plain-English rule input → LLM parse → confirmation card → onAdd(rule).
 * Nothing is added to the active rules until the user presses Confirm.
 */

import { useState } from 'react'
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

const S = {
  textarea: {
    width: '100%', minHeight: 56, resize: 'vertical', padding: '0.55rem 0.7rem', fontSize: 13,
    border: '1px solid #CECECE', borderRadius: 4, fontFamily: 'inherit', boxSizing: 'border-box',
  },
  chip: {
    fontSize: 11, border: '1px solid #CECECE', background: '#fff', borderRadius: 20,
    padding: '2px 9px', cursor: 'pointer', color: '#131A48',
  },
  btn: (primary, disabled) => ({
    background: disabled ? '#CECECE' : primary ? '#FF5800' : '#fff',
    color: primary || disabled ? '#fff' : '#131A48',
    border: primary || disabled ? 'none' : '1px solid #131A48',
    borderRadius: 4, padding: '0.45rem 1.1rem', fontSize: 12, fontWeight: 700,
    cursor: disabled ? 'not-allowed' : 'pointer', letterSpacing: '0.03em',
  }),
  card: (border, bg) => ({
    border: `1px solid ${border}`, borderLeft: `3px solid ${border}`, background: bg,
    borderRadius: 4, padding: '0.7rem 0.9rem', marginTop: '0.7rem', fontSize: 12, color: '#131A48',
  }),
  fieldGrid: { display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '3px 14px', margin: '0.5rem 0' },
  fieldKey: { color: '#666', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em', paddingTop: 1 },
}

function ruleFields(rule) {
  const rows = [
    ['Rule ID', rule.ruleId],
    ['Scope', cap(rule.scope)],
  ]
  if (rule.scope !== 'cart') rows.push(['Applies to', rule.appliesTo])
  rows.push(['Type', cap(rule.type)])
  rows.push(['Value', rule.type === 'percentage' ? `${rule.value}%` : rs(rule.value)])
  if (rule.scope === 'cart') rows.push(['Min cart value', rs(rule.minCartValue)])
  rows.push(['Stackable', rule.stackable ? 'Yes' : 'No'])
  return rows
}

export default function RuleComposer({ rules, cartItems, onAdd }) {
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(false)
  const [outcome, setOutcome] = useState(null) // { kind, ... } from interpretParsedRule, or { kind: 'error' }
  const [submittedText, setSubmittedText] = useState('')

  async function handleParse() {
    const input = text.trim()
    if (!input || loading) return
    setLoading(true)
    setOutcome(null)
    setSubmittedText(input)
    const { parsed, error } = await requestRuleParse(input, cartItems)
    setLoading(false)
    if (error) return setOutcome({ kind: 'error', message: error })
    setOutcome(interpretParsedRule(parsed, input, rules, cartItems))
  }

  function handleConfirm() {
    onAdd(outcome.rule)
    setOutcome(null)
    setText('')
  }

  // Preview the effect on the current cart before committing.
  let preview = null
  if (outcome?.kind === 'confirm' && cartItems.length > 0) {
    const before = applyCartOffer(processCart(cartItems, rules), rules).total
    const withRule = [...rules, outcome.rule]
    const after = applyCartOffer(processCart(cartItems, withRule), withRule).total
    preview = { before, after }
  }

  return (
    <div>
      <textarea
        style={S.textarea}
        placeholder='Describe a discount, e.g. "15% off all Nordic Basics products"'
        value={text}
        maxLength={500}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleParse()
        }}
      />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, margin: '0.4rem 0 0.6rem' }}>
        {EXAMPLES.map((ex) => (
          <button key={ex} type="button" style={S.chip} onClick={() => { setText(ex); setOutcome(null) }}>
            {ex}
          </button>
        ))}
      </div>
      <button style={S.btn(true, !text.trim() || loading)} disabled={!text.trim() || loading} onClick={handleParse}>
        {loading ? 'Reading rule…' : 'Parse rule'}
      </button>

      {outcome?.kind === 'error' && (
        <div style={S.card('#c0392b', '#fce8e8')}>
          <strong>Couldn't parse the rule.</strong> {outcome.message}
        </div>
      )}

      {outcome?.kind === 'invalid' && (
        <div style={S.card('#c0392b', '#fce8e8')}>
          <strong>The parsed rule failed validation, so it was not added:</strong>
          <ul style={{ margin: '4px 0 0 1rem', padding: 0 }}>
            {outcome.errors.map((e) => <li key={e}>{e}</li>)}
          </ul>
          <div style={{ marginTop: 4 }}>Try rewording the description.</div>
        </div>
      )}

      {outcome?.kind === 'clarify' && (
        <div style={S.card('#b9770e', '#fff8e6')}>
          <strong>{outcome.status === 'unsupported' ? 'Not supported' : 'Need more detail'}</strong>
          <div style={{ color: '#666', fontStyle: 'italic', margin: '2px 0 4px' }}>“{submittedText}”</div>
          {outcome.message}
        </div>
      )}

      {outcome?.kind === 'confirm' && (
        <div style={S.card('#1e5c2c', '#f0faf2')}>
          <strong>Confirm this rule?</strong>
          {outcome.summary && <div style={{ marginTop: 2 }}>{outcome.summary}</div>}
          <div style={S.fieldGrid}>
            {ruleFields(outcome.rule).map(([k, v]) => (
              <div key={k} style={{ display: 'contents' }}>
                <span style={S.fieldKey}>{k}</span>
                <span style={{ fontWeight: 600 }}>{v}</span>
              </div>
            ))}
          </div>
          {outcome.warnings.map((w) => (
            <div key={w} style={{ color: '#8a5a00', marginBottom: 3 }}>⚠ {w}</div>
          ))}
          {preview && (
            <div style={{ margin: '4px 0 8px' }}>
              Cart total if added: {rs(preview.before)} → <strong>{rs(preview.after)}</strong>
              {preview.after === preview.before && ' (no change)'}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={S.btn(true, false)} onClick={handleConfirm}>Confirm &amp; add</button>
            <button style={S.btn(false, false)} onClick={() => setOutcome(null)}>Discard</button>
          </div>
        </div>
      )}
    </div>
  )
}
