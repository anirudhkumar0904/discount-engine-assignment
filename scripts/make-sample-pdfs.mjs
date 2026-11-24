// Generates the sample cart PDFs in sample-data/. Run: npm run sample-pdfs
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { writeFileSync } from 'node:fs'

const ROWS = [
  ['Cushion Cover', 'Natura Casa', 'Amazon India', 'Rs.1,299'],
  ['Bed Sheet Set', 'Natura Casa', 'Flipkart', 'Rs.849'],
  ['Wall Shelf', 'LivSpace Pro', 'Amazon India', 'Rs.599'],
  ['Ceramic Vase', 'LivSpace Pro', 'Noon', 'Rs.2,499'],
  ['Cutting Board', 'Nordic Basics', 'Amazon India', 'Rs.449'],
  ['Desk Organiser', 'Nordic Basics', 'Flipkart', 'Rs.899'],
]
const HEADER = ['Product', 'Brand', 'Platform', 'Base Price']
const COLS = [50, 190, 310, 430]

// Table drawn cell by cell (how most generated invoices look).
async function tablePdf(file, rows, footer) {
  const doc = await PDFDocument.create()
  const page = doc.addPage([595, 842])
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  let y = 780
  page.drawText('Order #OP-9921  |  Date: 15 Jan 2025', { x: 50, y, size: 11, font })
  y -= 36
  HEADER.forEach((h, i) => page.drawText(h, { x: COLS[i], y, size: 10, font: bold }))
  y -= 8
  page.drawLine({ start: { x: 50, y }, end: { x: 520, y }, thickness: 0.8, color: rgb(0.3, 0.3, 0.3) })
  y -= 18
  for (const r of rows) {
    r.forEach((c, i) => c && page.drawText(c, { x: COLS[i], y, size: 10, font }))
    y -= 18
  }
  if (footer) page.drawText(footer, { x: 50, y: y - 10, size: 10, font: bold })
  writeFileSync(file, await doc.save())
}

// Whole rows as single monospace strings (like a printed/plain-text order).
async function monospacePdf(file) {
  const doc = await PDFDocument.create()
  const page = doc.addPage([595, 842])
  const font = await doc.embedFont(StandardFonts.Courier)
  const pad = (cells) => cells.map((c, i) => (i < 3 ? c.padEnd(18) : c)).join('')
  const lines = ['Order #OP-9921  |  Date: 15 Jan 2025', '', pad(HEADER), '-'.repeat(66), ...ROWS.map(pad)]
  lines.forEach((l, i) => page.drawText(l, { x: 40, y: 780 - i * 16, size: 9, font }))
  writeFileSync(file, await doc.save())
}


// A realistic invoice: extra S.No/Qty columns, a wrapped product name,
// "Rs.x/-" prices and footer lines — none of which should break parsing.
async function messyInvoicePdf(file) {
  const doc = await PDFDocument.create()
  const page = doc.addPage([595, 842])
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const X = [40, 75, 215, 315, 415, 470]
  const H = ['S.No', 'Product', 'Brand', 'Platform', 'Qty', 'Base Price']
  let y = 790
  page.drawText('TAX INVOICE  |  Order #OP-9922  |  16 Jan 2025', { x: 40, y, size: 11, font: bold })
  y -= 34
  H.forEach((h, i) => page.drawText(h, { x: X[i], y, size: 10, font: bold }))
  y -= 8
  page.drawLine({ start: { x: 40, y }, end: { x: 540, y }, thickness: 0.8 })
  y -= 18
  const rows = [
    ['1', 'Cushion Cover', 'Natura Casa', 'Amazon India', '1', 'Rs.1,299/-'],
    ['2', 'Bed Sheet Set (King,', 'Natura Casa', 'Flipkart', '1', 'Rs.849/-'],
    ['', 'Cotton)', '', '', '', ''],
    ['3', 'Ceramic Vase', 'LivSpace Pro', 'Noon', '1', 'Rs.2,499/-'],
  ]
  for (const r of rows) {
    r.forEach((c, i) => c && page.drawText(c, { x: X[i], y, size: 10, font }))
    y -= 18
  }
  y -= 6
  page.drawText('Order Total: Rs.4,647/-', { x: 315, y, size: 10, font: bold })
  page.drawText('GST included where applicable', { x: 40, y: y - 18, size: 9, font })
  page.drawText('Thank you for shopping with us!', { x: 40, y: y - 34, size: 9, font })
  writeFileSync(file, await doc.save())
}

await tablePdf('sample-data/cart.pdf', ROWS)
await tablePdf(
  'sample-data/cart-malformed.pdf',
  [
    ROWS[0],
    ['Bed Sheet Set', 'Natura Casa', 'Flipkart', ''],          // missing price
    ['Wall Shelf', 'LivSpace Pro', 'Amazon India', 'Rs.TBD'],  // non-numeric price
    ['Ceramic Vase', '', 'Noon', 'Rs.2,499'],                  // missing brand
    ROWS[4],
    ROWS[5],
  ],
  'Total  Rs.5,594'
)
await monospacePdf('sample-data/cart-monospace.pdf')
await messyInvoicePdf('sample-data/cart-invoice.pdf')
console.log('wrote sample-data/cart.pdf, cart-malformed.pdf, cart-monospace.pdf, cart-invoice.pdf')
