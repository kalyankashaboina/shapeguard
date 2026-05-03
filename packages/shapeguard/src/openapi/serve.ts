// ─────────────────────────────────────────────────────────────────────────────
// openapi/serve.ts — shapeguard
//
// Serve your OpenAPI spec as interactive documentation.
// All UIs load from CDN — zero npm install, zero bundle impact.
//
// Choose any UI (or all three):
//   serveScalar(spec)     — modern UI, client code snippets, persistent auth
//   serveSwaggerUI(spec)  — classic UI, enhanced with persistent auth + dark mode
//   serveRedoc(spec)      — clean read-only docs (Stripe-style public portal)
//
// Or mount everything at once:
//   app.use(serveDocs(spec, { ui: 'scalar', exports: { postman: '/docs/postman.json' } }))
//
// Spec exports (pure functions, no deps):
//   toPostman(spec)   — Postman Collection v2.1 JSON
//   toInsomnia(spec)  — Insomnia export JSON
//   toBruno(spec)     — Bruno collection JSON
// ─────────────────────────────────────────────────────────────────────────────

import { createRequire } from 'module'
import type { RequestHandler, Request, Response } from 'express'
import type { OpenAPISpec } from './index.js'

const _require = createRequire(import.meta.url)
import { randomBytes } from 'crypto'

// ── Shared helpers ────────────────────────────────────────────────────────────

import { esc, safeJson } from './utils.js'

function htmlHandler(html: string): RequestHandler {
  return (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('X-Frame-Options', 'SAMEORIGIN')
    res.setHeader('Referrer-Policy', 'no-referrer')
    res.send(html)
  }
}

// ── serveScalar ───────────────────────────────────────────────────────────────

export interface ScalarOptions {
  /** Browser tab title. Defaults to spec.info.title */
  title?:    string
  /** Color theme. Defaults to 'auto' (follows system preference) */
  theme?:    'light' | 'dark' | 'auto'
  /** URL to favicon */
  favicon?:  string
  /** Custom CSS overrides */
  customCss?: string
}

/**
 * Serve Scalar API Reference UI — modern, beautiful, zero install.
 *
 * Features (all built-in, no config):
 * - Try it out — execute requests from browser
 * - Persistent auth — JWT saved across page reloads
 * - Client code snippets — curl, fetch, axios, Python per endpoint
 * - Dark mode — automatic from system preference
 * - Endpoint search
 *
 * @example
 * import { serveScalar } from 'shapeguard/openapi'
 * app.use('/docs', serveScalar(spec))
 * // → open http://localhost:3000/docs
 */
export function serveScalar(spec: OpenAPISpec, opts: ScalarOptions = {}): RequestHandler {
  const title   = esc(opts.title ?? spec.info?.title ?? 'API Docs')
  const favicon  = opts.favicon ? `<link rel="icon" href="${esc(opts.favicon)}">` : ''
  const specJson = safeJson(spec)

  // Theme: Scalar uses its own theme system
  const scalarTheme = opts.theme === 'dark' ? 'purple' : opts.theme === 'light' ? 'default' : 'default'

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${title}</title>
${favicon}
${opts.customCss ? `<style>${opts.customCss}</style>` : ''}
</head>
<body>
<script id="api-reference" type="application/json">${specJson}</script>
<script>
var configuration = {
  theme: '${scalarTheme}',
  darkMode: ${opts.theme !== 'light'},
  defaultHttpClient: { targetKey: 'javascript', clientKey: 'fetch' },
  persistAuth: true,
}
document.getElementById('api-reference').setAttribute('data-configuration', JSON.stringify(configuration))
</script>
<script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
</body>
</html>`

  return htmlHandler(html)
}

// ── serveSwaggerUI ────────────────────────────────────────────────────────────

export interface SwaggerUIOptions {
  /** Browser tab title */
  title?:    string
  /** Color theme. Defaults to 'auto' */
  theme?:    'light' | 'dark' | 'auto'
  /** Show code snippets (curl/fetch/axios/Python). Default true */
  snippets?: boolean
  /** Persist auth token across page reloads. Default true */
  persist?:  boolean
  /** favicon URL */
  favicon?:  string
  /** Custom CSS */
  customCss?: string
}

/**
 * Serve Swagger UI — classic API testing interface, enhanced.
 *
 * Enhancements over raw Swagger UI (injected, zero install):
 * - Persistent auth: JWT saved to localStorage, restored on reload
 * - Client code snippets: curl, fetch, axios, Python per endpoint
 * - Dark mode: CSS injected for dark system preference
 *
 * @example
 * import { serveSwaggerUI } from 'shapeguard/openapi'
 * app.use('/docs', serveSwaggerUI(spec, { theme: 'dark' }))
 */
export function serveSwaggerUI(spec: OpenAPISpec, opts: SwaggerUIOptions = {}): RequestHandler {
  const title     = esc(opts.title ?? spec.info?.title ?? 'API Docs')
  const snippets  = opts.snippets !== false
  const persist   = opts.persist  !== false
  const favicon   = opts.favicon ? `<link rel="icon" href="${esc(opts.favicon)}">` : ''
  const specJson  = safeJson(spec)
  const theme     = opts.theme ?? 'auto'

  const darkCss = `
body{background:#0d1117}
#swagger-ui .topbar{background:#161b22;border-bottom:1px solid #30363d}
#swagger-ui .info .title,#swagger-ui .opblock-tag{color:#e6edf3}
#swagger-ui .info p{color:#8b949e}
#swagger-ui .scheme-container,#swagger-ui section.models{background:#161b22;border:1px solid #30363d;box-shadow:none}
#swagger-ui .opblock{border:1px solid #30363d;border-radius:6px;background:#0d1117;box-shadow:none}
#swagger-ui .opblock .opblock-summary{background:#161b22}
#swagger-ui .opblock.opblock-get .opblock-summary{border-color:#1f6feb}
#swagger-ui .opblock.opblock-post .opblock-summary{border-color:#238636}
#swagger-ui .opblock.opblock-put .opblock-summary{border-color:#9e6a03}
#swagger-ui .opblock.opblock-delete .opblock-summary{border-color:#da3633}
#swagger-ui textarea,#swagger-ui input[type=text],#swagger-ui input[type=password]{background:#161b22;color:#e6edf3;border:1px solid #30363d}
#swagger-ui .btn{background:#21262d;color:#e6edf3;border:1px solid #30363d}
#swagger-ui .btn.execute{background:#1f6feb;border-color:#1f6feb;color:#fff}
#swagger-ui .btn.authorize{background:transparent;border:1px solid #58a6ff;color:#58a6ff}
#swagger-ui .highlight-code pre{background:#161b22!important;color:#e6edf3!important}`

  const themeStyles =
    theme === 'dark' ? `<style>${darkCss}</style>` :
    theme === 'auto' ? `<style>@media(prefers-color-scheme:dark){${darkCss}}</style>` : ''

  // Persistent auth: save to localStorage on Authorize, restore on load
  const persistAuthJs = persist ? `
window.addEventListener('load', function() {
  var saved = localStorage.getItem('sg_swagger_auth');
  if (saved) {
    try {
      var auth = JSON.parse(saved);
      window.ui.preauthorizeApiKey && Object.entries(auth).forEach(function(e) {
        try { window.ui.preauthorizeApiKey(e[0], e[1]); } catch(err) {}
        try { window.ui.preauthorizeBearerToken && window.ui.preauthorizeBearerToken(e[1]); } catch(err) {}
      });
    } catch(e) {}
  }
  document.addEventListener('click', function(e) {
    var btn = e.target.closest && e.target.closest('.btn.modal-btn.auth.authorize.button');
    if (!btn) return;
    setTimeout(function() {
      var authData = {};
      document.querySelectorAll('.auth-container input[name]').forEach(function(inp) {
        if (inp.value) authData[inp.getAttribute('name')] = inp.value;
      });
      if (Object.keys(authData).length) localStorage.setItem('sg_swagger_auth', JSON.stringify(authData));
    }, 300);
  });
});` : ''

  const snippetsJs = snippets ? `
<script src="https://unpkg.com/swagger-ui-request-snippets/dist/swagger-ui-request-snippets.js"></script>` : ''

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<meta name="referrer" content="no-referrer">
<title>${title}</title>
${favicon}
<link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist/swagger-ui.css">
${themeStyles}
${opts.customCss ? `<style>${opts.customCss}</style>` : ''}
</head>
<body>
<div id="swagger-ui"></div>
${snippetsJs}
<script src="https://unpkg.com/swagger-ui-dist/swagger-ui-bundle.js"></script>
<script src="https://unpkg.com/swagger-ui-dist/swagger-ui-standalone-preset.js"></script>
<script>
window.onload = function() {
  var cfg = {
    spec: ${specJson},
    dom_id: '#swagger-ui',
    presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
    layout: 'StandaloneLayout',
    validatorUrl: 'none',
    persistAuthorization: ${persist},
    displayRequestDuration: true,
    tryItOutEnabled: true,
    filter: true,
    deepLinking: true,
    syntaxHighlight: { theme: '${theme === 'light' ? 'agate' : 'monokai'}' },
    ${snippets ? "plugins: [typeof SwaggerUIRequestSnippets !== 'undefined' ? SwaggerUIRequestSnippets : SwaggerUIBundle.plugins.DownloadUrl]," : ''}
  };
  window.ui = SwaggerUIBundle(cfg);
  ${persistAuthJs}
};
</script>
</body>
</html>`

  return htmlHandler(html)
}

// ── serveRedoc ────────────────────────────────────────────────────────────────

export interface RedocOptions {
  /** Browser tab title */
  title?:    string
  /** Redoc theme overrides */
  theme?:    Record<string, unknown>
  /** Hide download button. Default false */
  hideDownloadButton?: boolean
  /** favicon URL */
  favicon?: string
}

/**
 * Serve Redoc — clean read-only API documentation.
 * Used by Stripe, Twilio, and many large companies for public developer portals.
 *
 * Best for: public-facing /api-reference pages
 * Not for: internal testing (no Try-it-out)
 *
 * @example
 * import { serveRedoc } from 'shapeguard/openapi'
 * app.use('/api-reference', serveRedoc(spec))
 */
export function serveRedoc(spec: OpenAPISpec, opts: RedocOptions = {}): RequestHandler {
  const title    = esc(opts.title ?? spec.info?.title ?? 'API Reference')
  const favicon  = opts.favicon ? `<link rel="icon" href="${esc(opts.favicon)}">` : ''
  const specJson = safeJson(spec)

  const redocConfig = safeJson({
    hideDownloadButton: opts.hideDownloadButton ?? false,
    theme: opts.theme ?? {
      colors: { primary: { main: '#0f6e56' } },
      typography: { fontSize: '15px', fontFamily: "'Segoe UI', system-ui, sans-serif" },
    },
    ...( opts.hideDownloadButton ? { hideDownloadButton: true } : {}),
  })

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${title}</title>
${favicon}
<style>body{margin:0;padding:0}</style>
</head>
<body>
<div id="redoc-container"></div>
<script src="https://cdn.jsdelivr.net/npm/redoc/bundles/redoc.standalone.js"></script>
<script>
Redoc.init(${specJson}, ${redocConfig}, document.getElementById('redoc-container'))
</script>
</body>
</html>`

  return htmlHandler(html)
}

// ── serveDocs ─────────────────────────────────────────────────────────────────

export interface ServeDocsOptions {
  /** Primary UI. Default: 'scalar' */
  ui?:      'scalar' | 'swagger' | 'redoc'
  /** Base path for primary UI. Default: '/docs' (when used with app.use()) */
  title?:   string
  theme?:   'light' | 'dark' | 'auto'
  favicon?: string
  /** Scalar options (when ui: 'scalar') */
  scalar?:  ScalarOptions
  /** Swagger options (when ui: 'swagger') */
  swagger?: SwaggerUIOptions
  /** Redoc options (when ui: 'redoc') */
  redoc?:   RedocOptions
  /** Spec and export endpoints to mount */
  exports?: {
    /** Raw OpenAPI JSON. Default: /openapi.json (relative to mount path) */
    json?:     string | false
    /** Postman Collection v2.1 */
    postman?:  string | false
    /** Insomnia export */
    insomnia?: string | false
    /** Bruno collection */
    bruno?:    string | false
  }
}

/**
 * Mount all documentation endpoints with a single call.
 *
 * Mounts:
 * - Primary UI (Scalar by default)
 * - Raw OpenAPI JSON (/openapi.json)
 * - Optional: Postman, Insomnia, Bruno exports
 *
 * @example
 * // Minimum — Scalar UI + JSON spec
 * app.use('/docs', serveDocs(spec))
 *
 * @example
 * // Full setup
 * app.use('/docs', serveDocs(spec, {
 *   ui: 'scalar',
 *   theme: 'dark',
 *   exports: {
 *     json:     '/docs/openapi.json',
 *     postman:  '/docs/postman.json',
 *     insomnia: '/docs/insomnia.json',
 *   }
 * }))
 */
export function serveDocs(spec: OpenAPISpec, opts: ServeDocsOptions = {}): import('express').Router {
  // We return a mini Express router that mounts all endpoints
  // Avoids requiring express as a hard dep — we import it lazily
  const { Router } = _require('express') as typeof import('express')
  const router = Router()

  const ui     = opts.ui ?? 'scalar'
  const title  = opts.title
  const theme  = opts.theme ?? 'auto'
  const favico = opts.favicon

  // ── Primary UI ─────────────────────────────────────────────────────────────
  if (ui === 'scalar') {
    router.get('/', serveScalar(spec, { title, theme, favicon: favico, ...opts.scalar }))
  } else if (ui === 'swagger') {
    router.get('/', serveSwaggerUI(spec, { title, theme, favicon: favico, ...opts.swagger }))
  } else if (ui === 'redoc') {
    router.get('/', serveRedoc(spec, { title, favicon: favico, ...opts.redoc }))
  }

  // ── Spec exports ───────────────────────────────────────────────────────────
  const exports_ = opts.exports ?? {}

  // JSON spec — default enabled at /openapi.json
  if (exports_.json !== false) {
    const jsonPath = typeof exports_.json === 'string' ? exports_.json : '/openapi.json'
    // Strip mount prefix if user passed absolute path
    const localPath = jsonPath.replace(/^\/docs/, '') || '/openapi.json'
    router.get(localPath, (_req, res) => res.json(spec))
  }

  // Postman
  if (exports_.postman) {
    const p = exports_.postman.replace(/^\/docs/, '') || '/postman.json'
    router.get(p, (_req, res) => res.json(toPostman(spec)))
  }

  // Insomnia
  if (exports_.insomnia) {
    const p = exports_.insomnia.replace(/^\/docs/, '') || '/insomnia.json'
    router.get(p, (_req, res) => res.json(toInsomnia(spec)))
  }

  // Bruno
  if (exports_.bruno) {
    const p = exports_.bruno.replace(/^\/docs/, '') || '/bruno.json'
    router.get(p, (_req, res) => res.json(toBruno(spec)))
  }

  return router
}

// ── toPostman ─────────────────────────────────────────────────────────────────

/**
 * Convert an OpenAPI 3.1 spec to Postman Collection v2.1 JSON.
 * Pure function — no dependencies, no HTTP, no side effects.
 *
 * @example
 * import { toPostman } from 'shapeguard/openapi'
 * app.get('/docs/postman.json', (_req, res) => res.json(toPostman(spec)))
 */
export function toPostman(spec: OpenAPISpec): Record<string, unknown> {
  const baseUrl = spec.servers?.[0]?.url ?? 'http://localhost:3000'

  const items: unknown[] = []
  for (const [path, methods] of Object.entries(spec.paths ?? {})) {
    for (const [method, op] of Object.entries(methods as Record<string, Record<string, unknown>>)) {
      if (['get','post','put','patch','delete','head','options'].indexOf(method) < 0) continue
      const operation  = op as Record<string, unknown>
      const parameters = (operation['parameters'] as Array<Record<string, unknown>> | undefined) ?? []

      // Build URL with Postman variable syntax for path params
      const postmanPath = path.replace(/\{([^}]+)\}/g, ':$1')
      const queryParams  = parameters
        .filter((p: Record<string, unknown>) => p['in'] === 'query')
        .map((p: Record<string, unknown>) => ({ key: String(p['name']), value: '', disabled: true }))

      const item: Record<string, unknown> = {
        name: String(operation['summary'] ?? `${method.toUpperCase()} ${path}`),
        request: {
          method: method.toUpperCase(),
          header: [{ key: 'Content-Type', value: 'application/json' }],
          url: {
            raw:      `${baseUrl}${postmanPath}${queryParams.length ? '?'+queryParams.map((q: Record<string,unknown>) => `${q['key']}=`).join('&') : ''}`,
            protocol: baseUrl.startsWith('https') ? 'https' : 'http',
            host:     [baseUrl.replace(/^https?:\/\//, '').split('/')[0]],
            path:     postmanPath.split('/').filter(Boolean),
            query:    queryParams,
          },
        },
        response: [],
      }

      // Add body for POST/PUT/PATCH
      if (['post','put','patch'].includes(method)) {
        const rb = operation['requestBody'] as Record<string, unknown> | undefined
        if (rb) {
          const content = rb['content'] as Record<string, Record<string, unknown>> | undefined
          const schema  = content?.['application/json']?.['schema'] as Record<string, unknown> | undefined
          ;(item['request'] as Record<string, unknown>)['body'] = {
            mode: 'raw',
            raw:  schema ? JSON.stringify(buildExample(schema), null, 2) : '{}',
            options: { raw: { language: 'json' } },
          }
        }
      }

      // Auth
      const security = (operation['security'] as Array<Record<string, unknown>> | undefined)
      if (security && security.length > 0 && Object.keys(security[0]!).length > 0) {
        ;(item['request'] as Record<string, unknown>)['auth'] = {
          type: 'bearer',
          bearer: [{ key: 'token', value: '{{bearerToken}}', type: 'string' }],
        }
      }

      items.push(item)
    }
  }

  return {
    info: {
      name:        spec.info?.title ?? 'API',
      description: spec.info?.description ?? '',
      schema:      'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    item: items,
    variable: [
      { key: 'bearerToken', value: '', type: 'string', description: 'JWT Bearer token' },
    ],
  }
}

// ── toInsomnia ────────────────────────────────────────────────────────────────

/**
 * Convert an OpenAPI 3.1 spec to Insomnia export JSON.
 * Pure function — no dependencies.
 *
 * @example
 * app.get('/docs/insomnia.json', (_req, res) => res.json(toInsomnia(spec)))
 */
export function toInsomnia(spec: OpenAPISpec): Record<string, unknown> {
  const baseUrl    = spec.servers?.[0]?.url ?? 'http://localhost:3000'
  const workspaceId = `wrk_${randomBytes(6).toString('hex').slice(0, 10)}`
  const resources: unknown[] = [
    { _id: workspaceId, _type: 'workspace', name: spec.info?.title ?? 'API', description: spec.info?.description ?? '' },
  ]

  for (const [path, methods] of Object.entries(spec.paths ?? {})) {
    for (const [method, op] of Object.entries(methods as Record<string, Record<string, unknown>>)) {
      if (['get','post','put','patch','delete','head','options'].indexOf(method) < 0) continue
      const operation = op as Record<string, unknown>
      const reqId     = `req_${randomBytes(6).toString('hex').slice(0, 10)}`

      const req: Record<string, unknown> = {
        _id:          reqId,
        _type:        'request',
        parentId:     workspaceId,
        name:         String(operation['summary'] ?? `${method.toUpperCase()} ${path}`),
        method:       method.toUpperCase(),
        url:          `${baseUrl}${path}`,
        description:  String(operation['description'] ?? ''),
        headers:      [{ name: 'Content-Type', value: 'application/json' }],
        parameters:   [],
        authentication: {},
        body:         {},
      }

      if (['post','put','patch'].includes(method)) {
        const rb = operation['requestBody'] as Record<string, unknown> | undefined
        if (rb) {
          const content = rb['content'] as Record<string, Record<string, unknown>> | undefined
          const schema  = content?.['application/json']?.['schema'] as Record<string, unknown> | undefined
          req['body'] = { mimeType: 'application/json', text: JSON.stringify(buildExample(schema ?? {}), null, 2) }
        }
      }

      const security = (operation['security'] as Array<Record<string, unknown>> | undefined)
      if (security && security.length > 0 && Object.keys(security[0]!).length > 0) {
        req['authentication'] = { type: 'bearer', token: '{{ bearerToken }}', prefix: 'Bearer' }
      }

      resources.push(req)
    }
  }

  return {
    _type:     'export',
    __export_format: 4,
    __export_date:   new Date().toISOString(),
    __export_source: 'shapeguard',
    resources,
  }
}

// ── toBruno ───────────────────────────────────────────────────────────────────

/**
 * Convert an OpenAPI 3.1 spec to Bruno collection format.
 * Pure function — no dependencies.
 *
 * Bruno stores collections as files in your repo (no cloud sync).
 *
 * @example
 * app.get('/docs/bruno.json', (_req, res) => res.json(toBruno(spec)))
 */
export function toBruno(spec: OpenAPISpec): Record<string, unknown> {
  const baseUrl = spec.servers?.[0]?.url ?? 'http://localhost:3000'

  const items: unknown[] = []
  for (const [path, methods] of Object.entries(spec.paths ?? {})) {
    for (const [method, op] of Object.entries(methods as Record<string, Record<string, unknown>>)) {
      if (['get','post','put','patch','delete'].indexOf(method) < 0) continue
      const operation = op as Record<string, unknown>

      const rb = operation['requestBody'] as Record<string, unknown> | undefined
      const content = rb?.['content'] as Record<string, Record<string, unknown>> | undefined
      const schema  = content?.['application/json']?.['schema'] as Record<string, unknown> | undefined

      const item: Record<string, unknown> = {
        uid:  randomBytes(7).toString('hex').slice(0, 12),
        name: String(operation['summary'] ?? `${method.toUpperCase()} ${path}`),
        type: 'http',
        seq:  items.length + 1,
        request: {
          method: method.toUpperCase(),
          url:    `${baseUrl}${path}`,
          headers: [{ uid: randomBytes(6).toString('hex').slice(0, 10), name: 'Content-Type', value: 'application/json', enabled: true }],
          params:  [],
          body: schema ? { mode: 'json', json: JSON.stringify(buildExample(schema), null, 2) } : { mode: 'none' },
          auth: { mode: 'none' },
          script: { req: '', res: '' },
          tests: '',
        },
      }

      const security = (operation['security'] as Array<Record<string, unknown>> | undefined)
      if (security && security.length > 0 && Object.keys(security[0]!).length > 0) {
        ;(item['request'] as Record<string, unknown>)['auth'] = {
          mode: 'bearer',
          bearer: { token: '' },
        }
      }

      items.push(item)
    }
  }

  return {
    version:  '1',
    name:     spec.info?.title ?? 'API',
    uid:      randomBytes(7).toString('hex').slice(0, 12),
    items,
    environments: [],
  }
}

// ── buildExample — generate example request body from schema ──────────────────

function buildExample(schema: Record<string, unknown>): unknown {
  if (!schema || typeof schema !== 'object') return {}
  const type = schema['type'] as string | undefined
  if (type === 'string')  {
    const fmt = schema['format'] as string | undefined
    if (fmt === 'email')     return 'user@example.com'
    if (fmt === 'uuid')      return '550e8400-e29b-41d4-a716-446655440000'
    if (fmt === 'date-time') return new Date().toISOString()
    if (schema['enum'])      return (schema['enum'] as string[])[0]
    return 'string'
  }
  if (type === 'number' || type === 'integer') return 0
  if (type === 'boolean') return true
  if (type === 'array')   return [buildExample(schema['items'] as Record<string,unknown> ?? {})]
  if (type === 'object' || schema['properties']) {
    const props = schema['properties'] as Record<string, Record<string, unknown>> | undefined
    if (!props) return {}
    const result: Record<string, unknown> = {}
    for (const [key, propSchema] of Object.entries(props)) {
      result[key] = buildExample(propSchema)
    }
    return result
  }
  return {}
}
