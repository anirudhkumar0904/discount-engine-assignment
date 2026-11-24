/**
 * cartTableParser.js — pure: positioned text lines → CartItem[]
 *
 * Input is what a PDF text extractor gives us: an array of lines, each line an
 * array of { str, x } fragments (left-to-right). Kept free of pdf.js so it can
 * be unit-tested in Node and reused by any other "table-like" source.
 *
 * Strategy
 *   1. Find the header line containing Product / Brand / Platform / Base Price.
 *      Everything above it (order number, date...) is ignored.
 *   2. Use the header's x-positions as column boundaries and bucket each
 *      fragment of a data line into the column it starts under.
 *   3. If that doesn't yield 4 cells (e.g. the PDF drew the whole row as one
 *      monospace string), fall back to splitting the line on 2+ spaces.
 *   4. Every candidate row goes through normaliseCartItem. Bad rows are
 *      reported with their line text and skipped — good rows still load.
 */

import { normaliseCartItem } from '../engine/ruleSchema.js'

const COLUMNS = [
  { key: 'product', match: /^product\b/i },
  { key: 'brand', match: /^brand\b/i },
  { key: 'platform', match: /^platform\b/i },
  { key: 'base_price', match: /^(base\s*)?price\b/i },
]

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
  const raw = line.map((f) => f.str).join('  ')
  return raw.split(/\s{2,}/).map((s) => s.trim()).filter(Boolean)
}

/** Locate the header line and the x where each column starts. */
function findHeader(lines) {
  for (let i = 0; i < lines.length; i++) {
    const text = lineText(lines[i]).toLowerCase()
    if (!(text.includes('product') && text.includes('brand') && text.includes('platform') && text.includes('price'))) {
      continue
    }
    // Try fragment positions first (one fragment per header cell).
    const xs = {}
    for (const frag of lines[i]) {
      const s = frag.str.trim()
      for (const col of COLUMNS) {
        if (xs[col.key] === undefined && col.match.test(s)) xs[col.key] = frag.x
      }
    }
    const hasPositions = COLUMNS.every((c) => xs[c.key] !== undefined)
    return { index: i, xs: hasPositions ? COLUMNS.map((c) => xs[c.key]) : null }
  }
  return null
}

function bucketByColumns(line, xs) {
  const cells = ['', '', '', '']
  const tolerance = 4 // pt — text can start slightly left of its header
  for (const frag of line) {
    let col = 0
    for (let c = 0; c < xs.length; c++) {
      if (frag.x + tolerance >= xs[c]) col = c
    }
    cells[col] = (cells[col] + ' ' + frag.str).trim()
  }
  return cells
}

/**
 * @param {{str: string, x: number}[][]} lines
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

  for (let i = header.index + 1; i < lines.length; i++) {
    const line = lines[i]
    const text = lineText(line)

    // Separator rules (────, ----, ====) and blank lines carry no data.
    if (!/[a-z0-9]/i.test(text)) continue
    // Totals / footers are not items.
    if (/^(sub\s*)?total\b|^grand total\b|^page \d+/i.test(text)) continue
    // Header repeated on a later page.
    if (findHeader([line])) continue

    let cells = header.xs ? bucketByColumns(line, header.xs) : []
    if (cells.filter(Boolean).length < 4) {
      const gapCells = splitOnGaps(line)
      if (gapCells.length === 4) cells = gapCells
    }

    const [product, brand, platform, basePrice] = cells
    const itemId = `ITEM-${String(items.length + 1).padStart(2, '0')}`
    const { item, errors: rowErrors } = normaliseCartItem({
      itemId,
      product,
      brand,
      platform,
      basePrice,
    })

    if (!item) {
      skipped++
      errors.push(`Line "${text}": ${rowErrors.join('; ')} — row skipped`)
      continue
    }
    items.push(item)
  }

  if (items.length === 0 && errors.length === 0) {
    errors.push('Found the table header but no item rows under it.')
  }

  return { items, errors, skipped }
}
