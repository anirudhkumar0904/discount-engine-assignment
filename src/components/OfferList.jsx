/**
 * OfferList.jsx — the active discount rules, removable one by one.
 */

import Icon from './Icon.jsx'
import { describeRule } from '../engine/discountEngine.js'

const rs = (n) => `Rs.${Math.round(n).toLocaleString('en-IN')}`

export default function OfferList({ rules, newIds, onRemove }) {
  if (rules.length === 0) {
    return <div className="empty">No offers yet. Upload a rules CSV or describe one above.</div>
  }
  return (
    <div className="offer-list">
      {rules.map((r) => (
        <div className="offer" key={r.ruleId}>
          <span className={`pill pill-${r.scope}`}>{r.scope}</span>
          <div className="offer-main">
            <div className="offer-name">{describeRule(r)}</div>
            <div className="offer-meta">
              {r.ruleId}
              {r.scope === 'cart' && ` · on carts of ${rs(r.minCartValue)}+`}
              {r.stackable ? ' · stacks with other offers' : ' · best offer wins'}
            </div>
          </div>
          {newIds.has(r.ruleId) && <span className="pill pill-new">new</span>}
          <button className="icon-btn" title={`Remove ${r.ruleId}`} aria-label={`Remove ${r.ruleId}`} onClick={() => onRemove(r.ruleId)}>
            <Icon name="x" size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}
