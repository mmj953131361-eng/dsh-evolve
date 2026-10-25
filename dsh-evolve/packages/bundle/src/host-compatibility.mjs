/** Host entry boundary. Deliberately has no static imports of DSH or Evo runtime. */
const hosts = new WeakMap()

function stateFor(ctx) {
  const root = ctx.root ?? ctx
  let state = hosts.get(root)
  if (!state) {
    state = { disabled: false, reason: '', components: {}, fibers: new Set(), owners: 0 }
    hosts.set(root, state)
  }
  return state
}

export function compatibilityState(ctx) {
  const { disabled, reason, components } = stateFor(ctx)
  return { status: disabled ? 'disabled' : Object.values(components).every(s => s === 'active') ? 'active' : 'waiting',
    reason, components: { ...components } }
}

function fail(ctx, state, name, error) {
  if (state.disabled) return
  state.disabled = true
  state.reason = `${name}: ${error instanceof Error ? error.message : String(error)}`
  state.components[name] = 'disabled'
  ctx.logger?.warn?.('Evo disabled; DSH can continue. %s', state.reason)
  // Never await disposal from the apply callback of the fiber being disposed.
  // Its apply must settle first. Dispose only Evo children, never host services.
  setTimeout(() => {
    void Promise.allSettled([...state.fibers].map(fiber => Promise.resolve().then(() => fiber.dispose())))
      .then(() => { state.fibers.clear() })
  }, 0)
}

/** Validate the API we use, rather than comparing the host's release string. */
function checkCapabilities(ctx, name) {
  const requirements = {
    core: { agents: ['create', 'list'], systemPrompt: ['section', 'context'], skills: ['register', 'snapshot'] },
    observer: { tools: ['register'] },
    agent: { llm: ['stream', 'resolveModelInfo'] },
  }
  for (const [service, methods] of Object.entries(requirements[name] ?? {})) {
    for (const method of methods) {
      if (typeof ctx[service]?.[method] !== 'function') throw new Error(`Required host API is missing: ${service}.${method}`)
    }
  }
}

export function hostEntry(name, load) {
  return {
    name: `evo-host-${name}`,
    // No Config or inject here: loader-level validation/import failure would
    // otherwise escape this boundary before apply can handle it.
    async apply(ctx, config = {}) {
      const state = stateFor(ctx)
      try {
        if (typeof ctx.plugin !== 'function' || typeof ctx.effect !== 'function') {
          throw new Error('Required Cordis plugin/effect API is missing')
        }
        state.owners++
        ctx.effect(() => () => {
          delete state.components[name]
          if (--state.owners === 0) {
            state.resolver?.deregister()
            hosts.delete(ctx.root ?? ctx)
          }
        })
        if (state.disabled && name !== 'ui') return
        state.components[name] = 'loading'
        // pnpm can retain dev.11's SDK packages as optional peers on upgrade.
        // Resolve OUR host imports at the active Profile boundary, where DSH
        // routes to its runtime. Never redirect imports belonging to DSH itself.
        const profile = ctx.get?.('profileContext')
        const packages = ctx.get?.('pluginPackages')
        if (profile?.dir && typeof packages?.packageOf === 'function' && !state.resolver) {
          const { registerHooks } = await import('node:module')
          const { pathToFileURL } = await import('node:url')
          const { join } = await import('node:path')
          const owner = new URL('./', import.meta.url).href
          const anchor = pathToFileURL(join(profile.dir, 'package.json')).href
          if (typeof registerHooks !== 'function') throw new Error('Required Node module resolver API is missing')
          // Another entry may have completed these asynchronous imports first.
          state.resolver ??= registerHooks({ resolve(specifier, context, nextResolve) {
            if (specifier.startsWith('@deepseek-ai/') && context.parentURL?.startsWith(owner)) {
              const target = packages.packageOf(specifier, anchor)
              if (!target?.manifestPath) throw new Error(`Host package is unavailable: ${specifier}`)
              // Resolve as a self-reference of the host package, preserving the
              // original ESM conditions (not createRequire's CJS entrypoint).
              return nextResolve(specifier, { ...context, parentURL: pathToFileURL(target.manifestPath).href })
            }
            return nextResolve(specifier, context)
          } })
        }
        if (name === 'ui') {
          const statusFiber = ctx.inject(['webServer'], child => {
            try {
              child.effect(() => child.webServer.register({ kind: 'exact', path: '/evolve/compatibility',
                handler: (_req, res) => {
                  res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
                  res.end(JSON.stringify(compatibilityState(ctx)))
                } }), 'evo-compatibility-status')
            } catch (error) { fail(ctx, state, name, error) }
          })
          await statusFiber
        }
        if (state.disabled) return
        const runtime = await load()
        if (state.disabled) return
        const isClass = typeof runtime.default === 'function' && /^class\s/.test(Function.prototype.toString.call(runtime.default))
        const plugin = isClass ? runtime.default : runtime
        if (!isClass && typeof plugin.apply !== 'function') throw new Error('Evo plugin has no apply export')
        state.components[name] = 'waiting'
        const child = ctx.plugin({
          name: `evo-guarded-${name}`,
          inject: plugin.inject,
          async apply(inner) {
            if (state.disabled) return
            try {
              checkCapabilities(inner, name)
              if (name === 'core') {
                const { default: AgentRegistry } = await import('@deepseek-ai/dsh-agent')
                if (!(inner.agents instanceof AgentRegistry)) throw new Error('Evo resolved a different AgentRegistry than its host; check Profile SDK overrides')
              }
              if (name === 'agent') {
                const { default: LlmRuntime } = await import('@deepseek-ai/dsh-llm')
                if (!(inner.llm instanceof LlmRuntime)) throw new Error('Evo resolved a different LlmRuntime than its host; check Profile SDK overrides')
              }
              if (isClass) {
                await inner.plugin(plugin, config)
              } else {
                // Resolve defaults inside the boundary, including schema errors.
                const { resolveConfig } = await import('@deepseek-ai/cordis')
                if (typeof resolveConfig !== 'function') throw new Error('Required Cordis resolveConfig API is missing')
                await plugin.apply(inner, resolveConfig(plugin, config))
              }
              if (!state.disabled) state.components[name] = 'active'
            } catch (error) { fail(ctx, state, name, error) }
          },
        })
        state.fibers.add(child)
        ctx.effect(() => () => { state.fibers.delete(child) })
        await child
        if (state.disabled) await child.dispose()
      } catch (error) { fail(ctx, state, name, error) }
    },
  }
}
