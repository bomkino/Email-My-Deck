// Builds the copy of Email My Deck that lives at https://pitch.dog/email-my-deck/.
// Output: dist-pitchdog/, ready to drop into apps/main-site/email-my-deck/ in
// bomkino/pitchdog-cloudflare-sites. The page links the host site's shared
// assets (type system, nav, analytics) by absolute path, so it only looks
// right when served from pitch.dog or a copy of its main-site folder.
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
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

writeFileSync(join(outDir, 'BUILD.json'), `${JSON.stringify({
  source: 'https://github.com/bomkino/Email-My-Deck',
  commit,
  dirty,
  base: '/email-my-deck/',
  builtAt: new Date().toISOString(),
}, null, 2)}\n`)
console.log(`Built ${outDir} from ${commit}${dirty ? ' (with uncommitted changes)' : ''}.`)
