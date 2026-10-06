import { mkdir, writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import jpeg from 'jpeg-js'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

const corpusDir = new URL('../corpus/', import.meta.url)
await mkdir(corpusDir, { recursive: true })

function drawDeckPage(page, title, index, accent = rgb(.09, .41, 1)) {
  const { width, height } = page.getSize()
  page.drawText(title, { x: 60, y: height - 100, size: 34, color: rgb(.06, .07, .09) })
  page.drawText(`Synthetic test slide ${String(index + 1).padStart(2, '0')}`, { x: 60, y: height - 135, size: 13, color: rgb(.35, .38, .43) })
  page.drawRectangle({ x: 60, y: 70, width: width - 120, height: 5, color: accent })
}

async function vectorDeck() {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  for (let i = 0; i < 8; i += 1) {
    const page = pdf.addPage([1280, 720])
    drawDeckPage(page, 'A clean vector deck', i)
    for (let row = 0; row < 5; row += 1) {
      page.drawText(`A readable line of body copy with a useful number ${row + 1}.`, { x: 100, y: 470 - row * 52, size: 21, font, color: rgb(.17, .19, .23) })
      page.drawCircle({ x: 68, y: 477 - row * 52, size: 7, color: rgb(.09, .41, 1) })
    }
  }
  return pdf.save({ useObjectStreams: true })
}

function makeJpeg(width, height, seed) {
  const data = Buffer.alloc(width * height * 4)
  let state = seed >>> 0
  for (let i = 0; i < data.length; i += 4) {
    state = (1664525 * state + 1013904223) >>> 0
    const noise = state & 255
    const x = (i / 4) % width
    const y = Math.floor(i / 4 / width)
    data[i] = (noise + x / width * 100) & 255
    data[i + 1] = (noise + y / height * 130) & 255
    data[i + 2] = (noise + seed) & 255
    data[i + 3] = 255
  }
  return jpeg.encode({ data, width, height }, 90).data
}

async function imageDeck(pageCount, name) {
  const pdf = await PDFDocument.create()
  for (let i = 0; i < pageCount; i += 1) {
    const imageBytes = makeJpeg(1400, 850, pageCount * 97 + i * 7919)
    const image = await pdf.embedJpg(imageBytes)
    const page = pdf.addPage([1400, 850])
    page.drawImage(image, { x: 0, y: 0, width: 1400, height: 850 })
    page.drawRectangle({ x: 44, y: 44, width: 410, height: 76, color: rgb(0, 0, 0), opacity: .72 })
    page.drawText(`${name} · ${String(i + 1).padStart(2, '0')}`, { x: 65, y: 77, size: 22, color: rgb(1, 1, 1) })
  }
  return pdf.save({ useObjectStreams: true })
}

await writeFile(new URL('vector-deck.pdf', corpusDir), await vectorDeck())
await writeFile(new URL('photo-deck.pdf', corpusDir), await imageDeck(8, 'Photo deck'))
await writeFile(new URL('email-pressure-test.pdf', corpusDir), await imageDeck(24, 'Email pressure test'))
await writeFile(new URL('README.md', corpusDir), `# Synthetic corpus\n\nGenerated locally with \`scripts/generate-corpus.mjs\`. These files contain no user data and exist to exercise size, text, image, and split paths. They are fixtures, not a claim that the compressor is ready for every real deck.\n`)

console.log('Synthetic corpus written to corpus/')
