/**
 * nlRuleInput.js — input adapter: plain English → DiscountRule (pending confirmation)
 *
 * 1. requestRuleParse() sends the text to /api/parse-rule (LLM, server-side).
 * 2. interpretParsedRule() — pure — decides what the UI should do with the
 *    LLM's answer. The LLM is never trusted directly:
 *      • ambiguous / unsupported answers are surfaced as a question, not a rule
 *      • the candidate goes through the same normaliseRule() as CSV rows
 *      • grounding: every number in the rule must literally appear in the text,
 *        so a hallucinated "10%" for "a discount for big orders" is rejected
 *      • soft warnings (no matching items, duplicate rule) are shown on the
 *        confirmation card but don't block
 */

import { normaliseRule, nextRuleId } from '../engine/ruleSchema.js'

export async function requestRuleParse(text, cartItems) {
  const unique = (arr) => [...new Set(arr)]
  let res
  try {
    res = await fetch('/api/parse-rule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        context: {
          brands: unique(cartItems.map((i) => i.brand)),
          platforms: unique(cartItems.map((i) => i.platform)),
        },
      }),
    })
  } catch {
    return { error: 'Could not reach the rule parser. Check your connection and try again.' }
  }

  let body
  try {
    body = await res.json()
  } catch {
    return { error: `The rule parser returned an unexpected response (HTTP ${res.status}).` }
  }
  if (!res.ok) return { error: body?.error || `The rule parser failed (HTTP ${res.status}).` }
  return { parsed: body }
}

/** All numbers a human wrote in the text: "Rs.5,000" → 5000, "5k" → 5000, "20%" → 20. */
export function numbersInText(text) {
  const out = new Set()
  const re = /(\d[\d,]*(?:\.\d+)?)\s*(k|lakh|lac)?\b/gi
  let m
  while ((m = re.exec(text)) !== null) {
    let n = parseFloat(m[1].replace(/,/g, ''))
    const unit = (m[2] || '').toLowerCase()
    if (unit === 'k') n *= 1000
    if (unit === 'lakh' || unit === 'lac') n *= 100000
    out.add(n)
  }
  return out
}

const sameRule = (a, b) =>
  a.scope === b.scope &&
  (a.appliesTo || '').toLowerCase() === (b.appliesTo || '').toLowerCase() &&
  a.type === b.type &&
  a.value === b.value &&
  a.stackable === b.stackable &&
  (a.minCartValue ?? null) === (b.minCartValue ?? null)

/**
 * @returns one of
 *   { kind: 'confirm', rule, summary, warnings: string[] }
 *   { kind: 'clarify', message }          — ambiguous / unsupported; ask the user
 *   { kind: 'invalid', errors: string[] } — LLM produced something unusable
 */
export function interpretParsedRule(parsed, text, existingRules, cartItems) {
  if (!parsed || typeof parsed !== 'object') {
    return { kind: 'invalid', errors: ['The parser returned no rule.'] }
  }

  if (parsed.status === 'ambiguous' || parsed.status === 'unsupported') {
    const fallback =
      parsed.status === 'ambiguous'
        ? 'This rule is missing details. Say how much off (e.g. 10% or Rs.200) and who it applies to (a brand, a platform, or a minimum cart value).'
        : "This rule can't be expressed by the engine. It supports brand, platform and minimum-cart-value discounts."
    return { kind: 'clarify', status: parsed.status, message: parsed.message?.trim() || fallback }
  }

  if (parsed.status !== 'ok' || !parsed.rule) {
    return { kind: 'invalid', errors: ['The parser said the rule was fine but returned no rule fields.'] }
  }

  // Same validation as a CSV row.
  const { rule, errors } = normaliseRule({ ...parsed.rule, ruleId: nextRuleId(existingRules) })
  if (!rule) return { kind: 'invalid', errors }

  // Grounding: numbers must come from the user, not the model.
  const stated = numbersInText(text)
  const ungrounded = []
  if (!stated.has(rule.value)) ungrounded.push(`discount value ${rule.value}`)
  if (rule.scope === 'cart' && rule.minCartValue > 0 && !stated.has(rule.minCartValue)) {
    ungrounded.push(`minimum cart value ${rule.minCartValue}`)
  }
  if (ungrounded.length > 0) {
    return {
      kind: 'clarify',
      status: 'ambiguous',
      message: `Your description doesn't state the ${ungrounded.join(' or the ')} — please write the exact amount as a number (e.g. "10% off" or "Rs.5,000").`,
    }
  }

  const warnings = []
  if (rule.scope !== 'cart') {
    const field = rule.scope === 'brand' ? 'brand' : 'platform'
    const hits = cartItems.filter((i) => i[field].toLowerCase() === rule.appliesTo.toLowerCase())
    if (cartItems.length > 0 && hits.length === 0) {
      warnings.push(
        `No item in the current cart is from ${field} "${rule.appliesTo}", so this rule won't change today's prices.`
      )
    }
  }
  const dup = existingRules.find((r) => sameRule(r, rule))
  if (dup) warnings.push(`This is identical to ${dup.ruleId}, which is already active.`)

  return { kind: 'confirm', rule, summary: parsed.message || '', warnings }
}
