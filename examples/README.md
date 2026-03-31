# shapeguard examples

Each example is standalone — `cd` into the folder and `npm install && npm start`.
No global setup needed.

| Example | What it shows | Key features |
|---------|---------------|--------------|
| [basic-crud-api](./basic-crud-api/) | Full CRUD API — all features working end to end | `shapeguard()`, `validate()`, `AppError`, `errorHandler()` |
| [handle-and-dto](./handle-and-dto/) | Reduced boilerplate with `handle()` + `createDTO()` | `handle()`, `createDTO()`, `res.paginated()`, `createRouter()` |
| [transform-hook](./transform-hook/) | Password hashing, slug generation via `transform` | `defineRoute({ transform })` |
| [global-config](./global-config/) | All `shapeguard()` global config options | `validation.strings`, `logger`, `requestId.generator` |
| [with-openapi](./with-openapi/) | Full OpenAPI + Swagger UI + webhooks + cursor pagination | `generateOpenAPI()`, `createDocs()`, `verifyWebhook()`, `res.cursorPaginated()`, `AppError.define()` |
| [with-webhook](./with-webhook/) | HMAC webhook verification — Stripe, GitHub, Shopify, custom | `verifyWebhook()`, all provider presets |
| [with-testing](./with-testing/) | Unit-testing controllers without an HTTP server | `mockRequest()`, `mockResponse()`, `mockNext()` |

## Running an example

```bash
cd examples/with-openapi
npm install
npm start
# → http://localhost:3000/docs
```

## Examples are not included in the npm package

They live on GitHub only. The npm package contains only `dist/` and docs.
