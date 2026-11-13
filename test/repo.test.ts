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
  const script = fileURLToPath(new URL('../scripts/release-check.sh', import.meta.url))
  const runIn = (readme: string, pkg: string) => {
    const dir = mkdtempSync(join(tmpdir(), 'mnemo-release-'))
    writeFileSync(join(dir, 'README.md'), readme)
    writeFileSync(join(dir, 'package.json'), pkg)
    return spawnSync('bash', [script], { cwd: dir, encoding: 'utf8' })
  }

  it('refuses a tag while a version placeholder or a vendored SDK is in place', () => {
    const r = runIn('Requires Mnema Talk MNEMA_MIN_VERSION or newer', '{"dependencies": {"mnema-talk-sdk": "file:vendor/sdk.tgz"}}')
    assert.equal(r.status, 1)
    assert.match(r.stderr, /MNEMA_MIN_VERSION/)
    assert.match(r.stderr, /vendor/)
  })

  it('passes for the repository as it is', () => {
    assert.equal(runIn(read('README.md'), read('package.json')).status, 0)
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
