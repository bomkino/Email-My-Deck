import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import jpeg from 'jpeg-js'
import { PDFDocument, PDFName, StandardFonts, rgb } from 'pdf-lib'

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

// A photo-like picture: smooth gradients and a little grain, so it compresses
// like a real photo (the noise images below barely compress at all).
function makePhoto(width, height, seed) {
  const data = Buffer.alloc(width * height * 4)
  let state = seed >>> 0
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      state = (1664525 * state + 1013904223) >>> 0
      const grain = ((state >>> 24) - 128) / 12
      const i = (y * width + x) * 4
      data[i] = Math.max(0, Math.min(255, 120 + 90 * Math.sin((x + seed) / 140) + 30 * Math.cos(y / 61) + grain))
      data[i + 1] = Math.max(0, Math.min(255, 110 + 80 * Math.cos((y + seed) / 170) + 25 * Math.sin((x + y) / 97) + grain))
      data[i + 2] = Math.max(0, Math.min(255, 140 + 70 * Math.sin((x - y + seed) / 210) + grain))
      data[i + 3] = 255
    }
  }
  return jpeg.encode({ data, width, height }, 95).data
}

// Camera-sized photos on 1280×720 slides, as Keynote and PowerPoint export them.
async function photoDeck(pageCount, name) {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.HelveticaBold)
  for (let i = 0; i < pageCount; i += 1) {
    const image = await pdf.embedJpg(makePhoto(3600, 2025, 7919 * (i + 1)))
    const page = pdf.addPage([1280, 720])
    page.drawImage(image, { x: 0, y: 0, width: 1280, height: 720 })
    page.drawText(`${name} · ${String(i + 1).padStart(2, '0')}`, { x: 60, y: 60, size: 28, font, color: rgb(1, 1, 1) })
  }
  return pdf.save({ useObjectStreams: true })
}

// Every page shares one resource dictionary that lists every picture, as
// LibreOffice exports do. A split must still give each part only its own images.
async function sharedResourcesDeck(pageCount) {
  const pdf = await PDFDocument.create()
  const images = []
  for (let i = 0; i < pageCount; i += 1) images.push(await pdf.embedJpg(makePhoto(2400, 1350, 104729 * (i + 1))))
  const shared = pdf.context.register(pdf.context.obj({ XObject: Object.fromEntries(images.map((image, i) => [`Im${i}`, image.ref])) }))
  images.forEach((_, i) => {
    const page = pdf.addPage([1280, 720])
    page.node.set(PDFName.of('Resources'), shared)
    page.node.set(PDFName.of('Contents'), pdf.context.register(pdf.context.stream(`q 1280 0 0 720 0 0 cm /Im${i} Do Q`)))
  })
  return pdf.save()
}

// The photo deck plus one form field, so it is too big to pass through untouched.
async function formsDeck(source) {
  const pdf = await PDFDocument.load(source)
  pdf.getForm().createTextField('name').addToPage(pdf.getPage(0), { x: 60, y: 300, width: 400, height: 40 })
  return pdf.save({ useObjectStreams: true })
}

// Opens without a password but forbids changes: must be refused as "restricted", not "password".
async function restrictedDeck(source) {
  const require = createRequire(import.meta.url)
  const entry = require.resolve('@neslinesli93/qpdf-wasm')
  const qpdf = await require('@neslinesli93/qpdf-wasm')({ locateFile: () => join(dirname(entry), 'qpdf.wasm') })
  qpdf.FS.writeFile('/in.pdf', source)
  const code = qpdf.callMain(['--encrypt', '', 'owner-only', '256', '--modify=none', '--extract=n', '--', '/in.pdf', '/out.pdf'])
  if (code !== 0) throw new Error(`QPDF could not encrypt the restricted fixture (exit ${code}).`)
  return qpdf.FS.readFile('/out.pdf')
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

const photos = await photoDeck(10, 'Photo deck')
await writeFile(new URL('vector-deck.pdf', corpusDir), await vectorDeck())
await writeFile(new URL('photo-deck.pdf', corpusDir), photos)
await writeFile(new URL('shared-resources-deck.pdf', corpusDir), await sharedResourcesDeck(12))
await writeFile(new URL('email-pressure-test.pdf', corpusDir), await imageDeck(24, 'Email pressure test'))
await writeFile(new URL('forms-deck.pdf', corpusDir), await formsDeck(photos))
await writeFile(new URL('restricted-deck.pdf', corpusDir), await restrictedDeck(photos))
await writeFile(new URL('README.md', corpusDir), `# Synthetic corpus

Generated locally with \`scripts/generate-corpus.mjs\`. These files contain no user data. They are fixtures, not a claim that the compressor is ready for every real deck.

| File | Exercises |
| --- | --- |
| vector-deck.pdf | Already fits: returned untouched |
| photo-deck.pdf | Camera-sized photos on 1280×720 slides: resized to screen size in one file |
| shared-resources-deck.pdf | LibreOffice-style shared resources: images handled once, split parts carry only their own images |
| email-pressure-test.pdf | Noise images that cannot compress: measured split |
| forms-deck.pdf | The photo deck plus a form field: refused as protected |
| restricted-deck.pdf | The photo deck, opening without a password but forbidding changes: refused as restricted |
`)

console.log('Synthetic corpus written to corpus/')
