// ─────────────────────────────────────────────
// validation/res-helpers.ts — shapeguard
// Injects res.ok / res.created / res.fail / res.paginated / res.cursorPaginated onto every response.
// ─────────────────────────────────────────────

import type { Request, Response, NextFunction, RequestHandler } from 'express'
import type { ResponseConfig, ResOkOpts, ResFailOpts, ResPaginatedOpts, ResCursorPaginatedOpts, HttpMethod } from '../types/index.js'
import { buildSuccess, buildPaginated, buildError } from '../core/response.js'

const DEFAULT_STATUS: Record<HttpMethod, number> = {
  POST: 201, GET: 200, PUT: 200, PATCH: 200, DELETE: 200, HEAD: 200, OPTIONS: 200,
}

export function injectResHelpers(config: ResponseConfig = {}): RequestHandler {
  return function resHelpersMiddleware(req: Request, res: Response, next: NextFunction): void {
    const method      = req.method.toUpperCase() as HttpMethod
    const statusCodes = { ...DEFAULT_STATUS, ...(config.statusCodes ?? {}) }

    res.ok = function(opts: ResOkOpts): void {
      if (res.headersSent) return
      res.status(opts.status ?? statusCodes[method] ?? 200).json(buildSuccess(opts.data ?? null, opts.message ?? '', config))
    }
    res.created = function(opts: ResOkOpts): void {
      if (res.headersSent) return
      res.status(opts.status ?? 201).json(buildSuccess(opts.data ?? null, opts.message ?? '', config))
    }
    res.accepted = function(opts: ResOkOpts): void {
      if (res.headersSent) return
      res.status(opts.status ?? 202).json(buildSuccess(opts.data ?? null, opts.message ?? '', config))
    }
    res.noContent = function(): void {
      if (res.headersSent) return
      res.status(204).end()
    }
    res.paginated = function(opts: ResPaginatedOpts): void {
      if (res.headersSent) return
      res.status(200).json(buildPaginated(opts.data, opts.total, opts.page, opts.limit, opts.message ?? '', config))
    }
    // Cursor-based pagination — enterprise pattern for large datasets and infinite scroll.
    // Unlike offset pagination, cursors remain stable when data changes between pages.
    res.cursorPaginated = function(opts: ResCursorPaginatedOpts): void {
      if (res.headersSent) return
      const payload = {
        items:      opts.data,
        nextCursor: opts.nextCursor,
        prevCursor: opts.prevCursor ?? null,
        hasMore:    opts.hasMore,
        ...(opts.total !== undefined && { total: opts.total }),
      }
      res.status(200).json(buildSuccess(payload, opts.message ?? '', config))
    }
    res.fail = function(opts: ResFailOpts): void {
      if (res.headersSent) return
      res.status(opts.status ?? 400).json(buildError(opts.code, opts.message, (opts.details as never) ?? null, false, config))
    }

    next()
  }
}
