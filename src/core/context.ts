// ─────────────────────────────────────────────
// core/context.ts — shapeguard
// Typed per-request context store.
// Pass data between middleware without monkey-patching req properties.
//
// Usage:
//   // Auth middleware sets context:
//   setContext(req, 'user', { id: '123', role: 'admin' })
//
//   // Route handler reads it with full types:
//   const user = getContext<{ id: string; role: string }>(req, 'user')
// ─────────────────────────────────────────────

import type { Request, RequestHandler } from 'express'

const CTX_KEY = Symbol('sg:context')

type ContextStore = Record<string, unknown>

function getStore(req: Request): ContextStore {
  const r = req as Request & { [CTX_KEY]?: ContextStore }
  if (!r[CTX_KEY]) r[CTX_KEY] = Object.create(null) as ContextStore
  return r[CTX_KEY]!
}

/**
 * Store a typed value on the request context.
 * Call this in auth/permission middleware to pass data to downstream handlers.
 *
 * @example
 * // In auth middleware:
 * setContext(req, 'user', { id: user.id, role: user.role })
 * setContext(req, 'tenant', { id: tenantId, plan: 'pro' })
 */
export function setContext<T>(req: Request, key: string, value: T): void {
  getStore(req)[key] = value
}

/**
 * Read a typed value from the request context.
 * Returns undefined if the key was never set.
 *
 * @example
 * const user = getContext<{ id: string; role: string }>(req, 'user')
 * if (!user) throw AppError.unauthorized()
 */
export function getContext<T>(req: Request, key: string): T | undefined {
  return getStore(req)[key] as T | undefined
}

/**
 * Read a typed value from the context, throwing if it is absent.
 * Use when the middleware guarantee makes absence a programmer error.
 *
 * @example
 * // After requireAuth middleware:
 * const user = requireContext<AuthUser>(req, 'user')  // throws 500 if missing
 */
export function requireContext<T>(req: Request, key: string): T {
  const value = getStore(req)[key] as T | undefined
  if (value === undefined) {
    throw new Error(
      `[shapeguard] requireContext: key "${key}" not found in request context. ` +
      `Make sure the middleware that calls setContext("${key}", ...) runs before this handler.`
    )
  }
  return value
}

/**
 * Returns all context entries for the current request.
 * Useful for logging or debugging.
 */
export function getFullContext(req: Request): Readonly<ContextStore> {
  return getStore(req)
}

/**
 * Creates a middleware that sets a fixed context value on every request.
 * Useful for injecting tenant config, feature flags, etc.
 *
 * @example
 * app.use(contextMiddleware('version', '2024-01'))
 * app.use(contextMiddleware('config', loadedConfig))
 */
export function contextMiddleware<T>(key: string, value: T | ((req: Request) => T)): RequestHandler {
  return function setContextMiddleware(req, _res, next) {
    const resolved = typeof value === 'function' ? (value as (req: Request) => T)(req) : value
    setContext(req, key, resolved)
    next()
  }
}
