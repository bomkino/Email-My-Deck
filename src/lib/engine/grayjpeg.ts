/**
 * Baseline JPEG encoder for a single gray channel.
 *
 * Canvas only writes three-channel JPEGs, and a soft mask must be DeviceGray,
 * so without this a photographic gray image (often a 2 MB mask in a Figma
 * export) could only be stored losslessly, several times heavier.
 *
 * Plain baseline: standard luminance table scaled like libjpeg, standard
 * Huffman tables (ITU T.81 Annex K), no restart markers, no JFIF header
 * (PDF's DCTDecode does not need one).
 */

const STANDARD_LUMA = [
  16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62,
  18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99,
]

// Coefficient k of a block in coding order is natural (row-major) index ZIGZAG[k].
const ZIGZAG = [
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28,
  35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63,
]

const DC_BITS = [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0]
const DC_VALUES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
const AC_BITS = [0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d]
const AC_VALUES = [
  0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08,
  0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0, 0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28,
  0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59,
  0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
  0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6,
  0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2,
  0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa,
]

type HuffmanTable = { codes: Uint16Array; lengths: Uint8Array }

/** Canonical Huffman codes for a BITS/HUFFVAL pair, indexed by symbol. */
function huffmanTable(bits: number[], values: number[]): HuffmanTable {
  const codes = new Uint16Array(256)
  const lengths = new Uint8Array(256)
  let code = 0
  let index = 0
  for (let length = 1; length <= 16; length += 1) {
    for (let count = 0; count < bits[length - 1]; count += 1) {
      codes[values[index]] = code
      lengths[values[index]] = length
      code += 1
      index += 1
    }
    code <<= 1
  }
  return { codes, lengths }
}

const DC_TABLE = huffmanTable(DC_BITS, DC_VALUES)
const AC_TABLE = huffmanTable(AC_BITS, AC_VALUES)

/** cos[u * 8 + x] = C(u)/2 · cos((2x + 1)uπ/16), so two passes give the 2-D DCT's 1/4 · C(u)C(v) scale. */
const COS = new Float64Array(64)
for (let u = 0; u < 8; u += 1) {
  for (let x = 0; x < 8; x += 1) COS[u * 8 + x] = (u === 0 ? Math.SQRT1_2 : 1) * 0.5 * Math.cos(((2 * x + 1) * u * Math.PI) / 16)
}

/** libjpeg's quality scaling of the standard luminance table; `quality` is 0–1 like canvas. */
export function grayQuantTable(quality: number): Uint8Array {
  const q = Math.max(1, Math.min(100, Math.round(quality * 100)))
  const scale = q < 50 ? 5000 / q : 200 - q * 2
  return Uint8Array.from(STANDARD_LUMA, (value) => Math.max(1, Math.min(255, Math.floor((value * scale + 50) / 100))))
}

class ByteWriter {
  bytes = new Uint8Array(1 << 16)
  length = 0
  private bitBuffer = 0
  private bitCount = 0

  private ensure(extra: number) {
    if (this.length + extra <= this.bytes.byteLength) return
    let size = this.bytes.byteLength * 2
    while (size < this.length + extra) size *= 2
    const grown = new Uint8Array(size)
    grown.set(this.bytes.subarray(0, this.length))
    this.bytes = grown
  }

  byte(value: number) {
    this.ensure(1)
    this.bytes[this.length++] = value
  }

  word(value: number) {
    this.byte((value >> 8) & 0xff)
    this.byte(value & 0xff)
  }

  array(values: ArrayLike<number>) {
    this.ensure(values.length)
    for (let index = 0; index < values.length; index += 1) this.bytes[this.length++] = values[index]
  }

  /** Append `count` bits (≤ 16) of entropy-coded data, stuffing a zero after every 0xFF. */
  bits(value: number, count: number) {
    this.bitBuffer = (this.bitBuffer << count) | (value & ((1 << count) - 1))
    this.bitCount += count
    while (this.bitCount >= 8) {
      const byte = (this.bitBuffer >> (this.bitCount - 8)) & 0xff
      this.byte(byte)
      if (byte === 0xff) this.byte(0)
      this.bitCount -= 8
    }
    this.bitBuffer &= (1 << this.bitCount) - 1
  }

  /** Pad the last byte with one bits, as the standard asks. */
  flushBits() {
    if (this.bitCount > 0) this.bits(0x7f, 8 - this.bitCount)
  }
}

function category(value: number): number {
  let magnitude = value < 0 ? -value : value
  let size = 0
  while (magnitude) {
    size += 1
    magnitude >>= 1
  }
  return size
}

function writeValue(out: ByteWriter, table: HuffmanTable, symbol: number, size: number, value: number) {
  out.bits(table.codes[symbol], table.lengths[symbol])
  if (size) out.bits(value < 0 ? value + (1 << size) - 1 : value, size)
}

/**
 * Encode `samples` (one byte per pixel, row by row) as a baseline gray JPEG.
 * `quality` is 0–1, matching canvas `convertToBlob`.
 */
export function encodeGrayJpeg(samples: Uint8Array, width: number, height: number, quality: number): Uint8Array {
  if (!(width > 0 && height > 0 && width <= 65535 && height <= 65535)) throw new Error('Gray JPEG size out of range.')
  if (samples.byteLength < width * height) throw new Error('Gray samples are shorter than the image size.')
  const quant = grayQuantTable(quality)
  const out = new ByteWriter()

  out.word(0xffd8)
  // DQT: one 8-bit table, id 0, in zigzag order.
  out.word(0xffdb)
  out.word(67)
  out.byte(0)
  for (let k = 0; k < 64; k += 1) out.byte(quant[ZIGZAG[k]])
  // SOF0: 8-bit samples, one component sampled 1×1 using table 0.
  out.word(0xffc0)
  out.word(11)
  out.byte(8)
  out.word(height)
  out.word(width)
  out.byte(1)
  out.array([1, 0x11, 0])
  // DHT: DC table 0 and AC table 0.
  out.word(0xffc4)
  out.word(2 + 17 + DC_VALUES.length + 17 + AC_VALUES.length)
  out.byte(0x00)
  out.array(DC_BITS)
  out.array(DC_VALUES)
  out.byte(0x10)
  out.array(AC_BITS)
  out.array(AC_VALUES)
  // SOS: the one component, full spectral range.
  out.word(0xffda)
  out.word(8)
  out.array([1, 1, 0x00, 0, 63, 0])

  const block = new Float64Array(64)
  const rows = new Float64Array(64)
  const coefficients = new Int32Array(64)
  let previousDc = 0
  for (let top = 0; top < height; top += 8) {
    for (let left = 0; left < width; left += 8) {
      // Level-shifted samples, repeating the last row and column past the edges.
      for (let y = 0; y < 8; y += 1) {
        const row = Math.min(top + y, height - 1) * width
        for (let x = 0; x < 8; x += 1) block[y * 8 + x] = samples[row + Math.min(left + x, width - 1)] - 128
      }
      for (let y = 0; y < 8; y += 1) {
        for (let u = 0; u < 8; u += 1) {
          let sum = 0
          for (let x = 0; x < 8; x += 1) sum += COS[u * 8 + x] * block[y * 8 + x]
          rows[y * 8 + u] = sum
        }
      }
      for (let v = 0; v < 8; v += 1) {
        for (let u = 0; u < 8; u += 1) {
          let sum = 0
          for (let y = 0; y < 8; y += 1) sum += COS[v * 8 + y] * rows[y * 8 + u]
          coefficients[v * 8 + u] = Math.round(sum / quant[v * 8 + u])
        }
      }

      const dc = coefficients[0]
      const difference = dc - previousDc
      previousDc = dc
      const dcSize = category(difference)
      writeValue(out, DC_TABLE, dcSize, dcSize, difference)

      let run = 0
      for (let k = 1; k < 64; k += 1) {
        const value = coefficients[ZIGZAG[k]]
        if (value === 0) {
          run += 1
          continue
        }
        while (run > 15) {
          out.bits(AC_TABLE.codes[0xf0], AC_TABLE.lengths[0xf0])
          run -= 16
        }
        const size = category(value)
        writeValue(out, AC_TABLE, (run << 4) | size, size, value)
        run = 0
      }
      if (run > 0) out.bits(AC_TABLE.codes[0x00], AC_TABLE.lengths[0x00])
    }
  }
  out.flushBits()
  out.word(0xffd9)
  return out.bytes.slice(0, out.length)
}
