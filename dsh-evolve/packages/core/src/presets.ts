/**
 * Workspace L2 declarations.
 *
 * `presets/<id>.yml` and `subagents/<name>.yml` are parsed into agent-preset
 * definitions. A subagent file may describe a persona instead of a plugin
 * list; it is expanded to the persona plugin. Only the DSH agent-preset
 * registry can apply these, so headless/base profiles skip them.
 */
import { createHash } from 'node:crypto'
import { parse as parseYaml } from 'yaml'
import type { PresetDefinition } from '@deepseek-ai/dsh-agent-preset-registry'
import type { HarnessTree } from './tree.js'

/** Parsed declarations and non-fatal diagnostics. */
export interface ParsedPresets {
  readonly definitions: readonly PresetDefinition[]
  readonly errors: readonly string[]
}

type Row = PresetDefinition['plugins'][number]

function asRows(value: unknown, path: string, errors: string[]): Row[] | undefined {
  if (!Array.isArray(value)) {
    errors.push(`${path}: "plugins" must be a list of plugin rows`)
    return undefined
  }
  const rows: Row[] = []
  for (const [index, row] of value.entries()) {
    if (typeof row !== 'object' || row === null || Array.isArray(row)) {
      errors.push(`${path}: plugin row ${index + 1} is not an object`)
      return undefined
    }
    const name = (row as { name?: unknown }).name
    if (typeof name !== 'string' || name.trim() === '') {
      errors.push(`${path}: plugin row ${index + 1} needs a non-empty "name"`)
      return undefined
    }
    rows.push(row as Row)
  }
  return rows
}

/**
 * Parse declarations from a revision tree.
 * @param tree - the revision tree.
 * @returns definitions plus per-file errors; malformed files are skipped.
 */
export function parsePresetDefinitions(tree: HarnessTree): ParsedPresets {
  const definitions: PresetDefinition[] = []
  const errors: string[] = []
  for (const [path, text] of Object.entries(tree)) {
    const preset = path.startsWith('presets/') && path.endsWith('.yml') ? path.slice('presets/'.length, -4) : undefined
    const subagent = path.startsWith('subagents/') && path.endsWith('.yml') ? path.slice('subagents/'.length, -4) : undefined
    if (preset === undefined && subagent === undefined) continue
    const fallbackId = preset ?? subagent as string
    let document: unknown
    try {
      document = parseYaml(text)
    } catch (error: unknown) {
      errors.push(`${path}: invalid YAML (${error instanceof Error ? error.message : String(error)})`)
      continue
    }
    if (typeof document !== 'object' || document === null || Array.isArray(document)) {
      errors.push(`${path}: expected a mapping`)
      continue
    }
    const record = document as Record<string, unknown>
    const id = typeof record.id === 'string' && record.id.trim() !== ''
      ? record.id.trim()
      : fallbackId
    if (!/^[a-z0-9][a-z0-9._-]*$/i.test(id)) {
      errors.push(`${path}: invalid preset id "${id}"`)
      continue
    }
    const plugins = record.plugins
    let rows: Row[] | undefined
    if (plugins === undefined && typeof record.persona === 'string' && record.persona.trim() !== '') {
      rows = [{
        name: '@deepseek-ai/dsh-persona',
        config: { prefix: record.persona.trim() },
      }]
    } else {
      rows = asRows(plugins ?? [], path, errors)
    }
    if (rows === undefined) continue
    definitions.push({
      id,
      ...typeof record.name === 'string' ? { name: record.name } : {},
      ...typeof record.description === 'string' ? { description: record.description } : {},
      ...typeof record.order === 'number' ? { order: record.order } : {},
      plugins: rows,
    })
  }
  return { definitions, errors }
}

/** Stable fingerprint of one definition, used to avoid duplicate registration. */
export function presetFingerprint(definition: PresetDefinition): string {
  return createHash('sha256')
    .update(JSON.stringify(definition))
    .digest('hex')
    .slice(0, 16)
}
