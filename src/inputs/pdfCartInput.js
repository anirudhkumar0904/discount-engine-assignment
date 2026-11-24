/**
 * pdfCartInput.js — input adapter: PDF bytes → CartItem[]
 *
 * Runs entirely in the browser with pdf.js (no server needed). Extracts the
 * positioned text fragments, groups them into lines, and hands them to the
 * pure table parser.
 */

import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { parseCartTable, groupIntoLines } from './cartTableParser.js'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

/**
 * @param {ArrayBuffer} buffer
 * @returns {Promise<{ items, errors, skipped }>}
 */
export async function parseCartPDF(buffer) {
  let doc
  try {
    doc = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise
  } catch (e) {
    return { items: [], errors: [`Could not read this PDF (${e.message}).`], skipped: 0 }
  }

  const lines = []
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p)
      const content = await page.getTextContent()
      const fragments = content.items
        .filter((it) => typeof it.str === 'string' && it.str.trim() !== '')
        .map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width || 0 }))
      lines.push(...groupIntoLines(fragments))
    }
  } catch (e) {
    return { items: [], errors: [`Could not read the text in this PDF (${e.message}).`], skipped: 0 }
  }

  if (lines.length === 0) {
    return {
      items: [],
      errors: ['This PDF has no selectable text (it may be a scanned image). Please upload a text PDF or the CSV.'],
      skipped: 0,
    }
  }

  return parseCartTable(lines)
}
