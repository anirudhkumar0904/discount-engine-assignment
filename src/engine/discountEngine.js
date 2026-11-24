/**
 * discountEngine.js
 *
 * Pure discount calculation logic. No UI, no side effects.
 * All functions take plain objects and return plain objects.
 *
 * The engine knows nothing about where rules or cart items came from (CSV,
 * PDF, plain-English via an LLM...). Every input path normalises its data
 * through ruleSchema.js first, then calls processCart + applyCartOffer.
 *
 * Data shapes:
 *
 * DiscountRule {
 *   ruleId:       string       — e.g. "RULE-01"
 *   scope:        "brand" | "platform" | "cart"
 *   appliesTo:    string|null  — e.g. "Natura Casa", "Amazon India"; null for cart rules
 *   type:         "percentage" | "flat"
 *   value:        number       — percentage as integer (15 = 15%), flat in rupees
 *   stackable:    boolean
 *   minCartValue: number|null  — cart rules only: threshold on the sum of final item prices
 * }
 *
 * CartItem {
 *   itemId, product, brand, platform: string
 *   basePrice: number          — whole rupees
 * }
 *
 * DiscountResult {
 *   itemId, product, brand, platform: string
 *   basePrice, finalPrice, totalDiscount: number
 *   appliedRules:  string[]
 *   skippedRules:  string[]
 *   status:        "none" | "applied" | "stacked" | "max"
 *   reasoning:     string   — customer-readable explanation
 * }
 *
 * CartSummary {
 *   subtotal:        number   — sum of item final prices (before cart offer)
 *   cartOffers:      { ruleId, label, saving }[]  — empty when no cart offer triggered
 *   cartDiscount:    number
 *   total:           number   — what the customer pays
 *   itemSavings:     number   — sum of item-level discounts
 *   nextOffer:       { ruleId, label, shortfall } | null — cart offer the customer is close to
 * }
 */

const rupees = (n) => `Rs.${Math.round(n).toLocaleString('en-IN')}`

/**
 * Returns true if an item-level rule applies to this cart item.
 * Cart-scope rules never match a single item — they are handled by applyCartOffer.
 */
export function ruleMatchesItem(item, rule) {
  const normalise = (s) => String(s ?? '').trim().toLowerCase()
  if (rule.scope === 'brand') {
    return normalise(item.brand) === normalise(rule.appliesTo)
  }
  if (rule.scope === 'platform') {
    return normalise(item.platform) === normalise(rule.appliesTo)
  }
  return false
}

/**
 * Calculates the rupee discount a rule gives on a given price.
 * Uses the provided price, not the original base price — important for stacking.
 * A flat discount never exceeds the price it is applied to (no negative prices).
 * All amounts are whole rupees, so the saving shown always equals the price change.
 */
export function calculateDiscountAmount(price, rule) {
  if (price <= 0) return 0
  if (rule.type === 'percentage') {
    return Math.min(price, Math.round((price * rule.value) / 100))
  }
  if (rule.type === 'flat') {
    // Whole rupees, like every other amount the customer sees.
    return Math.min(price, Math.round(rule.value))
  }
  return 0
}

/**
 * Customer-facing name of an offer, e.g. "Amazon India offer: 15% off",
 * "Natura Casa brand offer: Rs.150 off", "Cart offer: 10% off".
 */
export function describeRule(rule) {
  const amount = rule.type === 'percentage' ? `${rule.value}% off` : `${rupees(rule.value)} off`
  if (rule.scope === 'brand') return `${rule.appliesTo} brand offer: ${amount}`
  if (rule.scope === 'platform') return `${rule.appliesTo} offer: ${amount}`
  if (rule.scope === 'cart') return `Cart offer: ${amount}`
  return `Offer: ${amount}`
}

/**
 * Applies the active discount rules to a single cart item.
 * Returns a DiscountResult.
 *
 * Logic:
 *   1. Find all item-level rules that match this item.
 *   2. Among non-stackable rules, pick the one giving the largest rupee saving
 *      on the base price (ties go to the rule listed first).
 *   3. Apply every stackable rule on top of that price, in list order.
 *   4. Build the reasoning string from what was applied and what lost.
 */
export function applyDiscounts(item, rules) {
  const matchingRules = rules.filter((r) => ruleMatchesItem(item, r))

  const base = {
    itemId: item.itemId,
    product: item.product,
    brand: item.brand,
    platform: item.platform,
    basePrice: item.basePrice,
  }

  if (matchingRules.length === 0) {
    return {
      ...base,
      finalPrice: item.basePrice,
      totalDiscount: 0,
      appliedRules: [],
      skippedRules: [],
      status: 'none',
      reasoning: `No offers available — no current offer covers ${item.brand} products on ${item.platform}`,
    }
  }

  const nonStackable = matchingRules.filter((r) => !r.stackable)
  const stackable = matchingRules.filter((r) => r.stackable)

  // Pick the non-stackable rule that gives the largest saving (stable sort → ties keep list order)
  let winner = null
  let skipped = []
  if (nonStackable.length > 0) {
    const sorted = [...nonStackable].sort(
      (a, b) =>
        calculateDiscountAmount(item.basePrice, b) - calculateDiscountAmount(item.basePrice, a)
    )
    winner = sorted[0]
    skipped = sorted.slice(1)
  }

  // Apply winner first, then stack on top
  let price = item.basePrice
  const appliedRules = []
  const parts = []
  let beatOthers = false

  if (winner) {
    const saving = calculateDiscountAmount(price, winner)
    price -= saving
    appliedRules.push(winner.ruleId)
    let text = `${describeRule(winner)} (saves ${rupees(saving)})`
    const worse = skipped.filter((r) => calculateDiscountAmount(item.basePrice, r) < saving)
    const tied = skipped.filter((r) => calculateDiscountAmount(item.basePrice, r) === saving)
    if (worse.length > 0) {
      const losers = worse
        .map((r) => `${describeRule(r)} (would save ${rupees(calculateDiscountAmount(item.basePrice, r))})`)
        .join(', ')
      text += ` — better than ${losers}`
    }
    if (tied.length > 0) {
      text += `${worse.length ? ';' : ' —'} same saving as ${tied.map(describeRule).join(', ')}, so only one applies`
    }
    beatOthers = worse.length > 0
    parts.push(text)
  }

  for (const rule of stackable) {
    const saving = calculateDiscountAmount(price, rule)
    price -= saving
    appliedRules.push(rule.ruleId)
    parts.push(
      `${winner || appliedRules.length > 1 ? 'plus ' : ''}${describeRule(rule)} (saves ${rupees(saving)})`
    )
  }

  const finalPrice = Math.round(price)
  let status = 'applied'
  if (item.basePrice - finalPrice === 0) status = 'none'
  else if (appliedRules.length > 1) status = 'stacked'
  else if (beatOthers) status = 'max'

  return {
    ...base,
    finalPrice,
    totalDiscount: item.basePrice - finalPrice,
    appliedRules,
    skippedRules: skipped.map((r) => r.ruleId),
    status,
    reasoning: parts.join(', '),
  }
}

/**
 * Runs applyDiscounts across every item in the cart.
 * Returns an array of DiscountResult objects.
 */
export function processCart(cartItems, rules) {
  return cartItems.map((item) => applyDiscounts(item, rules))
}

/**
 * Sums the final prices across all results.
 */
export function cartTotal(results) {
  return results.reduce((sum, r) => sum + r.finalPrice, 0)
}

/**
 * Applies cart-level rules AFTER item-level discounts.
 *
 * The threshold is checked against the sum of final item prices. Among eligible
 * non-stackable cart rules the biggest saving wins; stackable cart rules apply
 * on top — the same selection policy as item-level rules.
 *
 * If the customer hasn't unlocked a cart offer that would beat what they have,
 * `nextOffer` says how much more they need to add (a just-below-threshold cart
 * gets a nudge instead of silence).
 */
/**
 * Picks and applies cart rules to a subtotal: best non-stackable rule, then
 * every stackable rule on top (the same policy as item-level rules).
 */
function selectCartOffers(subtotal, eligible) {
  const nonStackable = eligible.filter((r) => !r.stackable)
  const stackable = eligible.filter((r) => r.stackable)
  const winner = [...nonStackable].sort(
    (a, b) => calculateDiscountAmount(subtotal, b) - calculateDiscountAmount(subtotal, a)
  )[0]

  let price = subtotal
  const offers = []
  for (const rule of [winner, ...stackable].filter(Boolean)) {
    const saving = calculateDiscountAmount(price, rule)
    price -= saving
    offers.push({ ruleId: rule.ruleId, label: describeRule(rule), saving })
  }
  return { offers, total: price }
}

export function applyCartOffer(results, rules) {
  const subtotal = cartTotal(results)
  const itemSavings = results.reduce((s, r) => s + r.totalDiscount, 0)
  const cartRules = rules.filter((r) => r.scope === 'cart')

  const eligible = cartRules.filter((r) => subtotal >= r.minCartValue)
  const locked = cartRules.filter((r) => subtotal < r.minCartValue)

  const { offers: cartOffers, total } = selectCartOffers(subtotal, eligible)
  const cartDiscount = subtotal - total

  // Nearest locked offer that would actually add a saving once reached:
  // compare the cart discount at its threshold with and without it.
  let nextOffer = null
  const worthUnlocking = locked
    .filter((r) => {
      const at = r.minCartValue
      const reachable = cartRules.filter((x) => x !== r && at >= x.minCartValue)
      const without = at - selectCartOffers(at, reachable).total
      const withIt = at - selectCartOffers(at, [...reachable, r]).total
      return withIt > without
    })
    .sort((a, b) => a.minCartValue - b.minCartValue)[0]
  if (worthUnlocking) {
    nextOffer = {
      ruleId: worthUnlocking.ruleId,
      label: describeRule(worthUnlocking),
      threshold: worthUnlocking.minCartValue,
      shortfall: worthUnlocking.minCartValue - subtotal,
    }
  }

  return { subtotal, itemSavings, cartOffers, cartDiscount, total, nextOffer }
}
