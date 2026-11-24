/**
 * ruleSchema.js
 *
 * The single gate every input path goes through before the engine sees data.
 * CSV rows, LLM-parsed rules and PDF table rows all become plain objects here,
 * and are normalised + validated by the same functions. Adding a new input mode
 * means writing an adapter that produces raw objects and calling these — the
 * discount calculator never changes.
 *
 * Pure functions, no UI, no I/O. Safe to import from the browser or the server.
 */

export const RULE_SCOPES = ['brand', 'platform', 'cart']
export const RULE_TYPES = ['percentage', 'flat']

/** "Rs.1,299" | "₹1,299.00" | "INR 1299" | 1299 → 1299 (NaN if not a price) */
export function parseRupees(raw) {
  if (typeof raw === 'number') return raw
  if (raw === undefined || raw === null) return NaN
  const cleaned = String(raw)
    .trim()
    .replace(/^(rs\.?|inr|₹)\s*/i, '')
    .replace(/,/g, '')
    .trim()
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return NaN
  return parseFloat(cleaned)
}

function parseBool(raw) {
  if (typeof raw === 'boolean') return raw
  const s = String(raw ?? '').trim().toLowerCase()
  if (['true', '1', 'yes', 'y'].includes(s)) return true
  if (['false', '0', 'no', 'n', ''].includes(s)) return false
  return null
}

const isBlank = (v) => v === undefined || v === null || String(v).trim() === ''

/**
 * Normalises a raw rule-like object into a DiscountRule.
 *
 * Accepts camelCase or snake_case keys so CSV rows and LLM output can share it.
 * Returns { rule, errors } — rule is null when errors is non-empty.
 */
export function normaliseRule(raw) {
  const errors = []
  const get = (camel, snake) => (raw[camel] !== undefined ? raw[camel] : raw[snake])

  const ruleId = String(get('ruleId', 'rule_id') ?? '').trim()
  const scope = String(get('scope', 'scope') ?? '').trim().toLowerCase()
  const appliesToRaw = get('appliesTo', 'applies_to')
  const type = String(get('type', 'type') ?? '').trim().toLowerCase()
  const valueRaw = get('value', 'value')
  const stackableRaw = get('stackable', 'stackable')
  const minRaw = get('minCartValue', 'min_cart_value')

  if (!ruleId) errors.push('rule_id is missing')

  if (!RULE_SCOPES.includes(scope)) {
    errors.push(`scope must be one of ${RULE_SCOPES.join(' / ')}, got "${scope || '(empty)'}"`)
  }

  if (!RULE_TYPES.includes(type)) {
    errors.push(`type must be "percentage" or "flat", got "${type || '(empty)'}"`)
  }

  const value = parseRupees(valueRaw)
  if (isNaN(value) || value <= 0) {
    errors.push(`value must be a positive number, got "${valueRaw ?? ''}"`)
  } else if (type === 'percentage' && value > 100) {
    errors.push(`a percentage discount can't exceed 100%, got ${value}%`)
  }

  const stackable = parseBool(stackableRaw)
  if (stackable === null) {
    errors.push(`stackable must be true or false, got "${stackableRaw}"`)
  }

  let appliesTo = isBlank(appliesToRaw) ? null : String(appliesToRaw).trim()
  let minCartValue = null

  if (scope === 'cart') {
    // Cart rules apply to the whole cart — there is no brand/platform target.
    appliesTo = null
    minCartValue = isBlank(minRaw) ? NaN : parseRupees(minRaw)
    if (isNaN(minCartValue) || minCartValue < 0) {
      errors.push(`cart rules need a minimum cart value (0 or more), got "${minRaw ?? ''}"`)
    }
  } else if (scope === 'brand' || scope === 'platform') {
    if (!appliesTo) errors.push(`a ${scope} rule needs applies_to (which ${scope} it is for)`)
    if (!isBlank(minRaw)) {
      errors.push(`min_cart_value only makes sense for cart rules, not ${scope} rules`)
    }
  }

  if (errors.length > 0) return { rule: null, errors }

  return {
    rule: {
      ruleId,
      scope,
      appliesTo,
      type,
      value,
      stackable,
      minCartValue,
    },
    errors: [],
  }
}

/**
 * Normalises a raw cart-item-like object into a CartItem.
 * Returns { item, errors } — item is null when errors is non-empty.
 */
export function normaliseCartItem(raw) {
  const errors = []
  const get = (camel, snake) => (raw[camel] !== undefined ? raw[camel] : raw[snake])
  const text = (v) => (isBlank(v) ? '' : String(v).trim())

  const itemId = text(get('itemId', 'item_id'))
  const product = text(get('product', 'product'))
  const brand = text(get('brand', 'brand'))
  const platform = text(get('platform', 'platform'))
  const priceRaw = get('basePrice', 'base_price')

  const missing = []
  if (!itemId) missing.push('item_id')
  if (!product) missing.push('product')
  if (!brand) missing.push('brand')
  if (!platform) missing.push('platform')
  if (isBlank(priceRaw)) missing.push('base_price')
  if (missing.length > 0) errors.push(`missing ${missing.join(', ')}`)

  const basePrice = parseRupees(priceRaw)
  if (!isBlank(priceRaw) && (isNaN(basePrice) || basePrice <= 0)) {
    errors.push(`base price must be a positive amount, got "${priceRaw}"`)
  }

  if (errors.length > 0) return { item: null, errors }

  return {
    // Prices are whole rupees throughout the engine (matches the expected results).
    item: { itemId, product, brand, platform, basePrice: Math.round(basePrice) },
    errors: [],
  }
}

/** Next free "RULE-NN" id given the rules already loaded. */
export function nextRuleId(rules) {
  const max = rules.reduce((m, r) => {
    const match = /^RULE-(\d+)$/i.exec(r.ruleId)
    return match ? Math.max(m, parseInt(match[1], 10)) : m
  }, 0)
  return `RULE-${String(max + 1).padStart(2, '0')}`
}
