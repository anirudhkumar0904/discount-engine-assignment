/**
 * csvInput.js — input adapter: CSV text → DiscountRule[] / CartItem[]
 *
 * Uses papaparse for the CSV itself, then hands every row to the shared
 * normalisers in engine/ruleSchema.js. Bad rows are reported and skipped;
 * good rows still load.
 *
 * rules.csv: rule_id, scope, applies_to, type, value, stackable[, min_cart_value]
 * cart.csv:  item_id, product, brand, platform, base_price
 */

import Papa from 'papaparse'
import { normaliseRule, normaliseCartItem } from '../engine/ruleSchema.js'

function readRows(csvText) {
  const { data, errors } = Papa.parse(csvText.trim(), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, '_'),
  })
  // Field-count mismatches are row-level problems we report ourselves; anything else is fatal.
  const fatal = errors.filter((e) => e.type !== 'FieldMismatch')
  return { rows: data, fatal: fatal.map((e) => e.message) }
}

/**
 * A row with more cells than headers is almost always an unquoted comma
 * ("1,299" → "1" and "299"). Loading it would silently use the wrong value.
 */
function extraColumnsError(row) {
  const extra = row.__parsed_extra
  if (!extra || extra.every((v) => String(v).trim() === '')) return null
  return `has ${extra.length} more column${extra.length > 1 ? 's' : ''} than the header — if a value contains a comma (e.g. 1,299), wrap it in quotes or remove the comma`
}

/** Returns { data: DiscountRule[], errors: string[] } */
export function parseRulesCSV(csvText) {
  const { rows, fatal } = readRows(csvText)
  if (fatal.length > 0) return { data: [], errors: fatal }

  const data = []
  const errors = []
  const seen = new Set()

  rows.forEach((row, i) => {
    const rowNum = i + 2 // account for header row
    const extra = extraColumnsError(row)
    if (extra) {
      errors.push(`Row ${rowNum}: ${extra}`)
      return
    }
    const { rule, errors: rowErrors } = normaliseRule(row)
    if (!rule) {
      errors.push(`Row ${rowNum}: ${rowErrors.join('; ')}`)
      return
    }
    const key = rule.ruleId.toUpperCase()
    if (seen.has(key)) {
      errors.push(`Row ${rowNum}: duplicate rule_id "${rule.ruleId}" — skipped`)
      return
    }
    seen.add(key)
    data.push(rule)
  })

  return { data, errors }
}

/** Returns { data: CartItem[], errors: string[] } */
export function parseCartCSV(csvText) {
  const { rows, fatal } = readRows(csvText)
  if (fatal.length > 0) return { data: [], errors: fatal }

  const data = []
  const errors = []
  const seen = new Set()

  rows.forEach((row, i) => {
    const rowNum = i + 2
    const extra = extraColumnsError(row)
    if (extra) {
      errors.push(`Row ${rowNum}: ${extra}`)
      return
    }
    const { item, errors: rowErrors } = normaliseCartItem(row)
    if (!item) {
      errors.push(`Row ${rowNum}: ${rowErrors.join('; ')}`)
      return
    }
    const key = item.itemId.toUpperCase()
    if (seen.has(key)) {
      errors.push(`Row ${rowNum}: duplicate item_id "${item.itemId}" — skipped`)
      return
    }
    seen.add(key)
    data.push(item)
  })

  return { data, errors }
}
