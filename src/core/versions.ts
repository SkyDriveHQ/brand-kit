/**
 * Versions. A kit is never edited in place: the customer edits a draft, previews it and publishes it.
 * Published versions never change, and the product's live kit is a pointer to one of them, so a rollback
 * is a pointer change.
 */
import { BRAND_KIT_SCHEMA_VERSION, emptyKit, type BrandKit, type BrandKitVersion, type BrandStorageRules, type KitProblem } from './kit.js'
import { parseKit } from './validate.js'

/**
 * Why a version cannot be published; empty when it can. Only a draft can be published. A logo is not
 * required: an empty kit is a valid published kit (the business's name as text, in neutral colours).
 *
 * When `rules` is given, the kit is also checked strictly, and anything that would be refused is
 * reported, so the server can refuse a draft that a tampered browser saved.
 */
export function publishProblems(version: BrandKitVersion, rules?: BrandStorageRules): KitProblem[] {
  const problems: KitProblem[] = []
  if (version.state !== 'draft') {
    problems.push({
      field: 'state',
      severity: 'refused',
      message: 'This version has already been published and cannot be changed. Start a new draft to make changes.',
    })
  }
  if (rules) {
    if (version.tenantId !== rules.tenantId) {
      problems.push({
        field: 'tenantId',
        severity: 'refused',
        message: 'This draft belongs to a different business, so it cannot be published here.',
      })
    }
    problems.push(...parseKit(version.kit, rules, 'strict').problems.filter((p) => p.severity === 'refused'))
  }
  return problems
}

/** A fresh draft kit: a deep copy of the live kit, or an empty kit when nothing is live yet. */
export function draftFrom(live: BrandKitVersion | null): BrandKit {
  if (!live) return emptyKit()
  // The kit is plain JSON data, so a JSON round trip is a complete deep copy (and drops `undefined`,
  // which `exactOptionalPropertyTypes` wants absent anyway).
  const copy = JSON.parse(JSON.stringify(live.kit)) as BrandKit
  copy.schemaVersion = BRAND_KIT_SCHEMA_VERSION
  copy.logos ??= {}
  copy.colors ??= {}
  copy.fonts ??= {}
  return copy
}
