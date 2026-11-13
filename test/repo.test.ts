// Repository hygiene that would otherwise only show up in a review.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

describe('release check', () => {
  it('refuses a tag while the version placeholder or the vendored SDK is in place, and passes once both are gone', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mnemo-release-'))
    writeFileSync(join(dir, 'README.md'), read('README.md'))
    writeFileSync(join(dir, 'package.json'), read('package.json'))
    const run = () => spawnSync('bash', [fileURLToPath(new URL('../scripts/release-check.sh', import.meta.url))], { cwd: dir, encoding: 'utf8' })
    const now = run()
    assert.equal(now.status, 1)
    assert.match(now.stderr, /MNEMA_MIN_VERSION/)
    assert.match(now.stderr, /vendor/)
    writeFileSync(join(dir, 'README.md'), read('README.md').replaceAll('MNEMA_MIN_VERSION', '3.1.0'))
    writeFileSync(join(dir, 'package.json'), read('package.json').replace(/"file:vendor\/[^"]+"/, '"https://github.com/msch128/mnema-talk/releases/download/v3.1.0/mnema-talk-sdk-3.1.0.tgz"'))
    assert.equal(run().status, 0)
  })
})

describe('repository', () => {
  it('names the Mnema Talk version Mnemo needs, before the quick start', () => {
    const readme = read('README.md')
    const need = readme.indexOf('Requires Mnema Talk')
    assert.ok(need > 0 && need < readme.indexOf('### 1. Add Mnemo'), 'stated before step 1')
    assert.match(readme, /the first release that contains the bot platform \(3\.1 or later\)/)
  })


  it('keeps secrets, state and bulk out of the Docker build context', () => {
    const ignored = read('.dockerignore').split('\n').map((l) => l.trim())
    for (const p of ['.env', '.env.*', '.git', 'node_modules', 'data', 'test/integration/mnemo.log']) assert.ok(ignored.includes(p), p)
    assert.ok(ignored.includes('!.env.example'))
  })

  it('does not let Dependabot move the base image to another Node major', () => {
    const cfg = read('.github/dependabot.yml')
    const docker = cfg.slice(cfg.indexOf('package-ecosystem: docker'), cfg.indexOf('package-ecosystem: github-actions'))
    assert.match(docker, /dependency-name: node[\s\S]*version-update:semver-major/)
  })
})
