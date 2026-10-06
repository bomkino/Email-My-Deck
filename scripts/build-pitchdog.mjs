// Builds the copy of Email My Deck that lives at https://pitch.dog/email-my-deck/.
// Output: dist-pitchdog/, ready to drop into apps/main-site/email-my-deck/ in
// bomkino/pitchdog-cloudflare-sites. The page links the host site's shared
// assets (type system, nav, analytics) by absolute path, so it only looks
// right when served from pitch.dog or a copy of its main-site folder.
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const outDir = 'dist-pitchdog'
const commit = execFileSync('git', ['rev-parse', 'HEAD']).toString().trim()
const dirty = execFileSync('git', ['status', '--porcelain']).toString().trim() !== ''

execFileSync('npx', ['vite', 'build', '--outDir', outDir, '--emptyOutDir'], {
  stdio: 'inherit',
  env: { ...process.env, EMD_BASE: '/email-my-deck/', EMD_SOURCE_COMMIT: commit },
})

// Cloudflare only reads _headers at the site root; the route's headers live in
// the host site's _headers file.
rmSync(join(outDir, '_headers'), { force: true })

mkdirSync(join(outDir, 'licenses'), { recursive: true })
for (const file of ['LICENSE', 'THIRD-PARTY-LICENSES.md', 'PROVENANCE.md']) copyFileSync(file, join(outDir, 'licenses', file))
// PDF.js and the data files it ships with (fonts, CMaps, decoders) keep their own notices.
const pdfjs = 'node_modules/pdfjs-dist'
mkdirSync(join(outDir, 'licenses', 'pdfjs'), { recursive: true })
for (const [from, to] of [
  ['LICENSE', 'LICENSE'],
  ['standard_fonts/LICENSE_FOXIT', 'LICENSE_FOXIT'],
  ['standard_fonts/LICENSE_LIBERATION', 'LICENSE_LIBERATION'],
  ['cmaps/LICENSE', 'LICENSE_CMAPS'],
  ['wasm/LICENSE_OPENJPEG', 'LICENSE_OPENJPEG'],
  ['wasm/LICENSE_PDFJS_OPENJPEG', 'LICENSE_PDFJS_OPENJPEG'],
  ['wasm/LICENSE_JBIG2', 'LICENSE_JBIG2'],
  ['wasm/LICENSE_PDFJS_JBIG2', 'LICENSE_PDFJS_JBIG2'],
]) copyFileSync(join(pdfjs, from), join(outDir, 'licenses', 'pdfjs', to))
// The WebAssembly image encoders (jpegli, SSIMULACRA2, libdeflate, Lanczos3) and what is linked into them.
const encoders = join(outDir, 'licenses', 'encoders')
mkdirSync(encoders, { recursive: true })
for (const file of readdirSync('scripts/codecs/licenses')) copyFileSync(join('scripts/codecs/licenses', file), join(encoders, file))
copyFileSync('scripts/codecs/jpegli/LICENSES.md', join(encoders, 'jpegli-LICENSES.md'))
copyFileSync('node_modules/@jsquash/resize/LICENSE', join(encoders, 'jsquash-resize-LICENSE'))
copyFileSync('node_modules/@jsquash/resize/lib/resize/LICENSE.codec.md', join(encoders, 'resize-crate-LICENSE.md'))

writeFileSync(join(outDir, 'BUILD.json'), `${JSON.stringify({
  source: 'https://github.com/bomkino/Email-My-Deck',
  commit,
  dirty,
  base: '/email-my-deck/',
  builtAt: new Date().toISOString(),
}, null, 2)}\n`)
console.log(`Built ${outDir} from ${commit}${dirty ? ' (with uncommitted changes)' : ''}.`)
