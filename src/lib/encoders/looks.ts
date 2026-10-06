/**
 * "Does it still look right?" For each JPEG we write, find the lightest
 * jpegli setting whose SSIMULACRA2 score still reaches the target for the
 * ladder rung, so busy photos give bytes back and smooth skies keep theirs.
 *
 * Scores are taken on a few tiles at full resolution (the most detailed
 * regions, where blur shows, and the smoothest non-flat one, where blocking
 * shows) and the worst tile counts. That keeps the scorer's memory and time
 * the same for a 4K photo as for a small one.
 */

export type Score = (reference: Uint8Array, distorted: Uint8Array, width: number, height: number, channels: 1 | 3) => number

export type Tile = { x: number; y: number; width: number; height: number }

/** Tile edge in pixels and how many tiles judge an image. */
export const TILE = 384
export const TILES = 3

/**
 * Up to `count` non-overlapping tiles: the most detailed ones and the
 * smoothest one that isn't flat. An image no bigger than the tiles together
 * is judged whole.
 */
export function pickTiles(samples: Uint8Array, width: number, height: number, channels: 1 | 3, size = TILE, count = TILES): Tile[] {
  if (width * height <= size * size * count || width < size || height < size) return [{ x: 0, y: 0, width, height }]
  const columns = Math.floor(width / size)
  const rows = Math.floor(height / size)
  const offsetX = Math.floor((width - columns * size) / 2)
  const offsetY = Math.floor((height - rows * size) / 2)
  type Candidate = Tile & { detail: number; spread: number }
  const candidates: Candidate[] = []
  const step = 4
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x0 = offsetX + column * size
      const y0 = offsetY + row * size
      let detail = 0
      let sum = 0
      let squares = 0
      let n = 0
      for (let y = y0; y < y0 + size - step; y += step) {
        for (let x = x0; x < x0 + size - step; x += step) {
          const at = (y * width + x) * channels
          const value = channels === 3 ? (samples[at] * 2 + samples[at + 1] * 5 + samples[at + 2]) >> 3 : samples[at]
          const right = (y * width + x + step) * channels
          const below = ((y + step) * width + x) * channels
          const rightValue = channels === 3 ? (samples[right] * 2 + samples[right + 1] * 5 + samples[right + 2]) >> 3 : samples[right]
          const belowValue = channels === 3 ? (samples[below] * 2 + samples[below + 1] * 5 + samples[below + 2]) >> 3 : samples[below]
          detail += Math.abs(value - rightValue) + Math.abs(value - belowValue)
          sum += value
          squares += value * value
          n += 1
        }
      }
      const mean = sum / n
      candidates.push({ x: x0, y: y0, width: size, height: size, detail: detail / n, spread: Math.sqrt(Math.max(0, squares / n - mean * mean)) })
    }
  }
  const picked: Candidate[] = []
  const byDetail = [...candidates].sort((a, b) => b.detail - a.detail)
  for (const candidate of byDetail) {
    if (picked.length >= count - 1) break
    picked.push(candidate)
  }
  // The smoothest region that still has a gradient in it (a flat one shows nothing).
  const smooth = candidates.filter((candidate) => !picked.includes(candidate) && candidate.spread > 4).sort((a, b) => a.detail - b.detail)[0]
  if (smooth) picked.push(smooth)
  for (const candidate of byDetail) {
    if (picked.length >= count) break
    if (!picked.includes(candidate)) picked.push(candidate)
  }
  return picked.map(({ x, y, width: w, height: h }) => ({ x, y, width: w, height: h }))
}

export function cropTile(samples: Uint8Array, width: number, channels: 1 | 3, tile: Tile): Uint8Array {
  if (tile.x === 0 && tile.y === 0 && tile.width === width && samples.byteLength === tile.width * tile.height * channels) return samples
  const out = new Uint8Array(tile.width * tile.height * channels)
  const rowBytes = tile.width * channels
  for (let row = 0; row < tile.height; row += 1) {
    const from = ((tile.y + row) * width + tile.x) * channels
    out.set(samples.subarray(from, from + rowBytes), row * rowBytes)
  }
  return out
}

/** Worst SSIMULACRA2 score over the tiles; `decoded` holds the same tiles cut from the candidate. */
export function judge(score: Score, reference: Uint8Array[], decoded: Uint8Array[], tiles: Tile[], channels: 1 | 3): number {
  let worst = Infinity
  tiles.forEach((tile, index) => {
    worst = Math.min(worst, score(reference[index], decoded[index], tile.width, tile.height, channels))
  })
  return worst
}

/**
 * Decode a candidate JPEG the way a viewer would (the browser's own decoder)
 * and read back only the tiles, so a 4K candidate never needs a 4K readback.
 */
export async function decodeTiles(bytes: Uint8Array, tiles: Tile[], channels: 1 | 3): Promise<Uint8Array[]> {
  const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: 'image/jpeg' }), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' })
  try {
    return tiles.map((tile) => {
      const canvas = new OffscreenCanvas(tile.width, tile.height)
      const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true }) as OffscreenCanvasRenderingContext2D | null
      if (!context) throw new Error('2D canvas unavailable.')
      context.imageSmoothingEnabled = false
      context.drawImage(bitmap, tile.x, tile.y, tile.width, tile.height, 0, 0, tile.width, tile.height)
      const rgba = context.getImageData(0, 0, tile.width, tile.height).data
      const count = tile.width * tile.height
      const out = new Uint8Array(count * channels)
      if (channels === 3) {
        for (let pixel = 0, sample = 0, offset = 0; pixel < count; pixel += 1, sample += 3, offset += 4) {
          out[sample] = rgba[offset]
          out[sample + 1] = rgba[offset + 1]
          out[sample + 2] = rgba[offset + 2]
        }
      } else {
        for (let pixel = 0, offset = 0; pixel < count; pixel += 1, offset += 4) out[pixel] = rgba[offset]
      }
      return out
    })
  } finally {
    bitmap.close()
  }
}

export type Attempt = { distance: number; bytes: Uint8Array; score: number }

/**
 * Search jpegli distance for the largest one (fewest bytes) scoring at least
 * `target`, starting from `guess`. Score falls roughly linearly with log
 * distance, so each step aims along the line through the last two points.
 * Returns the lightest attempt that reached the target, or the best-looking
 * one when none did.
 */
export async function searchDistance(
  encode: (distance: number) => Uint8Array,
  scoreOf: (bytes: Uint8Array) => Promise<number>,
  target: number,
  guess: number,
  options: { maxSteps?: number; tolerance?: number; min?: number; max?: number } = {},
): Promise<Attempt & { steps: number }> {
  const { maxSteps = 6, tolerance = 0.75, min = 0.25, max = 8 } = options
  const attempts: Attempt[] = []
  const tryAt = async (distance: number) => {
    const bytes = encode(distance)
    const attempt = { distance, bytes, score: await scoreOf(bytes) }
    attempts.push(attempt)
    return attempt
  }
  // About 13 score points per e-fold of distance on photos, from the bench.
  const SLOPE = -13
  let previous: Attempt | null = null
  let current = await tryAt(Math.min(max, Math.max(min, guess)))
  for (let step = 1; step < maxSteps; step += 1) {
    const passing = attempts.filter((attempt) => attempt.score >= target)
    const failing = attempts.filter((attempt) => attempt.score < target)
    const bestPass = passing.length ? passing.reduce((a, b) => (b.distance > a.distance ? b : a)) : null
    const worstFail = failing.length ? failing.reduce((a, b) => (b.distance < a.distance ? b : a)) : null
    if (bestPass && bestPass.score - target <= tolerance) break
    if (bestPass && worstFail && worstFail.distance / bestPass.distance < 1.04) break
    let slope = SLOPE
    if (previous && Math.abs(Math.log(current.distance / previous.distance)) > 1e-3) {
      const measured = (current.score - previous.score) / Math.log(current.distance / previous.distance)
      if (measured < -1) slope = measured
    }
    // Aim a little above the target so the step usually lands on the passing side.
    let next = current.distance * Math.exp((target + tolerance / 2 - current.score) / slope)
    // Stay inside the bracket the attempts so far have found.
    const low = bestPass?.distance ?? min
    const high = worstFail?.distance ?? max
    if (!(next > low && next < high)) next = Math.sqrt(low * high)
    next = Math.min(max, Math.max(min, next))
    if (attempts.some((attempt) => Math.abs(attempt.distance / next - 1) < 0.01)) break
    previous = current
    current = await tryAt(next)
  }
  const passing = attempts.filter((attempt) => attempt.score >= target)
  const chosen = passing.length ? passing.reduce((a, b) => (b.bytes.byteLength < a.bytes.byteLength ? b : a)) : attempts.reduce((a, b) => (b.score > a.score ? b : a))
  return { ...chosen, steps: attempts.length }
}

/**
 * The best-looking (smallest) distance whose JPEG is no bigger than `cap`
 * bytes, searching up from `start`, which is over it. Bytes fall roughly as a
 * power of distance, so each step aims along the last two points in log–log.
 * Null when even `max` can't get under the cap.
 */
export function fitUnder(encode: (distance: number) => Uint8Array, cap: number, start: { distance: number; bytes: Uint8Array }, options: { maxSteps?: number; max?: number } = {}): { distance: number; bytes: Uint8Array } | null {
  const { maxSteps = 8, max = 25 } = options
  let over = start
  let under: { distance: number; bytes: Uint8Array } | null = null
  for (let step = 0; step < maxSteps; step += 1) {
    let next: number
    if (under) {
      const t = Math.log(over.bytes.byteLength / cap) / Math.log(over.bytes.byteLength / under.bytes.byteLength)
      next = Math.exp(Math.log(over.distance) + t * Math.log(under.distance / over.distance))
      if (!(next > over.distance && next < under.distance)) next = Math.sqrt(over.distance * under.distance)
    } else {
      if (over.distance >= max) break
      next = Math.min(max, over.distance * Math.max(1.1, over.bytes.byteLength / cap))
    }
    const bytes = encode(next)
    if (bytes.byteLength <= cap) under = { distance: next, bytes }
    else over = { distance: next, bytes }
    // Close enough under the cap, or the bracket is too narrow to matter.
    if (under && (under.bytes.byteLength >= cap * 0.97 || under.distance / over.distance < 1.02)) break
  }
  return under
}
