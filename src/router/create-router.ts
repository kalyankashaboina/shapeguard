// ─────────────────────────────────────────────
// router/create-router.ts — shapeguard
// Drop-in for express.Router().
// Tracks registered methods per path.
// Any unregistered method → 405 with Allow header.
// Works with parameterized routes like /users/:id.
// ─────────────────────────────────────────────

import { Router as ExpressRouter } from 'express'
import type {
  Router, RouterOptions, RequestHandler,
  Request, Response, NextFunction,
} from 'express'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../types/index.js'

type HttpVerb = 'get' | 'post' | 'put' | 'patch' | 'delete' | 'head' | 'options'
const HTTP_VERBS: HttpVerb[] = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options']

// Build regex from route pattern like /users/:id
function buildMatcher(pattern: string): RegExp {
  // Replace :param with a segment matcher
  const rx = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')   // escape except */?
    .replace(/:([^/]+)/g, '[^/]+')            // :id → [^/]+
    .replace(/\*/g, '.*')                     // * → .*
  return new RegExp('^' + rx + '/?$')
}

export function createRouter(opts?: RouterOptions): Router {
  const router = ExpressRouter(opts)

  // Map of registered pattern → Set of methods (uppercase)
  const registeredMethods = new Map<string, Set<string>>()

  function track(path: string, method: string): void {
    const key = normalizePath(path)
    if (!registeredMethods.has(key)) {
      registeredMethods.set(key, new Set())
    }
    registeredMethods.get(key)!.add(method.toUpperCase())
  }

  // Check if a request path matches a registered pattern
  // Returns the matched pattern's method set, or null if no match
  function findMatch(reqPath: string): Set<string> | null {
    const normalReqPath = normalizePath(reqPath)

    // First try exact match (most paths are not parameterized)
    if (registeredMethods.has(normalReqPath)) {
      return registeredMethods.get(normalReqPath)!
    }

    // Then try pattern matching for :param routes
    for (const [pattern, methods] of registeredMethods) {
      if (pattern.includes(':') || pattern.includes('*')) {
        if (buildMatcher(pattern).test(normalReqPath)) {
          return methods
        }
      }
    }

    return null
  }

  // 405 catcher — registered as router.use() so it runs after all route handlers
  router.use(function methodNotAllowedCatch(req: Request, _res: Response, next: NextFunction): void {
    const allowed = findMatch(req.path)

    if (!allowed || allowed.size === 0) {
      // No match — let notFoundHandler deal with it
      return next()
    }

    if (allowed.has(req.method.toUpperCase())) {
      // Method is registered — should have been handled already
      return next()
    }

    // Path matched but method not registered → 405
    const allowedList = [...allowed]
    _res.setHeader('Allow', allowedList.join(', '))
    next(new AppError(
      ErrorCode.METHOD_NOT_ALLOWED,
      `Method ${req.method} is not allowed on this route`,
      405,
      { allowed: allowedList },
    ))
  })

  // Proxy HTTP verbs to track registrations
  const proxied = new Proxy(router, {
    get(target, prop: string) {
      if ((HTTP_VERBS as string[]).includes(prop)) {
        return function(path: string, ...handlers: RequestHandler[]) {
          track(path, prop)
          return (target[prop as keyof Router] as Function)(path, ...handlers)
        }
      }

      // Intercept router.route(path) — returns a chainable object whose
      // HTTP verb methods must also be tracked for 405 to work correctly.
      if (prop === 'route') {
        return function(path: string) {
          const routeObj = (target.route as Function)(path)
          // Wrap every HTTP verb on the returned route object
          for (const verb of HTTP_VERBS) {
            const original = routeObj[verb]?.bind(routeObj)
            if (typeof original === 'function') {
              routeObj[verb] = function(...args: unknown[]) {
                track(path, verb)
                return original(...args)
              }
            }
          }
          return routeObj
        }
      }

      return target[prop as keyof Router]
    },
  }) as Router

  return proxied
}

function normalizePath(path: string): string {
  return path.endsWith('/') && path.length > 1 ? path.slice(0, -1) : path
}
