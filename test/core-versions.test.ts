import { describe, expect, it } from 'vitest'
import { emptyKit, type BrandKitVersion } from '../src/core/kit.js'
import { draftFrom, publishProblems } from '../src/core/versions.js'
import { fullKit, rules } from './core-fixtures.js'

function version(over: Partial<BrandKitVersion> = {}): BrandKitVersion {
  return {
    id: '0b5c1f8e-7d1a-4c55-9f1e-3a1b2c3d4e5f',
    tenantId: 'tenant-1',
    state: 'draft',
    kit: fullKit(),
    basedOn: null,
    createdAt: '2026-10-02T10:00:00Z',
    createdBy: null,
    publishedAt: null,
    publishedBy: null,
    ...over,
  }
}

describe('publishProblems', () => {
  it('allows a draft, including an empty one with no logo', () => {
    expect(publishProblems(version())).toEqual([])
    expect(publishProblems(version({ kit: emptyKit() }), rules)).toEqual([])
  })
  it('refuses anything that is not a draft', () => {
    const problems = publishProblems(version({ state: 'published' }))
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatchObject({ field: 'state', severity: 'refused' })
  })
  it('with rules, refuses a draft for another tenant or with a refused field', () => {
    expect(publishProblems(version({ tenantId: 'tenant-2' }), rules).map((p) => p.field)).toContain('tenantId')
    const bad = version({ kit: { ...emptyKit(), colors: { primary: 'red' } } })
    expect(publishProblems(bad, rules).map((p) => p.field)).toEqual(['colors.primary'])
    // Repairs are not reasons to refuse.
    expect(publishProblems(version({ kit: { ...emptyKit(), colors: { primary: '#ABC' } } }), rules)).toEqual([])
  })
})

describe('draftFrom', () => {
  it('starts empty when nothing is live', () => {
    expect(draftFrom(null)).toEqual(emptyKit())
  })
  it('deep-copies the live kit', () => {
    const live = version({ state: 'published' })
    const draft = draftFrom(live)
    expect(draft).toEqual(live.kit)
    draft.colors.primary = '#000000'
    draft.logos.logo!.renditions.web!.width = 1
    expect(live.kit.colors.primary).toBe('#1a73e8')
    expect(live.kit.logos.logo!.renditions.web!.width).toBe(400)
  })
})
