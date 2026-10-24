/**
 * Transactional overlay application (PRD §11.2).
 *
 * Ordering is chosen for crash safety:
 *   1. install the new overlay (old stays live)
 *   2. verify it (optional)
 *   3. persist the current pointer
 *   4. dispose the old overlay
 *
 * A crash before step 3 leaves the old revision as the durable pointer and the
 * new overlay is lost with the process; a crash after step 3 leaves the new
 * revision durable and the old effect unreachable. Neither path can brick the
 * session, and a failed step disposes whatever was newly installed.
 */
import type { RevisionId } from './ids.ts'
import type { Revision } from './revision.ts'

/** A live set of effects for one revision. */
export interface Overlay {
  dispose(): void | Promise<void>
}

/** Storage surface the applier needs. */
export interface OverlayStore {
  load(id: RevisionId): Promise<Revision>
  setCurrent(id: RevisionId): Promise<void>
}

/** Why an apply attempt failed. */
export type ApplyFailure =
  | 'install-failed'
  | 'verify-failed'
  | 'persist-failed'
  | 'no-current'
  | 'policy-denied'
  | 'stale'
  | 'invalid'
  | 'confirmation-required'
  | 'rejected'

/** Apply result; warnings are non-fatal cleanup problems. */
export type ApplyOutcome =
  | { readonly ok: true; readonly revision: Revision; readonly warnings: readonly string[] }
  | { readonly ok: false; readonly reason: ApplyFailure; readonly detail: string; readonly adoptionId?: string }

/** Dependencies for {@link OverlayManager}. */
export interface OverlayManagerOptions {
  readonly store: OverlayStore
  /** Install effects for a revision without disturbing the current overlay. */
  readonly install: (revision: Revision) => Promise<Overlay>
  /** Confirm the installed overlay is visible to the runtime. */
  readonly verify?: (revision: Revision, overlay: Overlay) => Promise<boolean>
  /** Called after a successful apply, before the old overlay is disposed. */
  readonly onApplied?: (revision: Revision) => void
}

/** Serializes apply/rollback and owns the live overlay. */
export class OverlayManager {
  private current: { readonly revision: Revision; readonly overlay: Overlay } | undefined
  private tail: Promise<unknown> = Promise.resolve()

  constructor(private readonly options: OverlayManagerOptions) {}

  /** The live revision, if any. */
  active(): Revision | undefined {
    return this.current?.revision
  }

  /** Apply a revision transactionally. */
  async apply(revision: Revision): Promise<ApplyOutcome> {
    return await this.exclusive(async () => await this.applyLocked(revision))
  }

  /** Re-apply an already-stored revision (used by resume). */
  async restore(id: RevisionId): Promise<ApplyOutcome> {
    return await this.exclusive(async () => {
      const revision = await this.options.store.load(id)
      return await this.applyLocked(revision)
    })
  }

  /**
   * Roll back to a stored revision and report whether anything was live.
   * The caller records the rollback Revision in history; this method only
   * replaces the live overlay and pointer.
   */
  async rollback(to: RevisionId): Promise<ApplyOutcome> {
    return await this.exclusive(async () => {
      if (this.current === undefined) {
        return { ok: false, reason: 'no-current', detail: 'no overlay is currently applied' }
      }
      if (this.current.revision.id === to) {
        return { ok: true, revision: this.current.revision, warnings: [] }
      }
      const target = await this.options.store.load(to)
      return await this.applyLocked(target)
    })
  }

  private async exclusive<T>(task: () => Promise<T>): Promise<T> {
    const run = this.tail.then(task, task)
    this.tail = run.then(() => undefined, () => undefined)
    return await run
  }

  private async applyLocked(revision: Revision): Promise<ApplyOutcome> {
    const previous = this.current
    if (previous?.revision.id === revision.id) {
      return { ok: true, revision, warnings: [] }
    }

    let overlay: Overlay
    try {
      overlay = await this.options.install(revision)
    } catch (error: unknown) {
      return { ok: false, reason: 'install-failed', detail: describe(error) }
    }

    if (this.options.verify !== undefined) {
      try {
        if (!await this.options.verify(revision, overlay)) {
          await disposeQuietly(overlay)
          return { ok: false, reason: 'verify-failed', detail: 'installed overlay did not become visible' }
        }
      } catch (error: unknown) {
        await disposeQuietly(overlay)
        return { ok: false, reason: 'verify-failed', detail: describe(error) }
      }
    }

    try {
      await this.options.store.setCurrent(revision.id)
    } catch (error: unknown) {
      await disposeQuietly(overlay)
      return { ok: false, reason: 'persist-failed', detail: describe(error) }
    }

    this.current = { revision, overlay }
    this.options.onApplied?.(revision)

    const warnings: string[] = []
    if (previous !== undefined) {
      try {
        await previous.overlay.dispose()
      } catch (error: unknown) {
        warnings.push(`old overlay disposal failed: ${describe(error)}`)
      }
    }
    return { ok: true, revision, warnings }
  }
}

async function disposeQuietly(overlay: Overlay): Promise<void> {
  try {
    await overlay.dispose()
  } catch {
    // The new overlay never became current; a failed cleanup cannot expose it.
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
