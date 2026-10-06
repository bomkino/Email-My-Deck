/**
 * Small JPEG helpers. We only read marker segments; pixel decoding is left to
 * the browser.
 */

export type JpegInfo = {
  width: number
  height: number
  components: number
  /** Estimated libjpeg-style quality (1–100) from the luma quantisation table. */
  quality: number | null
}

const STANDARD_LUMA = [
  16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62,
  18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99,
]

// DQT tables are stored in zigzag order: entry k belongs to natural index ZIGZAG[k].
const ZIGZAG = [
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28,
  35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63,
]

function isSof(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
}

export function readJpegInfo(bytes: Uint8Array): JpegInfo | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null
  let index = 2
  let quality: number | null = null
  while (index + 4 <= bytes.byteLength) {
    if (bytes[index] !== 0xff) return null
    const marker = bytes[index + 1]
    if (marker === 0xff) {
      index += 1
      continue
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      index += 2
      continue
    }
    const length = (bytes[index + 2] << 8) | bytes[index + 3]
    if (length < 2) return null
    const body = index + 4
    if (marker === 0xdb && quality === null) quality = lumaQuality(bytes, body, index + 2 + length)
    if (isSof(marker)) {
      const height = (bytes[body + 1] << 8) | bytes[body + 2]
      const width = (bytes[body + 3] << 8) | bytes[body + 4]
      return { width, height, components: bytes[body + 5], quality }
    }
    if (marker === 0xda || marker === 0xd9) return null
    index += 2 + length
  }
  return null
}

function lumaQuality(bytes: Uint8Array, start: number, end: number): number | null {
  let index = start
  while (index < end) {
    const precisionAndId = bytes[index]
    const precision = precisionAndId >> 4
    const id = precisionAndId & 0x0f
    const size = precision ? 128 : 64
    if (id === 0) {
      let ratioSum = 0
      for (let position = 0; position < 64; position += 1) {
        const value = precision ? (bytes[index + 1 + position * 2] << 8) | bytes[index + 2 + position * 2] : bytes[index + 1 + position]
        ratioSum += value / STANDARD_LUMA[ZIGZAG[position]]
      }
      const scale = (ratioSum / 64) * 100
      if (scale <= 0) return 100
      const quality = scale <= 100 ? (200 - scale) / 2 : 5000 / scale
      return Math.max(1, Math.min(100, Math.round(quality)))
    }
    index += 1 + size
  }
  return null
}

/**
 * Remove EXIF/XMP (APP1) and ICC (APP2) segments. PDF viewers ignore both
 * inside an image stream: the PDF's own /ColorSpace and sample order apply.
 * Browsers would otherwise rotate by EXIF orientation or convert colours,
 * so stripping keeps the decoded pixels identical to what viewers show.
 */
export function stripJpegMetadata(bytes: Uint8Array): Uint8Array {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return bytes
  const keep: Array<[number, number]> = [[0, 2]]
  let index = 2
  let stripped = false
  while (index + 4 <= bytes.byteLength) {
    if (bytes[index] !== 0xff) break
    const marker = bytes[index + 1]
    if (marker === 0xda) break
    const length = (bytes[index + 2] << 8) | bytes[index + 3]
    if (marker === 0xe1 || marker === 0xe2) {
      stripped = true
    } else {
      keep.push([index, index + 2 + length])
    }
    index += 2 + length
  }
  if (!stripped) return bytes
  keep.push([index, bytes.byteLength])
  const total = keep.reduce((sum, [start, end]) => sum + end - start, 0)
  const output = new Uint8Array(total)
  let offset = 0
  for (const [start, end] of keep) {
    output.set(bytes.subarray(start, end), offset)
    offset += end - start
  }
  return output
}
