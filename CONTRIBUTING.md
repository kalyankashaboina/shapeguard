# Contributing to shapeguard

> Read this before opening a pull request or proposing a feature.
> This document is the single source of truth for what shapeguard is,
> why it exists, and what it will never become.

---

## What shapeguard is

A zero-config, loosely-coupled toolkit for Express that replaces 8+ packages with one.

**The one-line motive:**
> Small code. Heavy features. Zero config to start. Configure anything later.

Every piece works standalone. You pick what you need. Nothing forces you to adopt everything at once. Works in any JavaScript or TypeScript project — CommonJS, ESM, Node 18+.

---

## The packages we replace

A production Express app today needs all of these. shapeguard replaces 8 of them with 1, and adds zero required runtime dependencies.

| Package | Role | shapeguard equivalent |
|---|---|---|
| `express-validator` | Request validation | `validate()` / `handle()` |
| `express-async-errors` | Async error catching | `handle()` + `asyncHandler()` |
| `http-errors` | Typed error objects | `AppError` |
| `morgan` | Request logging | `shapeguard()` built-in |
| `express-rate-limit` | Rate limiting | `defineRoute({ rateLimit })` |
| `swagger-jsdoc` | OpenAPI from code | `generateOpenAPI()` |
| `swagger-ui-express` | Swagger UI | `generateOpenAPI()` + serve |
| `uuid` | Request ID generation | `shapeguard()` built-in |
| `supertest` (for unit tests) | HTTP integration tests | `mockRequest()` / `mockResponse()` |

---

## The five rules

Every feature, fix, and API decision gets measured against these. If something violates any of them it does not ship — no exceptions.

### 1. Zero config to start

Every feature works with no configuration at all. Defaults are production-safe. You only configure when you want to change a behaviour, not to make the basic thing work.

```ts
// This is enough. Nothing else needed.
app.use(shapeguard())
app.use(errorHandler())
```

### 2. Standalone always

Every exported function works independently of every other. No hidden dependencies between pieces.

```ts
// Must work with zero other shapeguard setup
import { AppError, errorHandler } from 'shapeguard'
app.use(errorHandler())

// Must work with zero other shapeguard setup
import { validate } from 'shapeguard'
router.post('/users', validate(CreateUserRoute), handler)

// Must work with zero other shapeguard setup
import { generateOpenAPI } from 'shapeguard'
const spec = generateOpenAPI({ ... })

// Must work with zero other shapeguard setup
import { mockRequest, mockResponse } from 'shapeguard/testing'
```

A user must be able to adopt one feature at a time and get full value from it immediately.

### 3. Small code, heavy features

The user writes less code than they would without the library. Count the lines before and after. If adoption increases the line count, the API is wrong — rethink the abstraction.

### 4. Configure anything, at any time

Every behaviour that is not a security invariant is configurable. If a user wants to change something, there is an option for it. Nothing is silently hardcoded except proto pollution blocking and unicode injection stripping — those are always on.

### 5. No surprises

The library never silently mutates the caller's data, never swallows errors, never logs without being told to, never overwrites anything without warning. Silence means nothing happened.

---

## Who we are building for

Four types of users. Every feature decision should name which one it serves.

**The existing app developer** — has a working Express app, wants Swagger without rewriting routes. This is the largest untapped market.

**The TypeScript developer** — wants typed `req.body` like FastAPI. Zero `any`.

**The team lead** — wants one consistent error shape across the whole team.

**The full adopter** — wants everything, starting fresh.

Features that only help the full adopter are lowest priority. Features that help the existing app developer are highest priority.

---

## What we will never build

**WebSocket support** — different protocol, different lifecycle. Use `ws` or `socket.io`.

**GraphQL integration** — its own type system, its own ecosystem. Use `graphql-yoga`.

**ORM or database integration** — shapeguard is an HTTP layer library only. It does not touch databases.

**Breaking the existing Express router** — shapeguard is a drop-in. Any feature that requires changing existing routes is opt-in only, never required.

---

## Settled decisions

These are not up for debate. If you have a strong argument, open an issue — but the bar is very high.

- **Zod is the primary schema engine.** Joi and Yup adapters exist for migration. Winston adapter bridges logger arg order. New features are designed for Zod only.
- **Zero required runtime dependencies.** pino is optional. winston is optional. No new required dep will ever be added.
- **One consistent response envelope.** `{ success, message, data }` and `{ success, message, error }`. This is the contract frontend teams depend on.
- **Strict semantic versioning.** Patch = bug fixes only. Minor = new features, no breaking changes. Major = breaking changes with migration guide.

---

## How to contribute

1. Check open issues before starting work
2. For bugs — open an issue first with a minimal reproduction
3. For features — open an issue first, describe the problem and which user type it helps
4. Fork, branch from `main`, make your change with tests
5. Run `npm test` and `npm run typecheck` — both must pass
6. Update `CHANGELOG.md` under `[Unreleased]`
7. Open a pull request — one thing per PR