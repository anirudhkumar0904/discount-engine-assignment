/**
 * cartTableParser.js — pure: positioned text lines → CartItem[]
 *
 * Input is what a PDF text extractor gives us: an array of lines, each line an
 * array of { str, x, w? } fragments (left-to-right). Kept free of pdf.js so it
 * can be unit-tested in Node and reused by any other "table-like" source.
 *
 * Strategy
 *   1. Find the header line containing Product / Brand / Platform / Price.
 *      Everything above it (order number, date...) is ignored. Extra columns
 *      (Qty, S.No, HSN...) are recognised as columns and their values ignored.
 *   2. Use the header cells' x-positions as column boundaries and bucket each
 *      fragment of a data line into the column it starts under.
 *   3. If that doesn't fill every column (e.g. the PDF drew the whole row as
 *      one monospace string), fall back to splitting on runs of 2+ spaces.
 *   4. Every candidate row goes through normaliseCartItem. Rows that fail are
 *      reported with their text and skipped — never guessed — except:
 *        • a line with only a product name continues the previous item's name
 *          (wrapped text), and
 *        • footer lines (totals, taxes, "thank you") are ignored silently.
 */

import { normaliseCartItem } from '../engine/ruleSchema.js'

const REQUIRED = ['product', 'brand', 'platform', 'base_price']
const FOOTER = /\b(total|sub\s*total|thank|page \d|gst|tax|shipping|delivery|amount payable|payable|invoice|signature|terms|grand)\b/i

/** Groups text fragments that share a baseline (within a couple of points) into lines. */
export function groupIntoLines(fragments) {
  const sorted = [...fragments].sort((a, b) => b.y - a.y || a.x - b.x)
  const lines = []
  for (const f of sorted) {
    const line = lines.find((l) => Math.abs(l.y - f.y) <= 2)
    if (line) line.items.push(f)
    else lines.push({ y: f.y, items: [f] })
  }
  return lines.map((l) => l.items.sort((a, b) => a.x - b.x))
}

const lineText = (line) => line.map((f) => f.str).join(' ').replace(/\s+/g, ' ').trim()

/** Split a line into cells purely on runs of 2+ spaces (monospace layouts). */
function splitOnGaps(line) {
  return line
    .map((f) => f.str)
    .join('  ')
    .split(/\s{2,}/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** Which required column a header label is, or null for columns we ignore. */
function classify(label, allLabels) {
  const l = label.toLowerCase().trim()
  if (/^product\b|^item\s*name\b|^description\b/.test(l)) return 'product'
  if (/^brand\b/.test(l)) return 'brand'
  if (/^platform\b|^marketplace\b|^channel\b/.test(l)) return 'platform'
  if (/base\s*price/.test(l)) return 'base_price'
  // Accept a plain "Price"/"MRP" column only when there is no explicit Base Price.
  const hasBase = allLabels.some((x) => /base\s*price/i.test(x))
  if (!hasBase && /^(price|mrp|unit\s*price)\b/.test(l)) return 'base_price'
  return null
}

/** Merge header fragments that belong to one cell ("Base" + "Price"). */
function headerGroups(line) {
  const groups = []
  for (const f of line) {
    const prev = groups[groups.length - 1]
    const prevEnd = prev ? prev.x + (prev.w || prev.str.length * 5.5) : -Infinity
    if (prev && f.x - prevEnd < 8) {
      prev.str = `${prev.str} ${f.str}`.trim()
      prev.w = f.x + (f.w || f.str.length * 5.5) - prev.x
    } else {
      groups.push({ str: f.str.trim(), x: f.x, w: f.w || 0 })
    }
  }
  return groups.filter((g) => g.str)
}

/**
 * Locate the header line. Returns { index, columns: [{ key, x }], labels } where
 * `columns` has x-positions when the header cells are separate fragments, and
 * `labels` (the cell keys in order) is used for the gap-splitting fallback.
 */
function findHeader(lines) {
  for (let i = 0; i < lines.length; i++) {
    const text = lineText(lines[i]).toLowerCase()
    if (!(text.includes('product') && text.includes('brand') && text.includes('platform') && text.includes('price'))) {
      continue
    }
    // Positional header: one fragment (or a few adjacent ones) per cell.
    const groups = headerGroups(lines[i])
    const gLabels = groups.map((g) => g.str)
    const columns = groups.map((g) => ({ key: classify(g.str, gLabels), x: g.x }))
    const positional = REQUIRED.every((k) => columns.some((c) => c.key === k))

    // Monospace header: the whole row is one string — split on wide gaps.
    const gapLabels = splitOnGaps(lines[i])
    const labels = gapLabels.map((l) => classify(l, gapLabels))

    return { index: i, columns: positional ? columns : null, labels }
  }
  return null
}

function bucketByColumns(line, columns) {
  const cells = columns.map(() => '')
  const tolerance = 4 // pt — text can start slightly left of its header
  for (const frag of line) {
    let col = 0
    for (let c = 0; c < columns.length; c++) {
      if (frag.x + tolerance >= columns[c].x) col = c
    }
    cells[col] = (cells[col] + ' ' + frag.str).trim()
  }
  const out = {}
  columns.forEach((c, i) => {
    if (c.key) out[c.key] = cells[i]
  })
  return out
}

function byLabels(line, labels) {
  const parts = splitOnGaps(line)
  if (parts.length !== labels.length) return null
  const out = {}
  labels.forEach((k, i) => {
    if (k) out[k] = parts[i]
  })
  return out
}

const filled = (cells) => cells && REQUIRED.every((k) => cells[k])

/**
 * @param {{str: string, x: number, w?: number}[][]} lines
 * @returns {{ items: CartItem[], errors: string[], skipped: number }}
 *   errors are row-level messages; a fatal problem (no header / no rows)
 *   is returned as an error with items = [].
 */
export function parseCartTable(lines) {
  const header = findHeader(lines)
  if (!header) {
    return {
      items: [],
      errors: ['Could not find the table header (Product, Brand, Platform, Base Price) in this PDF.'],
      skipped: 0,
    }
  }

  const items = []
  const errors = []
  let skipped = 0
  let lastLineWasItem = false

  for (let i = header.index + 1; i < lines.length; i++) {
    const line = lines[i]
    const text = lineText(line)

    // Separator rules (────, ----, ====) and blank lines carry no data.
    if (!/[a-z0-9]/i.test(text)) continue
    // Header repeated on a later page.
    if (findHeader([line])) {
      lastLineWasItem = false
      continue
    }

    let cells = header.columns ? bucketByColumns(line, header.columns) : null
    if (!filled(cells)) cells = byLabels(line, header.labels) || cells || {}

    const { item, errors: rowErrors } = normaliseCartItem({
      itemId: `ITEM-${String(items.length + 1).padStart(2, '0')}`,
      product: cells.product,
      brand: cells.brand,
      platform: cells.platform,
      basePrice: cells.base_price,
    })

    if (item) {
      items.push(item)
      lastLineWasItem = true
      continue
    }

    // A wrapped product name: only the product column has text, right after an item.
    const onlyProduct = cells.product && !cells.brand && !cells.platform && !cells.base_price
    if (onlyProduct && lastLineWasItem && !FOOTER.test(text)) {
      const prev = items[items.length - 1]
      prev.product = `${prev.product} ${cells.product}`.trim()
      continue
    }

    lastLineWasItem = false
    // Totals, taxes, "thank you" lines etc. are not items and not errors.
    if (FOOTER.test(text)) continue

    skipped++
    errors.push(`Line "${text}": ${rowErrors.join('; ')} — row skipped`)
  }

  if (items.length === 0 && errors.length === 0) {
    errors.push('Found the table header but no item rows under it.')
  }

  return { items, errors, skipped }
}
