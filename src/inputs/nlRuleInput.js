/**
 * nlRuleInput.js — input adapter: plain English → DiscountRule (pending confirmation)
 *
 * 1. requestRuleParse() sends the text to /api/parse-rule (LLM, server-side).
 * 2. interpretParsedRule() — pure — decides what the UI should do with the
 *    LLM's answer. The LLM is never trusted directly:
 *      • ambiguous / unsupported answers are surfaced as a question, not a rule
 *      • the candidate goes through the same normaliseRule() as CSV rows
 *      • grounding: the rule's numbers must be ones the user wrote, in the same
 *        unit (% vs Rs.), and every number the user wrote must be used — so a
 *        hallucinated "10%" or a silently dropped "above Rs.4,000" is rejected
 *      • soft warnings (no matching items, duplicate rule) are shown on the
 *        confirmation card but don't block
 */

import { normaliseRule, nextRuleId } from '../engine/ruleSchema.js'

export async function requestRuleParse(text, cartItems, { signal } = {}) {
  const unique = (arr) => [...new Set(arr)]
  // Never leave the user staring at a spinner: give up after 45s.
  const timeout = AbortSignal.timeout(45_000)
  const combined = signal && AbortSignal.any ? AbortSignal.any([signal, timeout]) : signal || timeout

  let res
  try {
    res = await fetch('/api/parse-rule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: combined,
      body: JSON.stringify({
        text,
        context: {
          brands: unique(cartItems.map((i) => i.brand)),
          platforms: unique(cartItems.map((i) => i.platform)),
        },
      }),
    })
  } catch (e) {
    if (signal?.aborted) return { aborted: true }
    if (timeout.aborted) return { error: 'The rule parser took too long to answer. Please try again.' }
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

/**
 * Every number a human wrote, with whether it was written as a percentage.
 * "Rs.5,000" → 5000, "5k" → 5000, "4000rs" → 4000, "20%" / "15percent" → percent.
 */
export function numberMentions(text) {
  const out = []
  const re = /(\d[\d,]*(?:\.\d+)?)(?:\s*(k|lakh|lac)(?![a-z]))?(\s*(?:%|percent\b|per\s*cent\b))?/gi
  let m
  while ((m = re.exec(text)) !== null) {
    let n = parseFloat(m[1].replace(/,/g, ''))
    if (isNaN(n)) continue
    const unit = (m[2] || '').toLowerCase()
    if (unit === 'k') n *= 1000
    if (unit === 'lakh' || unit === 'lac') n *= 100000
    out.push({ n, pct: Boolean(m[3]) })
  }
  return out
}

/** Set of all numbers in the text (kept for callers that only need values). */
export function numbersInText(text) {
  return new Set(numberMentions(text).map((m) => m.n))
}

// Words that imply an order-size condition. If the text has one but the model
// produced a cart rule with no threshold, a condition was lost.
const THRESHOLD_HINT = /\b(big|bigger|large|larger|bulk|above|over|more than|at least|minimum|min|exceeds?|exceeding|spends?|spending|worth|threshold|or more|upwards)\b/i

/**
 * Checks the model's rule against what the user literally wrote.
 * Returns a user-facing question if something doesn't add up, else null.
 */
export function groundingProblem(rule, text) {
  const mentions = numberMentions(text)
  const fmt = (n) => n.toLocaleString('en-IN')

  // 1. The discount value must be a number the user wrote, in the same unit.
  const valueMentions = mentions.filter((m) => m.n === rule.value)
  if (valueMentions.length === 0) {
    return `Your description doesn't state the discount ${fmt(rule.value)} — please write the exact amount as a number (e.g. "10% off" or "Rs.200 off").`
  }
  if (rule.type === 'percentage' && !valueMentions.some((m) => m.pct)) {
    return `${fmt(rule.value)} was read as a percentage, but you didn't write it with a % sign. Please write "${fmt(rule.value)}%" for a percentage or "Rs.${fmt(rule.value)}" for a flat amount.`
  }
  if (rule.type === 'flat' && valueMentions.every((m) => m.pct)) {
    return `You wrote ${fmt(rule.value)}% but it was read as a flat rupee amount. Please rephrase, e.g. "${fmt(rule.value)}% off".`
  }

  // 2. A cart threshold must be stated — or, if it's 0, no size condition may be implied.
  if (rule.scope === 'cart') {
    if (rule.minCartValue > 0 && !mentions.some((m) => m.n === rule.minCartValue && !m.pct)) {
      return `Your description doesn't state the minimum cart value ${fmt(rule.minCartValue)} — please write it as a number (e.g. "on orders above Rs.5,000").`
    }
    if (rule.minCartValue === 0 && THRESHOLD_HINT.test(text)) {
      return 'Your description implies a minimum order size but doesn\'t say how much. Please add the amount, e.g. "on orders above Rs.5,000".'
    }
  }

  // 3. Every number the user wrote must be used — otherwise a condition was dropped.
  const used = new Set([rule.value, rule.minCartValue].filter((v) => v !== null))
  const inName = (n) => (rule.appliesTo || '').includes(String(n))
  const unused = [...new Set(mentions.filter((m) => !used.has(m.n) && !inName(m.n)).map((m) => m.n))]
  if (unused.length > 0) {
    return `Your description also mentions ${unused.map(fmt).join(', ')}, which isn't part of the parsed offer. Each offer can have one target — a brand, a platform, or a minimum cart value — so please split it or rephrase.`
  }
  return null
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

  // Grounding: the rule must match what the user literally wrote.
  const problem = groundingProblem(rule, text)
  if (problem) return { kind: 'clarify', status: 'ambiguous', message: problem }

  const warnings = []
  // Business guardrail: unusually deep discounts are allowed but called out.
  if ((rule.type === 'percentage' && rule.value >= 50) || (rule.type === 'flat' && rule.value > 1000)) {
    const amount = rule.type === 'percentage' ? `${rule.value}%` : `Rs.${rule.value.toLocaleString('en-IN')}`
    warnings.push(`${amount} off is an unusually large discount — please double-check it before confirming.`)
  }
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
