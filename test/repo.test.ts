// Repository hygiene that would otherwise only show up in a review.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

describe('repository', () => {
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
