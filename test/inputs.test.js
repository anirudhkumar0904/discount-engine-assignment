import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { parseRulesCSV } from '../src/inputs/csvInput.js'
import { parseCartTable, groupIntoLines } from '../src/inputs/cartTableParser.js'
import { interpretParsedRule, numbersInText } from '../src/inputs/nlRuleInput.js'

const rules = parseRulesCSV(readFileSync('sample-data/rules.csv', 'utf8')).data
const cart = [
  { itemId: 'ITEM-01', product: 'Cushion Cover', brand: 'Natura Casa', platform: 'Amazon India', basePrice: 1299 },
  { itemId: 'ITEM-02', product: 'Desk Organiser', brand: 'Nordic Basics', platform: 'Flipkart', basePrice: 899 },
]

// ── CSV validation ──────────────────────────────────────────────

test('rules CSV: bad rows are reported, good rows still load', () => {
  const csv = `rule_id,scope,applies_to,type,value,stackable,min_cart_value
R1,brand,Acme,percentage,150,false,
R2,cart,,flat,100,false,
R3,platform,,flat,50,false,
R4,brand,Acme,percentage,10,maybe,
R5,brand,Acme,flat,50,false,
R5,brand,Acme,flat,60,false,`
  const { data, errors } = parseRulesCSV(csv)
  assert.deepEqual(data.map((r) => r.ruleId), ['R5'])
  assert.equal(errors.length, 5)
  assert.match(errors[0], /can't exceed 100%/)
  assert.match(errors[1], /minimum cart value/)
  assert.match(errors[2], /needs applies_to/)
  assert.match(errors[3], /stackable must be true or false/)
  assert.match(errors[4], /duplicate rule_id/)
})

// ── PDF table parsing ───────────────────────────────────────────

async function pdfLines(path) {
  const doc = await getDocument({ data: new Uint8Array(readFileSync(path)), verbosity: 0 }).promise
  const lines = []
  for (let p = 1; p <= doc.numPages; p++) {
    const content = await (await doc.getPage(p)).getTextContent()
    const frags = content.items
      .filter((it) => it.str && it.str.trim())
      .map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width || 0 }))
    lines.push(...groupIntoLines(frags))
  }
  return lines
}

const EXPECTED_CART = [
  ['Cushion Cover', 'Natura Casa', 'Amazon India', 1299],
  ['Bed Sheet Set', 'Natura Casa', 'Flipkart', 849],
  ['Wall Shelf', 'LivSpace Pro', 'Amazon India', 599],
  ['Ceramic Vase', 'LivSpace Pro', 'Noon', 2499],
  ['Cutting Board', 'Nordic Basics', 'Amazon India', 449],
  ['Desk Organiser', 'Nordic Basics', 'Flipkart', 899],
]
const asRows = (items) => items.map((i) => [i.product, i.brand, i.platform, i.basePrice])

test('PDF: clean table → 6 CartItems matching the brief', async () => {
  const { items, errors } = parseCartTable(await pdfLines('sample-data/cart.pdf'))
  assert.deepEqual(errors, [])
  assert.deepEqual(asRows(items), EXPECTED_CART)
  assert.deepEqual(items.map((i) => i.itemId), ['ITEM-01', 'ITEM-02', 'ITEM-03', 'ITEM-04', 'ITEM-05', 'ITEM-06'])
})

test('PDF: monospace single-string rows parse the same', async () => {
  const { items, errors } = parseCartTable(await pdfLines('sample-data/cart-monospace.pdf'))
  assert.deepEqual(errors, [])
  assert.deepEqual(asRows(items), EXPECTED_CART)
})

test('PDF: malformed rows are skipped with a reason; footer total ignored', async () => {
  const { items, errors, skipped } = parseCartTable(await pdfLines('sample-data/cart-malformed.pdf'))
  assert.deepEqual(asRows(items), [EXPECTED_CART[0], EXPECTED_CART[4], EXPECTED_CART[5]])
  assert.equal(skipped, 3)
  assert.match(errors[0], /Bed Sheet Set.*missing base_price/)
  assert.match(errors[1], /Wall Shelf.*base price must be at least Rs.1, got "Rs.TBD"/)
  assert.match(errors[2], /Ceramic Vase.*missing brand/)
})

test('PDF: no header → fatal error, no items', () => {
  const { items, errors } = parseCartTable([[{ str: 'Hello world', x: 0 }]])
  assert.equal(items.length, 0)
  assert.match(errors[0], /table header/)
})

// ── LLM output interpretation (no network) ──────────────────────

test('numbersInText understands Rs., commas, k', () => {
  assert.deepEqual([...numbersInText('10% off over Rs.5,000 or 2k')], [10, 5000, 2000])
})

test('NL: valid stackable brand rule → confirm with next rule id', () => {
  const text = '20% off for Natura Casa brand, stackable with other offers'
  const out = interpretParsedRule(
    { status: 'ok', message: '20% off Natura Casa, stacks.', rule: { scope: 'brand', appliesTo: 'Natura Casa', type: 'percentage', value: 20, stackable: true, minCartValue: null } },
    text, rules, cart
  )
  assert.equal(out.kind, 'confirm')
  assert.equal(out.rule.ruleId, 'RULE-05')
  assert.deepEqual(out.warnings, [])
})

test('NL: cart rule with threshold → confirm', () => {
  const out = interpretParsedRule(
    { status: 'ok', message: '', rule: { scope: 'cart', appliesTo: null, type: 'percentage', value: 10, stackable: false, minCartValue: 5000 } },
    '10% off if cart value is more than Rs.5,000', rules, cart
  )
  assert.equal(out.kind, 'confirm')
  assert.equal(out.rule.minCartValue, 5000)
})

test('NL: ambiguous status is surfaced as a question', () => {
  const out = interpretParsedRule(
    { status: 'ambiguous', rule: null, message: 'How much off, and above what cart value?' },
    'Give a discount for big orders', rules, cart
  )
  assert.equal(out.kind, 'clarify')
  assert.match(out.message, /How much off/)
})

test('NL: hallucinated numbers are rejected even if the model says ok', () => {
  const out = interpretParsedRule(
    { status: 'ok', message: '', rule: { scope: 'cart', appliesTo: null, type: 'percentage', value: 10, stackable: false, minCartValue: 5000 } },
    'Give a discount for big orders', rules, cart
  )
  assert.equal(out.kind, 'clarify')
  assert.match(out.message, /doesn.t state the discount 10/)
})

test('NL: invalid rule from the model fails the shared validator', () => {
  const out = interpretParsedRule(
    { status: 'ok', message: '', rule: { scope: 'brand', appliesTo: null, type: 'percentage', value: 120, stackable: false, minCartValue: null } },
    '120% off', rules, cart
  )
  assert.equal(out.kind, 'invalid')
  assert.ok(out.errors.some((e) => /exceed 100%/.test(e)))
  assert.ok(out.errors.some((e) => /needs applies_to/.test(e)))
})

test('NL: rule for a brand not in the cart, or a duplicate, warns but can be confirmed', () => {
  const out = interpretParsedRule(
    { status: 'ok', message: '', rule: { scope: 'platform', appliesTo: 'Amazon India', type: 'percentage', value: 15, stackable: false, minCartValue: null } },
    '15% off on Amazon India', rules, cart
  )
  assert.equal(out.kind, 'confirm')
  assert.match(out.warnings[0], /identical to RULE-01/)

  const out2 = interpretParsedRule(
    { status: 'ok', message: '', rule: { scope: 'brand', appliesTo: 'Acme', type: 'flat', value: 100, stackable: false, minCartValue: null } },
    'Rs.100 off Acme', rules, cart
  )
  assert.match(out2.warnings[0], /No item in the current cart/)
})

test('NL: garbage from the parser does not crash', () => {
  assert.equal(interpretParsedRule(null, 'x', rules, cart).kind, 'invalid')
  assert.equal(interpretParsedRule({ status: 'ok', rule: null }, 'x', rules, cart).kind, 'invalid')
})
