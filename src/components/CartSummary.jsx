/**
 * CartSummary.jsx
 *
 * Customer-facing checkout view: per-item final price + offer explanation,
 * then subtotal, cart offer row (only when triggered), and final total.
 */

import DataTable from './DataTable.jsx'

const rs = (n) => `Rs.${Math.round(n).toLocaleString('en-IN')}`

const STATUS = {
  none: { text: 'No offer', color: '#666', bg: '#eee' },
  applied: { text: 'Discount applied', color: '#1e5c2c', bg: '#e3f4e6' },
  stacked: { text: 'Stacked', color: '#1d3f9a', bg: '#e4ebfb' },
  max: { text: 'Max discount', color: '#8a5a00', bg: '#fff1d6' },
}

const tag = ({ color, bg }) => ({
  display: 'inline-block', fontSize: 10, fontWeight: 700, padding: '2px 7px', whiteSpace: 'nowrap',
  borderRadius: 20, background: bg, color, textTransform: 'uppercase', letterSpacing: '0.04em',
})

const COLUMNS = [
  { key: 'itemId', label: 'Item', nowrap: true },
  { key: 'product', label: 'Product', render: (v, r) => (
    <div>{v}<div style={{ fontSize: 10, color: '#888' }}>{r.brand} · {r.platform}</div></div>
  ) },
  { key: 'basePrice', label: 'Base Price', render: (v) => rs(v) },
  {
    key: 'finalPrice',
    label: 'Final Price',
    render: (v, row) => (
      <span style={{ fontWeight: 700, color: row.totalDiscount > 0 ? '#1e5c2c' : '#131A48' }}>{rs(v)}</span>
    ),
  },
  {
    key: 'totalDiscount',
    label: 'You Save',
    render: (v) => (v > 0 ? <span style={{ color: '#1e5c2c', fontWeight: 600 }}>{rs(v)}</span> : <span style={{ color: '#888' }}>—</span>),
  },
  {
    key: 'reasoning',
    label: 'Offer Applied',
    render: (v, row) => (
      <span style={{ color: row.status === 'none' ? '#888' : '#131A48', fontStyle: row.status === 'none' ? 'italic' : 'normal' }}>
        {v}
      </span>
    ),
  },
  { key: 'status', label: 'Status', render: (v) => <span style={tag(STATUS[v])}>{STATUS[v].text}</span> },
]

const row = { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '1rem', padding: '0.35rem 0' }

export default function CartSummary({ results, summary }) {
  const { subtotal, cartOffers, total, itemSavings, cartDiscount, nextOffer } = summary
  const totalSaved = itemSavings + cartDiscount

  return (
    <div>
      <DataTable columns={COLUMNS} rows={results} />

      <div style={{ marginLeft: 'auto', maxWidth: 420, marginTop: '0.9rem', fontSize: 13, color: '#131A48' }}>
        <div style={row}>
          <span>Cart total before cart offer</span>
          <span style={{ fontWeight: 600 }}>{rs(subtotal)}</span>
        </div>

        {cartOffers.map((o) => (
          <div key={o.ruleId} style={{ ...row, color: '#1e5c2c' }}>
            <span>{o.label} — {rs(o.saving)} saved</span>
            <span style={{ fontWeight: 700 }}>−{rs(o.saving)}</span>
          </div>
        ))}

        {nextOffer && (
          <div style={{ ...row, background: '#fff8e6', border: '1px dashed #e0b450', borderRadius: 4, padding: '0.4rem 0.6rem', margin: '0.2rem 0', fontSize: 12 }}>
            <span>
              Add <strong>{rs(nextOffer.shortfall)}</strong> more to unlock <strong>{nextOffer.label}</strong>{' '}
              (on carts of {rs(nextOffer.threshold)}+)
            </span>
          </div>
        )}

        <div style={{ ...row, borderTop: '2px solid #131A48', marginTop: '0.3rem', paddingTop: '0.6rem' }}>
          <span style={{ fontWeight: 700, fontSize: 14 }}>Final Cart Total</span>
          <span style={{ fontWeight: 700, fontSize: 18 }}>{rs(total)}</span>
        </div>
        {totalSaved > 0 && (
          <div style={{ textAlign: 'right', fontSize: 12, color: '#1e5c2c', fontWeight: 600 }}>
            You save {rs(totalSaved)} on this order
          </div>
        )}
      </div>
    </div>
  )
}
