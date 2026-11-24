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

/** Returns { data: DiscountRule[], errors: string[] } */
export function parseRulesCSV(csvText) {
  const { rows, fatal } = readRows(csvText)
  if (fatal.length > 0) return { data: [], errors: fatal }

  const data = []
  const errors = []
  const seen = new Set()

  rows.forEach((row, i) => {
    const rowNum = i + 2 // account for header row
    const { rule, errors: rowErrors } = normaliseRule(row)
    if (!rule) {
      errors.push(`Row ${rowNum}: ${rowErrors.join('; ')}`)
      return
    }
    if (seen.has(rule.ruleId)) {
      errors.push(`Row ${rowNum}: duplicate rule_id "${rule.ruleId}" — skipped`)
      return
    }
    seen.add(rule.ruleId)
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

  rows.forEach((row, i) => {
    const rowNum = i + 2
    const { item, errors: rowErrors } = normaliseCartItem(row)
    if (!item) {
      errors.push(`Row ${rowNum}: ${rowErrors.join('; ')}`)
      return
    }
    data.push(item)
  })

  return { data, errors }
}
