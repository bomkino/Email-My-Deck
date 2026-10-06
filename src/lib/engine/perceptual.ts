/**
 * How clearly a re-saved slide still reads, compared with the sharp render.
 *
 * Both are compared as luminance at screen size (see `COMPARE_PX` in
 * flatten.ts), block by block (8×8, structural similarity). Flat background
 * says nothing about clarity, so blocks count by how much contrast they hold
 * in the sharp render: an edge of text counts far more than paper grain. The
 * worst-hit blocks then pull the score down, so a slide whose small print
 * goes soft scores low even when everything else on it survives.
 */

const BLOCK = 8
const C1 = (0.01 * 255) ** 2
const C2 = (0.03 * 255) ** 2
/** Blocks whose sharp render varies less than this (luminance variance) are flat and don't count. */
const DETAIL_VARIANCE = 16
/** Share of the slide's detail, worst blocks first, averaged into the second half of the score. */
const WORST_SHARE = 0.05

/** Luminance (BT.601) of RGBA pixels, one byte per pixel. */
export function luminance(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): Uint8Array {
  const count = width * height
  const luma = new Uint8Array(count)
  for (let pixel = 0, offset = 0; pixel < count; pixel += 1, offset += 4) {
    luma[pixel] = (rgba[offset] * 77 + rgba[offset + 1] * 150 + rgba[offset + 2] * 29 + 128) >> 8
  }
  return luma
}

/** Per output pixel along one axis: the first input pixel and its weights (a triangle filter, widened when shrinking). */
function axisWeights(from: number, to: number): { start: Int32Array; weights: Float32Array[] } {
  const scale = to / from
  const support = scale < 1 ? 1 / scale : 1
  const start = new Int32Array(to)
  const weights: Float32Array[] = []
  for (let out = 0; out < to; out += 1) {
    const center = (out + 0.5) / scale - 0.5
    const first = Math.max(0, Math.ceil(center - support))
    const last = Math.min(from - 1, Math.floor(center + support))
    const row = new Float32Array(Math.max(1, last - first + 1))
    let sum = 0
    for (let index = first; index <= last; index += 1) {
      const weight = Math.max(0, 1 - Math.abs(index - center) / support)
      row[index - first] = weight
      sum += weight
    }
    if (sum > 0) for (let index = 0; index < row.length; index += 1) row[index] /= sum
    else row[0] = 1
    start[out] = Math.min(first, from - 1)
    weights.push(row)
  }
  return { start, weights }
}

/** Resize one-byte-per-pixel luminance, the way a viewer scales a picture to fit the screen. */
export function resample(source: Uint8Array, width: number, height: number, toWidth: number, toHeight: number): Uint8Array {
  if (width === toWidth && height === toHeight) return source
  const across = axisWeights(width, toWidth)
  const down = axisWeights(height, toHeight)
  const middle = new Float32Array(toWidth * height)
  for (let y = 0; y < height; y += 1) {
    const row = y * width
    for (let x = 0; x < toWidth; x += 1) {
      const weights = across.weights[x]
      const first = row + across.start[x]
      let value = 0
      for (let index = 0; index < weights.length; index += 1) value += source[first + index] * weights[index]
      middle[y * toWidth + x] = value
    }
  }
  const out = new Uint8Array(toWidth * toHeight)
  for (let y = 0; y < toHeight; y += 1) {
    const weights = down.weights[y]
    const first = down.start[y]
    for (let x = 0; x < toWidth; x += 1) {
      let value = 0
      for (let index = 0; index < weights.length; index += 1) value += middle[(first + index) * toWidth + x] * weights[index]
      out[y * toWidth + x] = value < 0 ? 0 : value > 255 ? 255 : Math.round(value)
    }
  }
  return out
}

/**
 * Clarity of `candidate` against `reference` (same size, one byte per pixel),
 * from 0 to 1: the contrast-weighted mean similarity of detailed blocks,
 * averaged with that of the worst-hit 5% of the detail. 1 means nothing
 * detailed changed, or there is no detail to lose.
 */
export function clarity(reference: Uint8Array, candidate: Uint8Array, width: number, height: number): number {
  const area = BLOCK * BLOCK
  const scores: number[] = []
  const weights: number[] = []
  for (let top = 0; top + BLOCK <= height; top += BLOCK) {
    for (let left = 0; left + BLOCK <= width; left += BLOCK) {
      let sumX = 0
      let sumY = 0
      let sumXX = 0
      let sumYY = 0
      let sumXY = 0
      for (let y = 0; y < BLOCK; y += 1) {
        let index = (top + y) * width + left
        for (let x = 0; x < BLOCK; x += 1, index += 1) {
          const a = reference[index]
          const b = candidate[index]
          sumX += a
          sumY += b
          sumXX += a * a
          sumYY += b * b
          sumXY += a * b
        }
      }
      const meanX = sumX / area
      const meanY = sumY / area
      const varX = sumXX / area - meanX * meanX
      if (varX < DETAIL_VARIANCE) continue
      const varY = sumYY / area - meanY * meanY
      const cov = sumXY / area - meanX * meanY
      scores.push(((2 * meanX * meanY + C1) * (2 * cov + C2)) / ((meanX * meanX + meanY * meanY + C1) * (varX + varY + C2)))
      weights.push(varX)
    }
  }
  if (!scores.length) return 1
  const order = scores.map((_, index) => index).sort((a, b) => scores[a] - scores[b])
  let total = 0
  let weighted = 0
  for (let index = 0; index < scores.length; index += 1) {
    total += weights[index]
    weighted += scores[index] * weights[index]
  }
  let worstWeight = 0
  let worst = 0
  for (const index of order) {
    worstWeight += weights[index]
    worst += scores[index] * weights[index]
    if (worstWeight >= total * WORST_SHARE) break
  }
  return (weighted / total + worst / worstWeight) / 2
}
