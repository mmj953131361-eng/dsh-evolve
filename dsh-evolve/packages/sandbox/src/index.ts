/**
 * L3 candidates require static checks, a trusted isolated verifier, and approval
 * bound to the unchanged source hash. No default dynamic verifier is supplied.
 * Static scanning and human approval alone never establish execution isolation.
 */
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@dsh-evolve/core/plugin'

export const name = 'evolve-sandbox'
export const inject = ['evolve']

/** Candidate source submitted by the model. */
export interface CandidateInput {
  readonly name: string
  readonly description: string
  readonly source: string
}

/** One static finding. */
export interface Finding {
  readonly rule: string
  readonly detail: string
}

/** Verification report. */
export interface VerifyReport {
  readonly ok: boolean
  readonly findings: readonly Finding[]
  readonly checks: {
    readonly contract: boolean
    readonly syntax: boolean
    readonly scan: boolean
    readonly networkPolicy: 'not-enforced'
  }
}

/** Persisted candidate metadata. */
export interface CandidateMeta {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly sourceHash?: string
  readonly verifiedHash?: string
  readonly approvedHash?: string
  readonly dynamicReport?: string
  readonly status: 'pending-validation' | 'pending' | 'approved' | 'rejected' | 'promoted' | 'failed'
  readonly createdAt: string
  readonly report: VerifyReport
}

/** Service exposed as `ctx.evolveSandbox`. */
export interface CandidateVerifier {
  verify(source: string): Promise<{ ok: boolean; sourceHash: string; confinement: 'enforced'; report: string }>
}
export interface EvolveSandboxService {
  setVerifier(verifier: CandidateVerifier): void
  submit(agent: Agent, input: CandidateInput): Promise<CandidateMeta>
  verify(agent: Agent, id: string): Promise<CandidateMeta | undefined>
  approve(agent: Agent, id: string): Promise<CandidateMeta | undefined>
  reject(agent: Agent, id: string): Promise<CandidateMeta | undefined>
  promote(agent: Agent, id: string): Promise<CandidateMeta | undefined>
  list(agent: Agent): Promise<CandidateMeta[]>
}

const BANNED: readonly { readonly rule: string; readonly pattern: RegExp }[] = [
  { rule: 'network', pattern: /\b(?:node:)?(?:http|https|net|dgram|tls)\b/ },
  { rule: 'network-fetch', pattern: /\bfetch\s*\(/ },
  { rule: 'network-websocket', pattern: /\bWebSocket\b/ },
  { rule: 'child-process', pattern: /\b(?:node:)?child_process\b|\b(?:spawn|spawnSync|execFile|execSync|fork)\s*\(/ },
  { rule: 'dynamic-eval', pattern: /\beval\s*\(|\bnew\s+Function\s*\(|\bFunction\s*\(/ },
  { rule: 'dynamic-import', pattern: /\bimport\s*\(/ },
  { rule: 'environment', pattern: /\bprocess\.env\b/ },
  { rule: 'filesystem', pattern: /\b(?:node:)?fs(?:\/promises)?\b/ },
]

/** Run all static checks without executing the candidate. */
export function verifySource(source: string): VerifyReport {
  const findings: Finding[] = []
  for (const { rule, pattern } of BANNED) {
    if (pattern.test(source)) findings.push({ rule, detail: `matches ${pattern}` })
  }
  const contract = /export\s+(?:const\s+name|function\s+apply|default)/.test(source)
    && (/export\s+function\s+apply/.test(source) || /apply\s*[:(]/.test(source))
  if (!contract) findings.push({ rule: 'contract', detail: 'must export name and apply' })
  if (source.length > 20000) findings.push({ rule: 'size', detail: 'source exceeds 20000 characters' })
  const syntax = checkSyntax(source)
  if (!syntax.ok) findings.push({ rule: 'syntax', detail: syntax.detail })
  return {
    ok: findings.length === 0,
    findings,
    checks: {
      contract,
      syntax: syntax.ok,
      scan: findings.every(finding => finding.rule !== 'network' && finding.rule !== 'child-process'),
      networkPolicy: 'not-enforced',
    },
  }
}

function checkSyntax(source: string): { ok: boolean; detail: string } {
  const result = spawnSync(process.execPath, ['--check', '--input-type=module', '-'], {
    input: source,
    encoding: 'utf8',
    timeout: 10000,
  })
  return result.status === 0
    ? { ok: true, detail: '' }
    : { ok: false, detail: (result.stderr || 'syntax check failed').slice(0, 500) }
}

async function atomic(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temp = `${path}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
  await writeFile(temp, text, 'utf8')
  await rename(temp, path)
}

/**
 * Mount the candidate service.
 * @param ctx - plugin context with `evolve`.
 */
export function apply(ctx: Context): void {
  const dirOf = (agent: Agent): string => ctx.evolve.require(agent).dir
  const candidateDir = (agent: Agent, id: string): string => {
    if (!/^cand-[a-z0-9-]+$/.test(id)) throw new Error('invalid candidate id')
    return join(dirOf(agent), 'candidates', id)
  }
  const hash = (source: string) => createHash('sha256').update(source).digest('hex')
  let verifier: CandidateVerifier | undefined
  const policy = (agent: Agent) => { if (!ctx.evolve.require(agent).enabled || !ctx.evolve.may('l3-candidate')) throw new Error('L3 disabled by policy') }
  const metaPath = (agent: Agent, id: string): string => join(candidateDir(agent, id), 'meta.json')

  const readMeta = async (agent: Agent, id: string): Promise<CandidateMeta | undefined> => {
    const raw = await readFile(metaPath(agent, id), 'utf8').catch(() => undefined)
    return raw === undefined ? undefined : JSON.parse(raw) as CandidateMeta
  }
  const writeMeta = async (agent: Agent, meta: CandidateMeta): Promise<void> => {
    await atomic(metaPath(agent, meta.id), `${JSON.stringify(meta, null, 2)}\n`)
  }

  const service: EvolveSandboxService = {
    setVerifier(value) { verifier = value },
    async submit(agent, input) {
      policy(agent)
      const id = `cand-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
      const report = verifySource(input.source)
      const meta: CandidateMeta = {
        id,
        name: input.name,
        description: input.description,
        status: report.ok ? 'pending-validation' : 'rejected',
        sourceHash: hash(input.source),
        createdAt: new Date().toISOString(),
        report,
      }
      await atomic(join(candidateDir(agent, id), 'index.js'), input.source)
      await writeMeta(agent, meta)
      return meta
    },
    async verify(agent, id) {
      policy(agent)
      const meta = await readMeta(agent, id)
      if (!meta) return undefined
      const source = await readFile(join(candidateDir(agent, id), 'index.js'), 'utf8')
      const report = verifySource(source)
      const sourceHash = hash(source)
      const dynamic = report.ok && verifier ? await verifier.verify(source) : undefined
      const verified = dynamic?.ok === true && dynamic.confinement === 'enforced' && dynamic.sourceHash === sourceHash
      const { approvedHash: _approval, verifiedHash: _verified, ...rest } = meta
      const updated: CandidateMeta = { ...rest, report, sourceHash,
        status: !report.ok ? 'rejected' : verified ? 'pending' : 'pending-validation',
        ...(verified ? { verifiedHash: sourceHash } : {}),
        dynamicReport: dynamic?.report ?? 'No enforced dynamic runner configured; static checks are not execution validation.' }
      await writeMeta(agent, updated); return updated
    },
    async approve(agent, id) {
      policy(agent)
      const meta = await readMeta(agent, id)
      if (!meta || !meta.report.ok || !meta.verifiedHash) return meta
      const sourceHash = hash(await readFile(join(candidateDir(agent, id), 'index.js'), 'utf8'))
      if (sourceHash !== meta.verifiedHash) throw new Error('candidate changed since verification')
      const updated: CandidateMeta = { ...meta, approvedHash: sourceHash, status: 'approved' }
      await writeMeta(agent, updated); return updated
    },
    async reject(agent, id) {
      const meta = await readMeta(agent, id)
      if (meta === undefined) return undefined
      const updated: CandidateMeta = { ...meta, status: 'rejected' }
      await writeMeta(agent, updated)
      return updated
    },
    async promote(agent, id) {
      policy(agent)
      const meta = await readMeta(agent, id)
      if (meta === undefined) return undefined
      if (meta.status !== 'approved') return meta
      const currentHash = hash(await readFile(join(candidateDir(agent, id), 'index.js'), 'utf8'))
      if (!meta.verifiedHash || meta.approvedHash !== currentHash || meta.verifiedHash !== currentHash) throw new Error('candidate approval/verification does not match content')
      const entry = pathToFileURL(join(candidateDir(agent, id), 'index.js')).href
      try {
        const candidate = await import(entry) as { apply?: (ctx: Context) => void; name?: string; inject?: string[] }
        const plugin = candidate.apply === undefined ? candidate : candidate
        const mount = agent.ctx.plugin as unknown as (candidate: unknown) => Promise<unknown>
        await mount(plugin)
        const promoted: CandidateMeta = { ...meta, status: 'promoted' }
        await writeMeta(agent, promoted)
        return promoted
      } catch (error: unknown) {
        const failed: CandidateMeta = {
          ...meta,
          status: 'failed',
          report: {
            ...meta.report,
            ok: false,
            findings: [...meta.report.findings, { rule: 'promotion', detail: error instanceof Error ? error.message : String(error) }],
          },
        }
        await writeMeta(agent, failed)
        return failed
      }
    },
    async list(agent) {
      const base = join(dirOf(agent), 'candidates')
      const ids = await readdir(base).catch(() => [] as string[])
      const metas: CandidateMeta[] = []
      for (const id of ids) {
        const meta = await readMeta(agent, id)
        if (meta !== undefined) metas.push(meta)
      }
      return metas.sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    },
  }

  ctx.provide('evolveSandbox', service)

  // Candidates are retained like worktrees so an approval record survives the session.
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    evolveSandbox: EvolveSandboxService
  }
}

export default { name, inject, apply }
