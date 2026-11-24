/**
 * CartSummary.jsx
 *
 * The customer's checkout: each item with its final price and the offer that
 * produced it, then the order summary (subtotal, cart offer, total) and a
 * progress bar towards the next cart offer.
 */

import Icon from './Icon.jsx'

const rs = (n) => `Rs.${Math.round(n).toLocaleString('en-IN')}`

const STATUS = {
  none: 'No offer',
  applied: 'Discount applied',
  stacked: 'Stacked offers',
  max: 'Best offer picked',
}

const initials = (s) => s.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()

function Item({ r }) {
  const hasOffer = r.totalDiscount > 0
  return (
    <div className="item">
      <div className="thumb">{initials(r.product)}</div>
      <div style={{ minWidth: 0 }}>
        <div className="item-name">{r.product}</div>
        <div className="item-meta">{r.brand} · {r.platform} · {r.itemId}</div>
        <div className={`item-offer${r.status === 'none' ? ' none' : ''}`}>
          <Icon name={r.status === 'none' ? 'info' : 'tag'} size={13} />
          <span>{r.reasoning}</span>
        </div>
      </div>
      <div className="item-price num">
        {hasOffer && <div className="price-was">{rs(r.basePrice)}</div>}
        <div className="price-now">{rs(r.finalPrice)}</div>
        {hasOffer && <div className="item-save">Save {rs(r.totalDiscount)}</div>}
        <div className="status"><span className={`pill status-${r.status}`}>{STATUS[r.status]}</span></div>
      </div>
    </div>
  )
}

function CartOfferProgress({ summary, hasCartRules }) {
  const { subtotal, cartOffers, nextOffer } = summary

  if (nextOffer) {
    const pct = Math.min(100, (subtotal / nextOffer.threshold) * 100)
    return (
      <div className="unlock unlock-locked">
        <div className="unlock-title">Add {rs(nextOffer.shortfall)} more to unlock {nextOffer.label}</div>
        Applies to carts of {rs(nextOffer.threshold)} or more.
        <div className="bar"><div style={{ width: `${pct}%` }} /></div>
        <div className="bar-legend num"><span>{rs(subtotal)}</span><span>{rs(nextOffer.threshold)}</span></div>
      </div>
    )
  }
  if (cartOffers.length > 0) {
    return (
      <div className="unlock unlock-open">
        <div className="unlock-title">Cart offer unlocked</div>
        {cartOffers.map((o) => <div key={o.ruleId}>{o.label} applied to your whole cart.</div>)}
        <div className="bar"><div style={{ width: '100%' }} /></div>
      </div>
    )
  }
  return (
    <div className="unlock unlock-none">
      <div className="unlock-title">No cart-wide offer</div>
      {hasCartRules ? 'No cart offer applies to this cart.' : 'There is no active cart-level offer right now.'}
    </div>
  )
}

export default function CartSummary({ results, summary, hasCartRules }) {
  const { subtotal, cartOffers, total, itemSavings, cartDiscount } = summary
  const baseTotal = results.reduce((s, r) => s + r.basePrice, 0)
  const totalSaved = itemSavings + cartDiscount

  return (
    <div>
      <div className="items">
        {results.map((r) => <Item key={r.itemId} r={r} />)}
      </div>

      <div className="summary">
        <CartOfferProgress summary={summary} hasCartRules={hasCartRules} />

        <div className="lines num">
          <div className="line line-muted"><span>Items ({results.length}) at base price</span><span>{rs(baseTotal)}</span></div>
          {itemSavings > 0 && (
            <div className="line line-green"><span>Item offers</span><span>−{rs(itemSavings)}</span></div>
          )}
          <div className="line"><span>Cart total before cart offer</span><span>{rs(subtotal)}</span></div>
          {cartOffers.map((o) => (
            <div key={o.ruleId} className="line line-green">
              <span>{o.label} — {rs(o.saving)} saved</span><span>−{rs(o.saving)}</span>
            </div>
          ))}
          <div className="line line-total">
            <span className="label">Final cart total</span>
            <span className="value">{rs(total)}</span>
          </div>
          {totalSaved > 0 && <div className="saved-banner">You save {rs(totalSaved)} on this order</div>}
        </div>
      </div>
    </div>
  )
}
