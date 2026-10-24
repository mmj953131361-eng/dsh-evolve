/**
 * Evolve Web panel, Host half.
 *
 * Registers same-origin routes when a `webServer` exists:
 *   GET  /evolve/state   live agents, revisions, budget, candidates, Library
 *   GET  /evolve/diff    one revision against its parent
 *   GET  /evolve/adoption complete reviewed target-file changes
 *   POST /evolve/action  rollback/propose/on/off/reflect/approve/reject/promote
 *
 * Human commands provide equivalent control without a Web UI. Confirmation
 * actions are never exposed as model approval tools.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { RevisionId } from '@dsh-evolve/core/ids'
import type {} from '@dsh-evolve/core/plugin'
import { episodeSummary, type EvolutionEpisode } from '@dsh-evolve/core/lifecycle'
import { diffTrees } from '@dsh-evolve/core/tree'

export const name = 'evolve-ui'
export const inject = ['evolve']

const MAX_BODY = 65536
const MAX_DIFF_CHARS = 4000

interface WebRouteLike {
  kind: 'exact' | 'prefix'
  path: string
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
}

interface WebServerLike {
  register(route: WebRouteLike): () => void
}

function json(res: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(body)
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
    size += buffer.length
    if (size > MAX_BODY) throw new Error('request body is too large')
    chunks.push(buffer)
  }
  if (chunks.length === 0) return {}
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('body must be a JSON object')
  }
  return parsed as Record<string, unknown>
}

function agentFrom(ctx: Context, id: unknown): Agent | undefined {
  if (typeof id !== 'string') return undefined
  return ctx.evolve.liveBindings().find(entry => String(entry.agent.id) === id)?.agent
}

function optionalService<T>(ctx: Context, name: string): T | undefined {
  try {
    return (ctx as unknown as { get?: (name: string) => unknown }).get?.call(ctx, name) as T | undefined
  } catch {
    return undefined
  }
}

/** A browser confirmation must originate from this exact server, not an embedded cross-site form. */
function sameOriginConfirmation(req: IncomingMessage): boolean {
  const origin = req.headers?.origin
  const host = req.headers?.host
  const site = req.headers?.['sec-fetch-site']
  const mode = req.headers?.['sec-fetch-mode']
  if (typeof origin !== 'string' || typeof host !== 'string'
    || req.headers?.['x-dsh-evolve-action'] !== '1'
    || !/^application\/json(?:\s*;|$)/i.test(String(req.headers?.['content-type'] ?? ''))
    || (site !== undefined && site !== 'same-origin')
    || (mode !== undefined && mode !== 'cors' && mode !== 'same-origin')) return false
  try {
    const expected = new URL(`${(req.socket as unknown as { encrypted?: boolean })?.encrypted ? 'https' : 'http'}://${host}`)
    return new URL(origin).origin === expected.origin && origin === expected.origin
  } catch { return false }
}

/**
 * Mount the panel routes.
 * @param ctx - plugin context with evolve; webServer is optional.
 */
export async function apply(ctx: Context): Promise<void> {
  await ctx.inject(['webServer'], (child) => {
    const server = (child as unknown as { webServer?: WebServerLike }).webServer
    if (server?.register === undefined) return
    registerRoutes(ctx, child, server)
  })
}

function registerRoutes(ctx: Context, child: Context, server: WebServerLike): void {
  child.effect(() => server.register({
    kind: 'exact',
    path: '/evolve/state',
    handler: async (_req, res) => {
      try {
        json(res, 200, { agents: await ctx.evolve.summarize() })
      } catch (error: unknown) {
        json(res, 500, { error: error instanceof Error ? error.message : String(error) })
      }
    },
  }), 'evolve-ui: /evolve/state')

  child.effect(() => server.register({
    kind: 'exact',
    path: '/evolve/diff',
    handler: async (req, res) => {
      try {
        const url = new URL(req.url ?? '/evolve/diff', 'http://localhost')
        const agent = agentFrom(ctx, url.searchParams.get('agentId'))
        if (agent === undefined) return json(res, 404, { error: 'unknown agent' })
        const id = url.searchParams.get('id')
        const current = ctx.evolve.current(agent)
        if (current === null && id === null) return json(res, 404, { error: 'no revision' })
        const revision = id === null ? current! : await ctx.evolve.get(agent, id as RevisionId)
        const parent = revision.parent === null ? null : await ctx.evolve.get(agent, revision.parent)
        const diff = diffTrees(parent?.tree ?? {}, revision.tree)
        const files = [
          ...diff.added.map(path => ({ path, status: 'added' as const })),
          ...diff.removed.map(path => ({ path, status: 'removed' as const })),
          ...diff.changed.map(path => ({ path, status: 'changed' as const })),
        ].map(file => ({
          ...file,
          before: (parent?.tree[file.path] ?? '').slice(0, MAX_DIFF_CHARS),
          after: (revision.tree[file.path] ?? '').slice(0, MAX_DIFF_CHARS),
        }))
        json(res, 200, {
          id: revision.id,
          parent: revision.parent,
          level: revision.level,
          cacheImpact: revision.cacheImpact,
          origin: revision.origin,
          files,
        })
      } catch (error: unknown) {
        json(res, 500, { error: error instanceof Error ? error.message : String(error) })
      }
    },
  }), 'evolve-ui: /evolve/diff')

  child.effect(() => server.register({
    kind: 'exact',
    path: '/evolve/adoption',
    handler: async (req, res) => {
      try {
        if (req.method !== 'GET') return json(res, 405, { error: 'GET required' })
        const url = new URL(req.url ?? '/evolve/adoption', 'http://localhost')
        const agent = agentFrom(ctx, url.searchParams.get('agentId'))
        if (!agent) return json(res, 404, { error: 'unknown agent' })
        const id = url.searchParams.get('id')
        if (!id) return json(res, 400, { error: 'adoption ID required' })
        const plan = await ctx.evolve.adoption(agent, id)
        if (!plan) return json(res, 404, { error: 'unknown adoption' })
        const diff = diffTrees(plan.beforeTree, plan.revision.tree)
        const files = plan.files ?? [
          ...diff.added.map(path => ({ path, status: 'added' as const })),
          ...diff.removed.map(path => ({ path, status: 'removed' as const })),
          ...diff.changed.map(path => ({ path, status: 'changed' as const })),
        ].map(file => ({ ...file, before: plan.beforeTree[file.path] ?? '', after: plan.revision.tree[file.path] ?? '' }))
        // Approval must review the complete payload; never silently truncate a change.
        json(res, 200, { plan, files })
      } catch (error) {
        json(res, 500, { error: error instanceof Error ? error.message : String(error) })
      }
    },
  }), 'evolve-ui: /evolve/adoption')

  child.effect(() => server.register({
    kind: 'exact',
    path: '/evolve/action',
    handler: async (req, res) => {
      try {
        if (req.method !== 'POST') return json(res, 405, { error: 'POST required' })
        const body = await readJson(req)
        if (['adoption-approve', 'adoption-reject', 'adoption-undo', 'automatic-retry'].includes(String(body.action)) && !sameOriginConfirmation(req)) {
          return json(res, 403, { error: 'a same-origin browser confirmation is required' })
        }
        const agent = agentFrom(ctx, body.agentId)
        if (agent === undefined) return json(res, 404, { error: 'unknown agent' })
        const action = body.action
        const id = typeof body.id === 'string' ? body.id : undefined
        const evolveAgent = optionalService<{
          proposeNow(agent: Agent, trigger?: string): Promise<unknown>
          reflect(agent: Agent): Promise<unknown>
          work(agent: Agent, id?: string): Promise<EvolutionEpisode | undefined>
          cancel(agent: Agent, id: string): Promise<void>
          resume(agent: Agent, id: string): Promise<void>
          retryObservation(agent: Agent): Promise<void>
        }>(ctx, 'evolveAgent')
        const sandbox = optionalService<{
          approve(agent: Agent, id: string): Promise<unknown>
          reject(agent: Agent, id: string): Promise<unknown>
          promote(agent: Agent, id: string): Promise<unknown>
        }>(ctx, 'evolveSandbox')

        switch (action) {
          case 'automatic-retry':
            if (!evolveAgent?.retryObservation) return json(res, 409, { error: 'automatic observation retry is unavailable' })
            await evolveAgent.retryObservation(agent)
            return json(res, 200, { ok: true })
          case 'adoption-approve':
          case 'adoption-reject':
          case 'adoption-undo': {
            if (!id || typeof body.contentHash !== 'string' || !/^[a-f0-9]{64}$/.test(body.contentHash)) {
              return json(res, 400, { error: 'adoption ID and exact content hash required' })
            }
            if (action === 'adoption-reject') {
              await ctx.evolve.rejectAdoption(agent, id, body.contentHash)
              return json(res, 200, { ok: true })
            }
            const outcome = action === 'adoption-undo'
              ? await ctx.evolve.undoAdoption(agent, id, body.contentHash)
              : await ctx.evolve.approveAdoption(agent, id, body.contentHash,
                typeof body.confirmedTargetId === 'string' ? { confirmedTargetId: body.confirmedTargetId } : undefined)
            return json(res, outcome.ok ? 200 : 409, outcome)
          }
          case 'rollback': {
            const outcome = await ctx.evolve.rollback(agent, id as RevisionId | undefined)
            return json(res, outcome.ok ? 200 : 409, outcome)
          }
          case 'on':
          case 'off': {
            await ctx.evolve.setEnabled(agent, action === 'on')
            return json(res, 200, { ok: true, enabled: action === 'on' })
          }
          case 'propose': {
            if (evolveAgent === undefined) return json(res, 409, { error: 'agent package not mounted' })
            return json(res, 200, await evolveAgent.proposeNow(agent, 'manual'))
          }
          case 'reflect': {
            if (evolveAgent === undefined) return json(res, 409, { error: 'agent package not mounted' })
            return json(res, 200, await evolveAgent.reflect(agent))
          }
          case 'work':
          case 'cancel':
          case 'resume': {
            if (!evolveAgent || !id) return json(res, 400, { error: 'experiment ID and agent service required' })
            if (action === 'work') {
              const job = await evolveAgent.work(agent, id)
              return json(res, 200, { result: job ? episodeSummary(job) : null })
            }
            await evolveAgent[action](agent, id)
            return json(res, 200, { ok: true })
          }
          case 'revoke': {
            if (!id) return json(res, 400, { error: 'experience ID required' })
            await ctx.evolve.require(agent).lifecycle.revoke(id, 'explicit user action')
            return json(res, 200, { ok: true })
          }
          case 'approve':
          case 'reject':
          case 'promote': {
            if (sandbox === undefined) return json(res, 409, { error: 'sandbox package not mounted' })
            if (id === undefined) return json(res, 400, { error: 'candidate id required' })
            return json(res, 200, await sandbox[action](agent, id))
          }
          default:
            return json(res, 400, { error: `unknown action ${String(action)}` })
        }
      } catch (error: unknown) {
        json(res, error instanceof Error && error.message.includes('body') ? 400 : 500, {
          error: error instanceof Error ? error.message : String(error),
        })
      }
    },
  }), 'evolve-ui: /evolve/action')
}

export default { name, inject, apply }
