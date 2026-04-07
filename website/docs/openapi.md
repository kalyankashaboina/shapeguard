---
sidebar_label: "Openapi"
---

# OpenAPI — shapeguard

> Auto-generate an OpenAPI 3.1 spec from your `defineRoute()` definitions.
> No manual schema duplication — your route definitions ARE the spec.

---



## Choosing a UI

All UIs load from CDN — no npm install, no bundle impact. Pick the one that fits your team.

| UI | Best for | Features |
|---|---|---|
| **Scalar** (default) | Internal + external docs | Code snippets, persistent auth, dark mode, search |
| **Swagger UI** | Teams already using Swagger | Try-it-out, enhanced with snippets + dark mode |
| **Redoc** | Public developer portals | Clean three-panel layout (Stripe, Twilio style) |

```ts
import { serveScalar, serveSwaggerUI, serveRedoc, serveDocs } from 'shapeguard/openapi'

// Scalar — modern, beautiful (default choice)
app.use('/docs', serveScalar(spec))

// Swagger UI — classic, enhanced
app.use('/docs', serveSwaggerUI(spec, { theme: 'dark', snippets: true, persist: true }))

// Redoc — read-only public portal
app.use('/api-reference', serveRedoc(spec))

// serveDocs — mount everything at once
app.use('/docs', serveDocs(spec, {
  ui: 'scalar',
  exports: {
    json:     '/docs/openapi.json',    // raw spec (Postman import, SDK generators)
    postman:  '/docs/postman.json',    // Postman Collection v2.1
    insomnia: '/docs/insomnia.json',   // Insomnia v4 export
    bruno:    '/docs/bruno.json',      // Bruno collection
  }
}))
```

## API client exports

Export your spec to any API client — pure functions, no dependencies:

```ts
import { toPostman, toInsomnia, toBruno } from 'shapeguard/openapi'

// Serve as URL — teammates import directly into their client
app.get('/docs/postman.json',  (_req, res) => res.json(toPostman(spec)))
app.get('/docs/insomnia.json', (_req, res) => res.json(toInsomnia(spec)))
app.get('/docs/bruno.json',    (_req, res) => res.json(toBruno(spec)))

// Or download and commit to repo
import { writeFileSync } from 'fs'
writeFileSync('postman.json', JSON.stringify(toPostman(spec), null, 2))
```

**Postman import:** Team Settings → Import → Link → paste `/docs/postman.json` URL → always up to date.

## Logger in your app

```ts
import { logger } from 'shapeguard'

// Use anywhere — controllers, services, cron jobs
logger.info('Server started on port 3000')
logger.info({ userId }, 'User logged in')
logger.warn({ attempts: 3 }, 'Rate limit approaching')
logger.error(err as object, 'Payment service failed')
logger.debug({ query }, 'DB query executed')
```

Same instance as `shapeguard()` middleware. Auto-selects pino → winston → fallback.

---

## Quick start

**Minimum — 3 lines. Works standalone. No `defineRoute()`. No `shapeguard()`. No extra packages.**

```ts
import { generateOpenAPI, createDocs } from 'shapeguard'

const spec = generateOpenAPI({
  title:   'My API',
  version: '1.0.0',
  routes:  { 'GET /health': { summary: 'Health check' } },
})

app.use('/docs', createDocs({ spec }))
```

Open `http://localhost:3000/docs` — Swagger UI loads, no extra npm packages.

**With schemas and auth:**

```ts
import { generateOpenAPI, createDocs } from 'shapeguard'

const spec = generateOpenAPI({
  title:   'My API',
  version: '1.0.0',
  prefix:  '/api/v1',
  security:        { bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
  defaultSecurity: ['bearer'],
  routes: {
    'POST   /users': { ...CreateUserRoute, summary: 'Create user', tags: ['Users'] },
    'GET    /users': { ...ListUsersRoute,  summary: 'List users',  tags: ['Users'] },
    'GET    /users/:id': { ...GetUserRoute, summary: 'Get user',   tags: ['Users'] },
    'PUT    /users/:id': UpdateUserRoute,
    'DELETE /users/:id': DeleteUserRoute,
  },
})

// Dark theme, CSP headers, padlock works — zero extra packages
app.use('/docs', createDocs({ spec, title: 'My API', theme: 'dark' }))
// Raw JSON for Postman, Insomnia, Stoplight, SDK generators
app.get('/docs/openapi.json', (_req, res) => res.json(spec))
```

> **Standalone guarantee:** `generateOpenAPI()` and `createDocs()` work without any other shapeguard feature.
> You do not need `shapeguard()` middleware, `defineRoute()`, or `validate()` to use them.

---

## generateOpenAPI()

```ts
generateOpenAPI(config: OpenAPIConfig): OpenAPISpec
```

### Config

```ts
{
  title:            string
  version:          string
  description?:     string
  termsOfService?:  string                               // URL to terms
  contact?:         { name?: string; email?: string; url?: string }
  license?:         { name: string; url?: string }
  servers?:         Array<{ url: string; description? }>
  prefix?:          string                               // prepend to every route
  routes:           Record<string, RouteDefinition | InlineRouteDefinition>
  security?:        Record<string, SecuritySchemeType>   // named scheme definitions
  defaultSecurity?: string[]                             // applied to all routes by default
  tags?:            Array<{ name: string; description?; externalDocs? }>
  externalDocs?:    { url: string; description? }
}
```

### Automatic responses

Every operation gets these responses generated automatically — no config needed:

| Response | When generated |
|---|---|
| `200` | Always — includes response schema if defined |
| `400` | Always — pre-parse guard errors (PARAM_POLLUTION, BODY_TOO_DEEP, etc.) |
| `401` | When `defaultSecurity` or per-route `security` includes at least one scheme |
| `403` | Same as 401 |
| `422` | Always — Zod/Joi/Yup validation failure |
| `429` | When the route definition includes `rateLimit` |
| `500` | Always — internal server error |

### operationId

Every operation gets a stable SDK-friendly `operationId` auto-generated:

| Route | operationId |
|-------|------------|
| `POST /users` | `postUsers` |
| `GET /users/:id` | `getUsersId` |
| `DELETE /users/:id/posts` | `deleteUsersIdPosts` |
| `GET /` | `getRoot` |

### Route key format

```ts
// "METHOD /path" — method is case-insensitive
'POST   /users'
'GET    /users/:id'
'PUT    /users/:id'
'DELETE /users/:id'
```

Express `:param` syntax is automatically converted to OpenAPI `{param}`.

---

## Security schemes — working padlock

Define named security schemes once. The Swagger UI padlock button works out of the box.

```ts
const spec = generateOpenAPI({
  title:   'My API',
  version: '1.0.0',

  security: {
    bearer: {
      type:         'http',
      scheme:       'bearer',
      bearerFormat: 'JWT',
    },
    apiKey: {
      type: 'apiKey',
      in:   'header',
      name: 'X-API-Key',
    },
  },

  // Apply bearer auth to every route by default
  defaultSecurity: ['bearer'],

  routes: {
    // Inherits bearer from defaultSecurity → 401/403 responses generated
    'GET /users/:id': GetUserRoute,

    // Override — this route uses apiKey instead
    'POST /webhooks/stripe': { ...WebhookRoute, security: ['apiKey'] },

    // Explicitly public — no auth required
    // security: [] overrides defaultSecurity and suppresses 401/403
    'GET /health': { ...HealthRoute, security: [] },
  },
})
```

### Supported scheme types

```ts
// Bearer JWT
{ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }

// API Key in header
{ type: 'apiKey', in: 'header', name: 'X-API-Key' }

// API Key in query param
{ type: 'apiKey', in: 'query', name: 'api_key' }

// API Key in cookie
{ type: 'apiKey', in: 'cookie', name: 'session' }

// HTTP Basic
{ type: 'http', scheme: 'basic' }

// OAuth2
{ type: 'oauth2', flows: { authorizationCode: {
  authorizationUrl: 'https://auth.example.com/oauth/authorize',
  tokenUrl:         'https://auth.example.com/oauth/token',
  scopes:           { read: 'Read access', write: 'Write access' },
}}}

// OpenID Connect
{ type: 'openIdConnect', openIdConnectUrl: 'https://auth.example.com/.well-known/openid-configuration' }
```

---

## Route options

Every route (inline or `defineRoute()`) accepts these additional options:

```ts
'POST /users': {
  ...defineRoute({ body: CreateUserDTO, response: UserResponseSchema }),

  // Display
  summary:     'Create a new user',
  description: 'Creates a user account. Returns the created user.',
  tags:        ['Users'],

  // Status
  deprecated:  false,              // renders with strikethrough in Swagger UI

  // Auth (overrides defaultSecurity)
  security:    ['bearer'],         // or [] for explicit public endpoint

  // Body content type
  bodyType:    'json',             // 'json' | 'multipart' | 'form'
  // 'multipart' → multipart/form-data (file uploads)
  // 'form'      → application/x-www-form-urlencoded

  // Documentation links
  externalDocs: { url: 'https://docs.example.com/users', description: 'Full guide' },

  // Vendor extensions (x-* in OpenAPI)
  extensions: {
    'x-rate-limit-tier': 'standard',
    'x-internal': false,
  },

  // Response headers documented in 200 schema
  responseHeaders: {
    'X-Request-Id':  { description: 'Unique request ID', schema: { type: 'string' } },
    'Retry-After':   { description: 'Seconds until rate limit resets', schema: { type: 'number' } },
  },
}
```

### File upload (multipart)

```ts
import { z } from 'zod'

const UploadRoute = defineRoute({
  body: zodAdapter(z.object({
    name:        z.string(),
    file:        z.string(),        // auto-detected as format: binary
    thumbnail:   z.string(),        // auto-detected (matches common upload field names)
    description: z.string().optional(),
  })),
})

'POST /uploads': {
  ...UploadRoute,
  bodyType:  'multipart',           // generates multipart/form-data schema
  summary:   'Upload a file',
}
// Generated schema: name=string, file=binary, thumbnail=binary, description=string
// Fields named: file, image, avatar, photo, video, audio, attachment, document
// are automatically mapped to format: binary
```

### Form submission

```ts
'POST /login': {
  ...LoginRoute,
  bodyType: 'form',    // generates application/x-www-form-urlencoded
  summary:  'Login',
}
```

---

## createDocs() — built-in Swagger UI

Zero extra npm packages. Self-contained HTML, CDN-loaded Swagger UI 5.17.
The padlock button works when `security` is configured in `generateOpenAPI()`.

```ts
import { createDocs } from 'shapeguard'
// or: import { createDocs } from 'shapeguard/openapi'

app.use('/docs', createDocs({
  spec,

  // ── Display ────────────────────────────────────────────────────────────
  title:     'My API Docs',              // browser tab title
  theme:     'dark',                     // 'light' | 'dark' | 'auto'
  favicon:   '/favicon.ico',             // optional favicon URL
  logo:      {                           // optional logo above topbar
    url:             '/logo.png',
    altText:         'My Company',
    backgroundColor: '#1a1a2e',
  },
  customCss: '.swagger-ui .topbar { display: none }',  // raw CSS

  // ── UI behaviour ───────────────────────────────────────────────────────
  docExpansion:              'list',   // 'none' | 'list' | 'full'
  defaultModelsExpandDepth:  1,        // -1 = collapse all models
  defaultModelExpandDepth:   1,
  operationsSorter:          'alpha',  // 'alpha' | 'method' | 'none'
  tagsSorter:                'alpha',  // 'alpha' | 'none'
  showExtensions:            true,     // show x-* vendor extensions
  showCommonExtensions:      false,
  displayOperationId:        false,    // show operationId badges
  filter:                    true,     // enable search bar
  maxDisplayedTags:          10,       // limit visible tag groups

  // ── Auth ──────────────────────────────────────────────────────────────
  persistAuthorization:      true,     // always on — saves token across reloads
  withCredentials:           false,    // send cookies on Try-It-Out
  oauth2RedirectUrl:         'https://myapp.com/docs/oauth2-redirect',

  // Inject custom JS into every Try-It-Out request:
  requestInterceptor: `
    request.headers['X-Trace-Id'] = crypto.randomUUID();
    request.headers['X-Client']   = 'swagger-ui';
    return request;
  `,
  // Inspect every response:
  responseInterceptor: `
    console.log('[docs]', response.status, response.url);
    return response;
  `,

  // ── Security ──────────────────────────────────────────────────────────
  // Content-Security-Policy header on the docs page.
  // Default: safe auto-generated policy covering CDN assets.
  // Pass false to disable (not recommended in production).
  csp: "default-src 'self'; script-src 'self' https://cdnjs.cloudflare.com 'unsafe-inline'",

  // ── Advanced ──────────────────────────────────────────────────────────
  headHtml: '<script async src="https://analytics.example.com/script.js"></script>',
}))
```

### Security headers on docs page

Every `createDocs()` response includes these security headers automatically:

| Header | Value |
|---|---|
| `Content-Security-Policy` | Auto-generated or custom (see `csp` option) |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Referrer-Policy` | `no-referrer` (via meta tag) |

### Theme options

| `theme` | Description |
|---|---|
| `'auto'` | Follows OS preference (dark on dark OS, light on light OS) |
| `'dark'` | Always dark — GitHub-dark colour palette, method-coloured operation borders |
| `'light'` | Always light — default Swagger UI |

### Features always enabled

- ✅ `persistAuthorization: true` — JWT saved across page reloads
- ✅ `displayRequestDuration: true` — shows latency on every response
- ✅ `tryItOutEnabled: true` — Try-It-Out open by default
- ✅ `validatorUrl: 'none'` — no external validator.swagger.io calls (no console noise)
- ✅ `deepLinking: true` — bookmarkable operation URLs
- ✅ Search / filter bar

---

## Serving the spec

```ts
// Raw JSON — import into Postman, Insomnia, Stoplight, SDK generators
app.get('/docs/openapi.json', (_req, res) => res.json(spec))

// Only serve docs in non-production if desired
if (process.env.NODE_ENV !== 'production') {
  app.use('/docs', createDocs({ spec }))
}

// Production: protect the docs behind auth middleware
app.use('/docs',
  authMiddleware,
  createDocs({ spec, theme: 'dark' }),
)
```

---

## Full example

```ts
import express from 'express'
import { z } from 'zod'
import {
  shapeguard, createDTO, defineRoute, handle, zodAdapter,
  generateOpenAPI, createDocs,
  notFoundHandler, errorHandler,
} from 'shapeguard'

const CreateUserDTO = createDTO(z.object({
  email:    z.string().email(),
  name:     z.string().min(1).max(100),
  password: z.string().min(8),
}))

const UserResponseSchema = z.object({
  id:        z.string().uuid(),
  email:     z.string().email(),
  name:      z.string(),
  createdAt: z.string().datetime(),
})

const UserParamsSchema = z.object({ id: z.string().uuid() })
const UserQuerySchema  = z.object({
  page:   z.coerce.number().default(1),
  limit:  z.coerce.number().default(20),
  search: z.string().optional(),
})

const CreateUserRoute = defineRoute({
  body:      CreateUserDTO,
  response:  UserResponseSchema,
  rateLimit: { windowMs: 60_000, max: 10 },
})
const GetUserRoute   = defineRoute({ params: UserParamsSchema, response: UserResponseSchema })
const ListUsersRoute = defineRoute({ query: UserQuerySchema })

const spec = generateOpenAPI({
  title:          'Users API',
  version:        '1.0.0',
  description:    'Complete user management API',
  termsOfService: 'https://example.com/terms',
  contact:        { name: 'API Support', email: 'api@example.com' },
  license:        { name: 'MIT' },
  servers: [
    { url: 'https://api.example.com', description: 'Production' },
    { url: 'http://localhost:3000',   description: 'Development' },
  ],
  tags: [
    { name: 'Users', description: 'User management operations' },
  ],

  // Security — padlock works in Swagger UI
  security: {
    bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
  },
  defaultSecurity: ['bearer'],

  routes: {
    // Public — no auth
    'POST /users': {
      ...CreateUserRoute,
      summary:     'Create user',
      description: 'Register a new user account.',
      tags:        ['Users'],
      security:    [],
    },
    // Protected — requires bearer JWT
    'GET  /users': {
      ...ListUsersRoute,
      summary: 'List users',
      tags:    ['Users'],
    },
    'GET  /users/:id': {
      ...GetUserRoute,
      summary: 'Get user',
      tags:    ['Users'],
      responseHeaders: {
        'X-Request-Id': { description: 'Request trace ID', schema: { type: 'string' } },
      },
    },
    // Deprecated endpoint
    'GET  /users/:id/profile': {
      ...GetUserRoute,
      summary:    'Get user profile (deprecated)',
      tags:       ['Users'],
      deprecated: true,
      externalDocs: { url: 'https://docs.example.com/migration', description: 'Migration guide' },
    },
  },
})

const app = express()
app.use(express.json())
app.use(shapeguard())

app.get('/docs/openapi.json', (_req, res) => res.json(spec))
app.use('/docs', createDocs({
  spec,
  title:             'Users API',
  theme:             'dark',
  docExpansion:      'list',
  operationsSorter:  'alpha',
  requestInterceptor: "request.headers['X-Client'] = 'swagger-ui'; return request;",
}))

app.use(notFoundHandler())
app.use(errorHandler())
app.listen(3000)
// → http://localhost:3000/docs       — Swagger UI
// → http://localhost:3000/docs/openapi.json — raw spec
```
