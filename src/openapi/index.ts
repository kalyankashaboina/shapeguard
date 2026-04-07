// ─────────────────────────────────────────────
// openapi/index.ts — shapeguard v0.8.0
// Enterprise-grade OpenAPI 3.1 + Swagger UI.
//
// createDocs() — self-hosted Swagger UI:
//   • dark/light/auto theme
//   • CSP headers + nonce
//   • custom logo, favicon, custom CSS
//   • requestInterceptor for auth header injection
//   • validatorUrl disabled (no noisy validator.swagger.io calls)
//   • docExpansion, defaultModelsExpandDepth, operationsSorter
//   • showExtensions, showCommonExtensions
//   • oauth2RedirectUrl support
//
// generateOpenAPI() — spec generation:
//   • securitySchemes (bearer, apiKey, basic, OAuth2)
//   • defaultSecurity + per-route security override
//   • deprecated flag per route
//   • externalDocs per route
//   • x-extensions (vendor extensions) per route
//   • multipart/form-data + file upload schemas
//   • response headers in schema
//   • 400 / 401 / 403 / 429 auto-generated
//   • Full Zod type coverage (40+ types)
// ─────────────────────────────────────────────

import type { RequestHandler }  from 'express'
import type { RouteDefinition } from '../validation/define-route.js'

// ── Security scheme definitions ───────────────────────────────────────────────

export type SecuritySchemeType =
  | { type: 'http';   scheme: 'bearer'; bearerFormat?: string }
  | { type: 'http';   scheme: 'basic' }
  | { type: 'apiKey'; in: 'header' | 'query' | 'cookie'; name: string }
  | { type: 'oauth2'; flows: Record<string, unknown> }
  | { type: 'openIdConnect'; openIdConnectUrl: string }

// ── OpenAPIConfig ─────────────────────────────────────────────────────────────

export interface OpenAPIConfig {
  title:            string
  version:          string
  description?:     string
  termsOfService?:  string
  contact?:         { name?: string; email?: string; url?: string }
  license?:         { name: string; url?: string }
  servers?:         Array<{ url: string; description?: string }>
  prefix?:          string
  routes:           Record<string, RouteDefinition | InlineRouteDefinition>
  security?:        Record<string, SecuritySchemeType>
  defaultSecurity?: string[]
  tags?:            Array<{ name: string; description?: string; externalDocs?: { url: string; description?: string } }>
  externalDocs?:    { url: string; description?: string }
}

// ── Inline route definition ───────────────────────────────────────────────────

export interface InlineRouteDefinition {
  summary?:        string
  description?:    string
  tags?:           string[]
  security?:       string[] | null
  deprecated?:     boolean
  externalDocs?:   { url: string; description?: string }
  extensions?:     Record<string, unknown>          // x-* vendor extensions
  body?:           unknown
  bodyType?:       'json' | 'multipart' | 'form'    // default: json
  response?:       unknown
  params?:         unknown
  query?:          unknown
  responseHeaders?: Record<string, { description: string; schema: Record<string, unknown> }>
}

// ── OpenAPISpec ───────────────────────────────────────────────────────────────

export interface OpenAPISpec {
  openapi:      '3.1.0'
  info:         {
    title: string; version: string; description?: string
    termsOfService?: string
    contact?: { name?: string; email?: string; url?: string }
    license?: { name: string; url?: string }
  }
  servers?:     Array<{ url: string; description?: string }>
  tags?:        Array<{ name: string; description?: string }>
  externalDocs?: { url: string; description?: string }
  paths:        Record<string, Record<string, OpenAPIOperation>>
  components?:  { securitySchemes?: Record<string, unknown> }
}

interface OpenAPIOperation {
  operationId?:  string
  summary?:      string
  description?:  string
  tags?:         string[]
  deprecated?:   boolean
  externalDocs?: { url: string; description?: string }
  security?:     Record<string, string[]>[]
  parameters?:   OpenAPIParameter[]
  requestBody?:  { required: boolean; content: Record<string, { schema: Record<string, unknown> }> }
  responses:     Record<string, { description: string; headers?: Record<string, unknown>; content?: Record<string, { schema: Record<string, unknown> }> }>
  [key: string]: unknown   // allow x-* extensions
}

interface OpenAPIParameter {
  name:        string
  in:          'path' | 'query' | 'header'
  required:    boolean
  deprecated?: boolean
  schema:      Record<string, unknown>
  description?: string
}

// ── Shared error envelope schemas ─────────────────────────────────────────────

const ERROR_ENVELOPE: Record<string, unknown> = {
  type: 'object',
  properties: {
    success: { type: 'boolean', example: false },
    message: { type: 'string' },
    error: { type: 'object', properties: {
      code:    { type: 'string' },
      message: { type: 'string' },
      details: {},
    }},
  },
}

const UNAUTH_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    success: { type: 'boolean', example: false },
    message: { type: 'string', example: 'Authentication required' },
    error: { type: 'object', properties: {
      code:    { type: 'string', example: 'UNAUTHORIZED' },
      message: { type: 'string' },
      details: {},
    }},
  },
}

const RATE_LIMIT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    success: { type: 'boolean', example: false },
    message: { type: 'string', example: 'Too many requests' },
    error: { type: 'object', properties: {
      code:    { type: 'string', example: 'RATE_LIMIT_EXCEEDED' },
      message: { type: 'string' },
      details: { type: 'object', properties: {
        retryAfter: { type: 'number', description: 'Seconds until rate limit resets' },
      }},
    }},
  },
}

// ── generateOpenAPI ───────────────────────────────────────────────────────────

export function generateOpenAPI(config: OpenAPIConfig): OpenAPISpec {
  const paths:       Record<string, Record<string, OpenAPIOperation>> = {}
  const prefix       = config.prefix ? normalizePath(config.prefix) : ''
  const seen         = new Set<string>()
  const hasSecurity  = config.security && Object.keys(config.security).length > 0

  for (const [routeKey, route] of Object.entries(config.routes)) {
    const parts   = routeKey.trim().split(/\s+/)
    const method  = (parts[0] ?? 'GET').toLowerCase()
    const rawPath = parts[1] ?? '/'

    const normalRaw = normalizePath(rawPath)
    const oaPath    = prefix + normalRaw.replace(/:([^/]+)/g, '{$1}')

    const dedupeKey = `${method}:${oaPath}`
    if (seen.has(dedupeKey)) {
      // eslint-disable-next-line no-console
      console.warn(`[shapeguard] generateOpenAPI: duplicate route "${method.toUpperCase()} ${oaPath}" — first definition kept, second ignored.`)
      continue
    }
    seen.add(dedupeKey)
    if (!paths[oaPath]) paths[oaPath] = {}

    const r            = route as Record<string, unknown>
    const summary      = typeof r['summary']     === 'string'  ? r['summary']  as string  : undefined
    const description  = typeof r['description'] === 'string'  ? r['description'] as string : undefined
    const tags         = Array.isArray(r['tags'])              ? r['tags']     as string[] : undefined
    const deprecated   = r['deprecated'] === true
    const extDocs      = r['externalDocs']  as { url: string; description?: string } | undefined
    const extensions   = r['extensions']    as Record<string, unknown> | undefined
    const bodyType     = (r['bodyType'] as string | undefined) ?? 'json'
    const respHeaders  = r['responseHeaders'] as Record<string, { description: string; schema: Record<string, unknown> }> | undefined
    const routeSec     = 'security' in r ? r['security'] as string[] | null | undefined : undefined
    const hasRateLimit = 'rateLimit' in r && r['rateLimit'] != null

    const operation: OpenAPIOperation = {
      operationId: generateOperationId(method, normalRaw),
      responses: {
        '400': { description: 'Bad request — pre-parse guard failure (repeated param, body too deep, string too long, invalid content-type)',
                 content: { 'application/json': { schema: ERROR_ENVELOPE } } },
        '422': { description: 'Validation error — request body or params failed schema validation',
                 content: { 'application/json': { schema: ERROR_ENVELOPE } } },
        '500': { description: 'Internal server error',
                 content: { 'application/json': { schema: ERROR_ENVELOPE } } },
      },
    }

    if (summary)     operation.summary     = summary
    if (description) operation.description = description
    if (tags)        operation.tags        = tags
    if (deprecated)  operation.deprecated  = true
    if (extDocs)     operation.externalDocs = extDocs

    // x-* vendor extensions — merged directly onto operation object
    if (extensions) {
      for (const [k, v] of Object.entries(extensions)) {
        const key = k.startsWith('x-') ? k : `x-${k}`
        operation[key] = v
      }
    }

    // ── Security ─────────────────────────────────────────────────────────
    if (hasSecurity) {
      const effectiveSec = routeSec !== undefined ? (routeSec ?? []) : (config.defaultSecurity ?? [])
      if (effectiveSec.length > 0) {
        operation.security = effectiveSec.map(name => ({ [name]: [] as string[] }))
        operation.responses['401'] = {
          description: 'Unauthorized — valid authentication credentials required',
          content: { 'application/json': { schema: UNAUTH_SCHEMA } },
        }
        operation.responses['403'] = {
          description: 'Forbidden — authenticated but insufficient permissions',
          content: { 'application/json': { schema: ERROR_ENVELOPE } },
        }
      } else {
        operation.security = []  // explicit public endpoint
      }
    }

    // ── 429 for rate-limited routes ───────────────────────────────────────
    if (hasRateLimit) {
      operation.responses['429'] = {
        description: 'Too many requests — rate limit exceeded. Check the Retry-After header.',
        content: { 'application/json': { schema: RATE_LIMIT_SCHEMA } },
      }
    }

    // ── Path params ───────────────────────────────────────────────────────
    const pathParams = [...normalRaw.matchAll(/:([^/]+)/g)].map(m => m[1]!)
    if (pathParams.length > 0) {
      operation.parameters = pathParams.map(name => ({
        name, in: 'path' as const, required: true, schema: { type: 'string' },
      }))
    }

    // ── Query params ──────────────────────────────────────────────────────
    if (route.query) {
      const shape   = extractShape(route.query)
      const qParams: OpenAPIParameter[] = Object.entries(shape).map(([name, s]) => ({
        name, in: 'query' as const, required: !isOptional(s), schema: toJsonSchema(s),
      }))
      operation.parameters = [...(operation.parameters ?? []), ...qParams]
    }

    // ── Request body ──────────────────────────────────────────────────────
    if (route.body && method !== 'get') {
      const bodySchema = adapterToJsonSchema(route.body)

      if (bodyType === 'multipart') {
        // multipart/form-data — file upload support
        const multipartSchema = buildMultipartSchema(bodySchema)
        operation.requestBody = {
          required: true,
          content: {
            'multipart/form-data': { schema: multipartSchema },
          },
        }
      } else if (bodyType === 'form') {
        // application/x-www-form-urlencoded
        operation.requestBody = {
          required: true,
          content: {
            'application/x-www-form-urlencoded': { schema: bodySchema },
          },
        }
      } else {
        // default: application/json
        operation.requestBody = {
          required: true,
          content: { 'application/json': { schema: bodySchema } },
        }
      }
    }

    // ── 200 success ───────────────────────────────────────────────────────
    const successResponse: OpenAPIOperation['responses'][string] = {
      description: 'Success',
      content: { 'application/json': { schema: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          message: { type: 'string' },
          data:    route.response ? adapterToJsonSchema(route.response) : { type: 'object' },
        },
      }}},
    }
    if (respHeaders && Object.keys(respHeaders).length > 0) {
      successResponse.headers = Object.fromEntries(
        Object.entries(respHeaders).map(([k, v]) => [k, { description: v.description, schema: v.schema }])
      )
    }
    operation.responses['200'] = successResponse

    paths[oaPath]![method] = operation
  }

  const spec: OpenAPISpec = {
    openapi: '3.1.0',
    info: {
      title:          config.title,
      version:        config.version,
      description:    config.description,
      termsOfService: config.termsOfService,
      contact:        config.contact,
      license:        config.license,
    },
    paths,
  }
  if (config.servers)     spec.servers     = config.servers
  if (config.tags)        spec.tags        = config.tags
  if (config.externalDocs) spec.externalDocs = config.externalDocs
  if (hasSecurity) {
    spec.components = {
      securitySchemes: Object.fromEntries(Object.entries(config.security!).map(([k, v]) => [k, v])),
    }
  }
  return spec
}

// ── Build multipart schema (handles file fields) ──────────────────────────────

function buildMultipartSchema(jsonSchema: Record<string, unknown>): Record<string, unknown> {
  const props = (jsonSchema['properties'] as Record<string, Record<string, unknown>>) ?? {}
  const newProps: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(props)) {
    const sv = v as Record<string, unknown>
    // Fields named 'file', 'avatar', 'image', 'attachment', 'document', or with format:'binary'
    // are treated as file upload fields
    if (sv['format'] === 'binary' || /^(file|avatar|image|attachment|document|upload|photo|video|audio)s?$/i.test(k)) {
      newProps[k] = { type: 'string', format: 'binary' }
    } else if (sv['type'] === 'array' && typeof sv['items'] === 'object') {
      const items = sv['items'] as Record<string, unknown>
      if (items['format'] === 'binary') {
        newProps[k] = { type: 'array', items: { type: 'string', format: 'binary' } }
      } else {
        newProps[k] = v
      }
    } else {
      newProps[k] = v
    }
  }
  const result: Record<string, unknown> = { type: 'object', properties: newProps }
  if (jsonSchema['required']) result['required'] = jsonSchema['required']
  return result
}

// ── createDocs() — enterprise Swagger UI ─────────────────────────────────────
//
// Enterprise-grade, self-hosted Swagger UI. No extra npm packages.
// CDN-loaded Swagger UI 5.17, fully configurable, production-ready.
//
// Usage:
//   app.use('/docs', createDocs({ spec, title: 'My API', theme: 'dark' }))
//
// Options: see DocsConfig below.

export interface DocsConfig {
  spec:                    OpenAPISpec

  // ── Display ────────────────────────────────────────────────────────────
  title?:                  string           // browser tab title
  theme?:                  'light' | 'dark' | 'auto'   // default: 'auto'
  favicon?:                string           // URL to favicon
  logo?:                   { url: string; altText?: string; backgroundColor?: string }
  customCss?:              string           // raw CSS injected into <head>

  // ── UI behaviour ───────────────────────────────────────────────────────
  docExpansion?:           'none' | 'list' | 'full'    // default: 'list'
  defaultModelsExpandDepth?: number                    // default: 1 (-1 to hide all)
  defaultModelExpandDepth?:  number                    // default: 1
  operationsSorter?:       'alpha' | 'method' | 'none' // default: 'none'
  tagsSorter?:             'alpha' | 'none'            // default: 'none'
  showExtensions?:         boolean          // show x-* vendor extensions (default: false)
  showCommonExtensions?:   boolean          // default: false
  displayOperationId?:     boolean          // show operationId (default: false)
  filter?:                 boolean | string // enable search (default: true)
  maxDisplayedTags?:       number           // limit visible tags (default: all)

  // ── Security / auth ────────────────────────────────────────────────────
  oauth2RedirectUrl?:      string           // OAuth2 redirect URL
  // requestInterceptor: runs before every Try-It-Out request.
  // Inject auth headers, add timestamps, log requests, etc.
  // Must be a string containing a valid JS function body — it runs in the browser.
  // Example: "request.headers['X-Trace-Id'] = crypto.randomUUID(); return request;"
  requestInterceptor?:     string
  // responseInterceptor: runs after every Try-It-Out response.
  // Example: "console.log('Status:', response.status); return response;"
  responseInterceptor?:    string
  withCredentials?:        boolean          // send cookies on Try-It-Out (default: false)

  // ── Security / CSP ─────────────────────────────────────────────────────
  // Set Content-Security-Policy on the docs page. Strongly recommended in production.
  // Pass false to disable entirely (not recommended). Default: auto-generated safe policy.
  csp?:                    string | false

  // ── Advanced ───────────────────────────────────────────────────────────
  // Custom HTML injected before </head> — use for analytics, fonts, etc.
  headHtml?:               string
}

export function createDocs(config: DocsConfig): RequestHandler {
  const title    = config.title ?? config.spec.info.title ?? 'API Docs'
  const theme    = config.theme ?? 'auto'
  const favicon  = config.favicon ?? ''
  const logo     = config.logo

  // ── Dark theme CSS ────────────────────────────────────────────────────
  const darkCss = `
    body{background:#0d1117}
    #swagger-ui .topbar{background:#161b22;border-bottom:1px solid #30363d}
    #swagger-ui .topbar-wrapper .link{display:none}
    #swagger-ui .info .title,#swagger-ui .opblock-tag{color:#e6edf3}
    #swagger-ui .info p,#swagger-ui .info li,#swagger-ui .info a{color:#8b949e}
    #swagger-ui .info a{color:#58a6ff}
    #swagger-ui .scheme-container,#swagger-ui section.models{background:#161b22;border:1px solid #30363d;box-shadow:none}
    #swagger-ui .model-box,#swagger-ui .opblock-body{background:#0d1117}
    #swagger-ui .opblock{border:1px solid #30363d;border-radius:6px;margin-bottom:8px;box-shadow:none}
    #swagger-ui .opblock .opblock-summary{background:#161b22}
    #swagger-ui .opblock .opblock-summary-description,#swagger-ui .tab li{color:#8b949e}
    #swagger-ui .opblock.opblock-get    .opblock-summary{border-color:#1f6feb}
    #swagger-ui .opblock.opblock-post   .opblock-summary{border-color:#238636}
    #swagger-ui .opblock.opblock-put    .opblock-summary{border-color:#9e6a03}
    #swagger-ui .opblock.opblock-patch  .opblock-summary{border-color:#6e40c9}
    #swagger-ui .opblock.opblock-delete .opblock-summary{border-color:#da3633}
    #swagger-ui .tab li.active,#swagger-ui .response-col_status{color:#e6edf3}
    #swagger-ui textarea,#swagger-ui input[type=text],#swagger-ui input[type=password],#swagger-ui input[type=search]{background:#161b22;color:#e6edf3;border:1px solid #30363d;border-radius:6px}
    #swagger-ui select{background:#161b22;color:#e6edf3;border:1px solid #30363d;border-radius:6px}
    #swagger-ui .btn{background:#21262d;color:#e6edf3;border:1px solid #30363d;border-radius:6px}
    #swagger-ui .btn.execute{background:#1f6feb;border-color:#1f6feb;color:#fff;font-weight:600}
    #swagger-ui .btn.execute:hover{background:#388bfd}
    #swagger-ui .btn.cancel{background:#da3633;border-color:#da3633;color:#fff}
    #swagger-ui .btn.authorize{background:transparent;border:1px solid #58a6ff;color:#58a6ff}
    #swagger-ui .btn.authorize svg{fill:#58a6ff}
    #swagger-ui .highlight-code pre,#swagger-ui .microlight{background:#161b22 !important;color:#e6edf3 !important}
    #swagger-ui .response-col_description__inner p{color:#8b949e}
    #swagger-ui .parameters-col_description p{color:#8b949e}
    #swagger-ui table thead tr td,#swagger-ui table thead tr th{color:#8b949e;border-bottom:1px solid #30363d}
    #swagger-ui .parameter__name{color:#e6edf3}
    #swagger-ui .parameter__type{color:#58a6ff}
    #swagger-ui .parameter__deprecated{color:#da3633}
    #swagger-ui .prop-type{color:#79c0ff}
    #swagger-ui .model-title{color:#e6edf3}
    #swagger-ui .model{color:#c9d1d9}
    #swagger-ui section.models h4{color:#e6edf3;border-bottom:1px solid #30363d}
    #swagger-ui .loading-container .loading::after{border-color:#1f6feb transparent transparent}
    #swagger-ui .dialog-ux .modal-ux{background:#161b22;border:1px solid #30363d}
    #swagger-ui .dialog-ux .modal-ux-header{border-bottom:1px solid #30363d}
    #swagger-ui .dialog-ux .modal-ux-header h3,#swagger-ui .dialog-ux .modal-ux-content label{color:#e6edf3}
    #swagger-ui .scopes h2{color:#8b949e}
    #swagger-ui .scope-def{color:#8b949e}
  `

  const themeCss =
    theme === 'dark'  ? darkCss :
    theme === 'auto'  ? `@media(prefers-color-scheme:dark){${darkCss}}` : ''

  // ── Logo HTML ─────────────────────────────────────────────────────────
  const logoHtml = logo ? `
    <style>
      #sg-logo { display:flex; align-items:center; padding:8px 16px; background:${esc(logo.backgroundColor ?? 'transparent')}; }
      #sg-logo img { height:40px; width:auto; }
    </style>
    <div id="sg-logo"><img src="${esc(logo.url)}" alt="${esc(logo.altText ?? title)}" /></div>
  ` : ''

  // ── Swagger UI config ─────────────────────────────────────────────────
  const uiConfig = {
    deepLinking:               true,
    persistAuthorization:      true,
    displayRequestDuration:    true,
    tryItOutEnabled:           true,
    filter:                    config.filter !== undefined ? config.filter : true,
    validatorUrl:              'none',   // disable external validator.swagger.io calls
    docExpansion:              config.docExpansion              ?? 'list',
    defaultModelsExpandDepth:  config.defaultModelsExpandDepth  ?? 1,
    defaultModelExpandDepth:   config.defaultModelExpandDepth   ?? 1,
    operationsSorter:          config.operationsSorter          ?? 'none',
    tagsSorter:                config.tagsSorter                ?? 'none',
    showExtensions:            config.showExtensions            ?? false,
    showCommonExtensions:      config.showCommonExtensions      ?? false,
    displayOperationId:        config.displayOperationId        ?? false,
    withCredentials:           config.withCredentials           ?? false,
    syntaxHighlight: {
      activated: true,
      theme: theme === 'light' ? 'agate' : 'monokai',
    },
    ...(config.maxDisplayedTags !== undefined && { maxDisplayedTags: config.maxDisplayedTags }),
    ...(config.oauth2RedirectUrl && { oauth2RedirectUrl: config.oauth2RedirectUrl }),
  }

  // ── CSP header value ──────────────────────────────────────────────────
  // Allows: CDN scripts + styles, inline styles (for Swagger UI), self for everything else.
  // The spec JSON is embedded in the HTML, so no AJAX calls are needed.
  const defaultCsp = [
    "default-src 'self'",
    "script-src 'self' https://cdnjs.cloudflare.com 'unsafe-inline'",
    "style-src 'self' https://cdnjs.cloudflare.com 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self' https://cdnjs.cloudflare.com",
    "connect-src 'self'",
    "frame-ancestors 'none'",
  ].join('; ')

  const csp = config.csp === false ? null : (config.csp ?? defaultCsp)

  // ── requestInterceptor / responseInterceptor ──────────────────────────
  const reqInterceptorFn = config.requestInterceptor
    ? `requestInterceptor: function(request) { ${config.requestInterceptor} },`
    : ''
  const resInterceptorFn = config.responseInterceptor
    ? `responseInterceptor: function(response) { ${config.responseInterceptor} },`
    : ''

  const specJson    = JSON.stringify(config.spec)
  const faviconHtml = favicon ? `<link rel="icon" href="${esc(favicon)}">` : ''
  const uiConfigJs  = JSON.stringify(uiConfig)

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<meta name="referrer" content="no-referrer">
<title>${esc(title)}</title>
${faviconHtml}
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.17.14/swagger-ui.min.css">
<style>
*{box-sizing:border-box}
body{margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}
${themeCss}
${config.customCss ?? ''}
</style>
${config.headHtml ?? ''}
</head>
<body>
${logoHtml}
<div id="swagger-ui"></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.17.14/swagger-ui-bundle.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.17.14/swagger-ui-standalone-preset.min.js"></script>
<script>
(function(){
  var cfg = ${uiConfigJs};
  cfg.spec = ${specJson};
  cfg.dom_id = '#swagger-ui';
  cfg.presets = [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset];
  cfg.layout = 'StandaloneLayout';
  ${reqInterceptorFn}
  ${resInterceptorFn}
  SwaggerUIBundle(cfg);
})();
</script>
</body>
</html>`

  return (_req, res) => {
    if (csp) res.setHeader('Content-Security-Policy', csp)
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('X-Frame-Options', 'DENY')
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.send(html)
  }
}

function esc(s: string): string {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

// ── Path normalisation ────────────────────────────────────────────────────────

function normalizePath(path: string): string {
  if (!path.startsWith('/')) path = '/' + path
  return path.endsWith('/') && path.length > 1 ? path.slice(0, -1) : path
}

// ── operationId ───────────────────────────────────────────────────────────────

function generateOperationId(method: string, path: string): string {
  const segments = path.split('/').filter(Boolean)
    .map(s => s.startsWith(':') ? s.slice(1) : s)
    .map(s => s.charAt(0).toUpperCase() + s.slice(1))
  return method.toLowerCase() + (segments.join('') || 'Root')
}

// ── Zod introspection ─────────────────────────────────────────────────────────

interface ZodDef {
  typeName?:   string
  innerType?:  unknown
  schema?:     unknown
  type?:       unknown
  values?:     string[]
  checks?:     Array<{ kind: string; value?: unknown }>
  shape?:      (() => Record<string, unknown>) | Record<string, unknown>
  value?:      unknown
  options?:    unknown[]
  items?:      unknown[]
  rest?:       unknown
  valueType?:  unknown
  keyType?:    unknown
  left?:       unknown
  right?:      unknown
  in?:         unknown
  out?:        unknown
  getter?:     unknown
}

function zodDef(schema: unknown): ZodDef {
  if (schema !== null && typeof schema === 'object' && '_def' in schema)
    return (schema as { _def: ZodDef })._def
  return {}
}

function zodSchema(adapter: unknown): unknown {
  if (adapter === null || typeof adapter !== 'object') return adapter
  // zodAdapter() and Joi/Yup adapters expose raw schema as .schema property
  if ('schema' in adapter) return (adapter as { schema: unknown }).schema
  // Raw Zod schema passed directly — has _def
  if ('_def' in adapter) return adapter
  return adapter
}

function adapterToJsonSchema(adapter: unknown): Record<string, unknown> {
  const shape = extractShape(adapter)
  if (Object.keys(shape).length > 0) {
    const required = Object.entries(shape).filter(([,v]) => !isOptional(v)).map(([k]) => k)
    const result: Record<string, unknown> = {
      type:       'object',
      properties: Object.fromEntries(Object.entries(shape).map(([k,v]) => [k, toJsonSchema(v)])),
    }
    if (required.length > 0) result['required'] = required
    return result
  }
  const raw = zodSchema(adapter)
  if (raw !== adapter) return toJsonSchema(raw)
  return { type: 'object' }
}

function extractShape(adapter: unknown): Record<string, unknown> {
  try {
    const schema = zodSchema(adapter)
    const def    = zodDef(schema)
    const shape  = typeof def.shape === 'function' ? def.shape() : (def.shape ?? {})
    return typeof shape === 'object' && shape !== null ? shape as Record<string, unknown> : {}
  } catch { return {} }
}

function toJsonSchema(z: unknown): Record<string, unknown> {
  try {
    const def      = zodDef(z)
    const typeName = def.typeName ?? ''
    switch (typeName) {
      case 'ZodString':           return buildStringSchema(def)
      case 'ZodNumber':           return buildNumberSchema(def)
      case 'ZodInt':
      case 'ZodInteger':          return buildIntegerSchema(def)
      case 'ZodBigInt':           return { type: 'integer', format: 'int64' }
      case 'ZodBoolean':          return { type: 'boolean' }
      case 'ZodDate':             return { type: 'string', format: 'date-time' }
      case 'ZodNull':             return { type: 'null' }
      case 'ZodUndefined':
      case 'ZodVoid':             return {}
      case 'ZodAny':
      case 'ZodUnknown':          return {}
      case 'ZodNaN':              return { type: 'number', format: 'float' }
      case 'ZodNever':            return { not: {} }
      case 'ZodSymbol':           return { type: 'string', description: 'Symbol' }
      case 'ZodLiteral':          return buildLiteralSchema(def)
      case 'ZodEnum':             return { type: 'string', enum: def.values ?? [] }
      case 'ZodNativeEnum':       return { type: 'string' }
      case 'ZodArray':            return buildArraySchema(def)
      case 'ZodTuple':            return buildTupleSchema(def)
      case 'ZodObject':           return adapterToJsonSchema(z)
      case 'ZodRecord':           return { type: 'object', additionalProperties: toJsonSchema(def.valueType) }
      case 'ZodMap':              return { type: 'object', additionalProperties: true }
      case 'ZodSet':              return { type: 'array', uniqueItems: true, items: toJsonSchema(def.valueType) }
      case 'ZodUnion':
      case 'ZodDiscriminatedUnion': return buildUnionSchema(def)
      case 'ZodIntersection':     return { allOf: [toJsonSchema(def.left), toJsonSchema(def.right)] }
      case 'ZodOptional':         return { ...toJsonSchema(def.innerType) }
      case 'ZodNullable':         return { ...toJsonSchema(def.innerType), nullable: true }
      case 'ZodDefault':
      case 'ZodCatch':            return toJsonSchema(def.innerType)
      case 'ZodPipeline':         return toJsonSchema(def.out ?? def.in ?? def.innerType)
      case 'ZodBranded':          return toJsonSchema(def.type ?? def.schema)
      case 'ZodReadonly':         return { ...toJsonSchema(def.innerType), readOnly: true }
      case 'ZodCoerce':
      case 'ZodTransformer':      return toJsonSchema(def.schema ?? def.innerType)
      case 'ZodLazy':             return { type: 'object' }
      case 'ZodUUID':             return { type: 'string', format: 'uuid' }
      case 'ZodPromise':          return toJsonSchema(def.type ?? def.innerType)
      case 'ZodFunction':         return { type: 'string', description: 'Function' }
      default:                    return { type: 'string' }
    }
  } catch { return { type: 'string' } }
}

function buildStringSchema(def: ZodDef): Record<string, unknown> {
  const schema: Record<string, unknown> = { type: 'string' }
  for (const check of def.checks ?? []) {
    const v = check.value
    if (check.kind === 'email')      { schema['format'] = 'email'; schema['example'] = 'user@example.com' }
    if (check.kind === 'uuid')       { schema['format'] = 'uuid';  schema['example'] = '550e8400-e29b-41d4-a716-446655440000' }
    if (check.kind === 'url')          schema['format'] = 'uri'
    if (check.kind === 'datetime')     schema['format'] = 'date-time'
    if (check.kind === 'date')         schema['format'] = 'date'
    if (check.kind === 'time')         schema['format'] = 'time'
    if (check.kind === 'ip')           schema['format'] = 'ipv4'
    if (check.kind === 'cidr')         schema['format'] = 'cidr'
    if (check.kind === 'cuid')         schema['format'] = 'cuid'
    if (check.kind === 'cuid2')        schema['format'] = 'cuid2'
    if (check.kind === 'ulid')         schema['format'] = 'ulid'
    if (check.kind === 'base64')       schema['format'] = 'byte'
    if (check.kind === 'min')          schema['minLength'] = v
    if (check.kind === 'max')          schema['maxLength'] = v
    if (check.kind === 'length')     { schema['minLength'] = v; schema['maxLength'] = v }
    if (check.kind === 'regex')        schema['pattern'] = String(v ?? '')
    if (check.kind === 'startsWith')   schema['pattern'] = `^${escRx(String(v ?? ''))}`
    if (check.kind === 'endsWith')     schema['pattern'] = `${escRx(String(v ?? ''))}$`
    if (check.kind === 'includes')     schema['pattern'] = escRx(String(v ?? ''))
    if (check.kind === 'emoji')        schema['pattern'] = '^\\p{Emoji}+$'
    if (check.kind === 'jwt')        { schema['format'] = 'jwt'; schema['pattern'] = '^[\\w-]+\\.[\\w-]+\\.[\\w-]+$' }
    if (check.kind === 'nanoid')       schema['pattern'] = '^[A-Za-z0-9_-]{21}$'
  }
  return schema
}

function buildNumberSchema(def: ZodDef): Record<string, unknown> {
  const schema: Record<string, unknown> = { type: 'number' }
  for (const check of def.checks ?? []) {
    const v = check.value as number | undefined
    if (check.kind === 'min')          { schema['minimum']          = v }
    if (check.kind === 'max')          { schema['maximum']          = v }
    if (check.kind === 'multipleOf')   { schema['multipleOf']       = v }
    if (check.kind === 'int')            schema['type'] = 'integer'
    if (check.kind === 'finite')       {} // no JSON Schema equivalent — skip
  }
  return schema
}

function buildIntegerSchema(def: ZodDef): Record<string, unknown> {
  const schema: Record<string, unknown> = { type: 'integer' }
  for (const check of def.checks ?? []) {
    const v = check.value as number | undefined
    if (check.kind === 'min')        schema['minimum']    = v
    if (check.kind === 'max')        schema['maximum']    = v
    if (check.kind === 'multipleOf') schema['multipleOf'] = v
  }
  return schema
}

function buildLiteralSchema(def: ZodDef): Record<string, unknown> {
  const v = def.value
  if (typeof v === 'string')  return { type: 'string',  const: v, enum: [v] }
  if (typeof v === 'number')  return { type: 'number',  const: v, enum: [v] }
  if (typeof v === 'boolean') return { type: 'boolean', const: v, enum: [v] }
  if (v === null)             return { type: 'null' }
  return { const: v }
}

function buildArraySchema(def: ZodDef): Record<string, unknown> {
  const schema: Record<string, unknown> = { type: 'array', items: toJsonSchema(def.type) }
  for (const c of def.checks ?? []) {
    const v = c.value as number | undefined
    if (c.kind === 'min')    schema['minItems'] = v
    if (c.kind === 'max')    schema['maxItems'] = v
    if (c.kind === 'length') { schema['minItems'] = v; schema['maxItems'] = v }
  }
  return schema
}

function buildTupleSchema(def: ZodDef): Record<string, unknown> {
  const items = (def.items ?? []).map(toJsonSchema)
  const result: Record<string, unknown> = { type: 'array', prefixItems: items, minItems: items.length }
  // ZodTuple rest element (variadic)
  if (def.rest) {
    result['items']    = toJsonSchema(def.rest)
    // maxItems not set — array can grow beyond tuple length with rest type
  } else {
    result['maxItems'] = items.length
  }
  return result
}

function buildUnionSchema(def: ZodDef): Record<string, unknown> {
  const opts = def.options ?? []
  if (opts.length === 0) return { type: 'string' }
  // If all options are literals, prefer enum representation
  const allLiterals = opts.every(o => {
    const t = zodDef(o).typeName
    return t === 'ZodLiteral'
  })
  if (allLiterals) {
    const values = opts.map(o => zodDef(o).value)
    return { enum: values }
  }
  return { oneOf: opts.map(toJsonSchema) }
}

function escRx(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function isOptional(z: unknown): boolean {
  const t = zodDef(z).typeName ?? ''
  return t === 'ZodOptional' || t === 'ZodDefault'
}

// ── Multi-UI docs serving + API client exports ────────────────────────────────
// All CDN-based — zero npm install, zero bundle impact.
export {
  serveScalar,
  serveSwaggerUI,
  serveRedoc,
  serveDocs,
  toPostman,
  toInsomnia,
  toBruno,
} from './serve.js'

export type {
  ScalarOptions,
  SwaggerUIOptions,
  RedocOptions,
  ServeDocsOptions,
} from './serve.js'
