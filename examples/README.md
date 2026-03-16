# shapeguard examples

> All examples run with `npm run dev`. Each shows one focused concept.
> These examples live on GitHub — not included in the npm package.

---

## Examples

| Example | Concepts shown | Run |
|---------|---------------|-----|
| [basic-crud-api](./basic-crud-api/) | Full CRUD app — all features together | `cd basic-crud-api && npm install && npm run dev` |
| [handle-and-dto](./handle-and-dto/) | `handle()` + `createDTO()` | `cd handle-and-dto && npm install && npm run dev` |
| [transform-hook](./transform-hook/) | `defineRoute({ transform })` — password hashing, slug generation | `cd transform-hook && npm install && npm run dev` |
| [global-config](./global-config/) | `validation.strings`, `logger.silent`, `requestId.generator` | `cd global-config && npm install && npm run dev` |

---

## Quick guide — which example to read first

**New to shapeguard?** → Start with [basic-crud-api](./basic-crud-api/)

**Want less boilerplate?** → Read [handle-and-dto](./handle-and-dto/)
Shows how `handle()` removes the two-element array pattern and `createDTO()` removes manual `z.infer`.

**Hashing passwords / enriching data?** → Read [transform-hook](./transform-hook/)
Shows how `transform` on `defineRoute()` keeps your service layer pure.

**Configuring globally?** → Read [global-config](./global-config/)
Shows `validation.strings.trim`, `logger.silent`, custom `requestId.generator`.

---

## What each example does NOT show

These are intentionally kept out of examples to keep them focused:

| Topic | Where to find it |
|-------|-----------------|
| Joi / Yup adapters | [docs/VALIDATION.md](../docs/VALIDATION.md#adapters) |
| Custom error codes | [docs/ERRORS.md](../docs/ERRORS.md#custom) |
| OpenAPI generation | Coming in v0.3.0 |
| Rate limiting | Coming in v0.3.0 |
| Testing utilities | Coming in v0.3.0 |
