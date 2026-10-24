/** Branded identifiers used across the evolve core. */

declare const revisionIdBrand: unique symbol
declare const libraryEntryIdBrand: unique symbol
declare const candidateIdBrand: unique symbol

/** Revision event identifier; legacy 16-hex content IDs remain readable. */
export type RevisionId = string & { readonly [revisionIdBrand]: true }
/** Stable library entry identifier. */
export type LibraryEntryId = string & { readonly [libraryEntryIdBrand]: true }
/** Isolated tool/plugin candidate identifier. */
export type CandidateId = string & { readonly [candidateIdBrand]: true }

const REVISION_ID = /^(?:[0-9a-f]{16}|[0-9a-f]{32})$/

/** Type one string as a {@link RevisionId}, rejecting malformed fingerprints. */
export function asRevisionId(value: string): RevisionId {
  if (!REVISION_ID.test(value)) {
    throw new TypeError(`invalid RevisionId "${value}": expected 32 lowercase hex characters (or a legacy 16-character ID)`)
  }
  return value as RevisionId
}

/** Type one non-empty string as a {@link LibraryEntryId}. */
export function asLibraryEntryId(value: string): LibraryEntryId {
  if (value.length === 0) throw new TypeError('LibraryEntryId must not be empty')
  return value as LibraryEntryId
}

/** Type one non-empty string as a {@link CandidateId}. */
export function asCandidateId(value: string): CandidateId {
  if (value.length === 0) throw new TypeError('CandidateId must not be empty')
  return value as CandidateId
}
