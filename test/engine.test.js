import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { processCart, applyCartOffer, applyDiscounts } from '../src/engine/discountEngine.js'
import { parseRulesCSV, parseCartCSV } from '../src/inputs/csvInput.js'

const rules = parseRulesCSV(readFileSync('sample-data/rules.csv', 'utf8'))
const cart = parseCartCSV(readFileSync('sample-data/cart.csv', 'utf8'))

test('sample CSVs load with no errors', () => {
  assert.deepEqual(rules.errors, [])
  assert.deepEqual(cart.errors, [])
  assert.equal(rules.data.length, 4)
  assert.equal(cart.data.length, 6)
})

test('item-level results match the brief', () => {
  const results = processCart(cart.data, rules.data)
  const byId = Object.fromEntries(results.map((r) => [r.itemId, r]))
  const expected = {
    'ITEM-01': [1104, 'max', ['RULE-01'], ['RULE-02']],
    'ITEM-02': [629, 'stacked', ['RULE-02', 'RULE-03'], []],
    'ITEM-03': [509, 'applied', ['RULE-01'], []],
    'ITEM-04': [2499, 'none', [], []],
    'ITEM-05': [382, 'applied', ['RULE-01'], []],
    'ITEM-06': [809, 'applied', ['RULE-03'], []],
  }
  for (const [id, [price, status, applied, skipped]] of Object.entries(expected)) {
    assert.equal(byId[id].finalPrice, price, `${id} final price`)
    assert.equal(byId[id].status, status, `${id} status`)
    assert.deepEqual(byId[id].appliedRules, applied, `${id} applied`)
    assert.deepEqual(byId[id].skippedRules, skipped, `${id} skipped`)
  }
  assert.match(byId['ITEM-01'].reasoning, /Amazon India offer: 15% off \(saves Rs\.195\) — better than Natura Casa brand offer: Rs\.150 off \(would save Rs\.150\)$/)
  assert.match(byId['ITEM-04'].reasoning, /^No offers available/)
})

test('cart offer: Rs.5,932 → −Rs.593 → Rs.5,339', () => {
  const s = applyCartOffer(processCart(cart.data, rules.data), rules.data)
  assert.equal(s.subtotal, 5932)
  assert.equal(s.cartOffers.length, 1)
  assert.equal(s.cartOffers[0].ruleId, 'RULE-04')
  assert.equal(s.cartOffers[0].saving, 593)
  assert.equal(s.total, 5339)
  assert.equal(s.nextOffer, null)
})

test('cart just below threshold: no cart offer row, shows how much is missing', () => {
  const below = parseCartCSV(readFileSync('sample-data/cart-below-threshold.csv', 'utf8')).data
  const s = applyCartOffer(processCart(below, rules.data), rules.data)
  assert.equal(s.subtotal, 1104 + 2499 + 382) // 3985
  assert.equal(s.cartOffers.length, 0)
  assert.equal(s.total, 3985)
  assert.equal(s.nextOffer.ruleId, 'RULE-04')
  assert.equal(s.nextOffer.shortfall, 15)
})

test('cart exactly at threshold triggers the offer (≥, not >)', () => {
  const r = [{ ruleId: 'C', scope: 'cart', appliesTo: null, type: 'percentage', value: 10, stackable: false, minCartValue: 4000 }]
  const s = applyCartOffer([{ finalPrice: 4000, totalDiscount: 0 }], r)
  assert.equal(s.total, 3600)
})

test('flat discount never makes a price negative', () => {
  const item = { itemId: 'X', product: 'Pen', brand: 'B', platform: 'P', basePrice: 100 }
  const res = applyDiscounts(item, [
    { ruleId: 'R', scope: 'brand', appliesTo: 'B', type: 'flat', value: 150, stackable: false, minCartValue: null },
  ])
  assert.equal(res.finalPrice, 0)
  assert.equal(res.totalDiscount, 100)
})

test('stackable rule applies on its own when no non-stackable rule matches', () => {
  const item = { itemId: 'X', product: 'Desk', brand: 'Nordic Basics', platform: 'Flipkart', basePrice: 899 }
  const res = applyDiscounts(item, rules.data)
  assert.equal(res.finalPrice, 809)
  assert.doesNotMatch(res.reasoning, /^plus/)
})

test('a newly added stackable brand rule stacks on the winner and updates reasoning', () => {
  const extra = { ruleId: 'RULE-05', scope: 'brand', appliesTo: 'Natura Casa', type: 'percentage', value: 20, stackable: true, minCartValue: null }
  const res = applyDiscounts(cart.data[0], [...rules.data, extra]) // Cushion Cover, Amazon India
  // 1299 → RULE-01 −195 = 1104 → RULE-05 −221 = 883
  assert.equal(res.finalPrice, 883)
  assert.deepEqual(res.appliedRules, ['RULE-01', 'RULE-05'])
  assert.match(res.reasoning, /plus Natura Casa brand offer: 20% off \(saves Rs\.221\)/)
})
