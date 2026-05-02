# shapeguard — Production-Grade Library Audit & Transformation Plan

## 1. Issues Found

### Documentation issues (fixed in this delivery)

| Issue | File | Severity | Fix |
|---|---|---|---|
| Broken image ref `shapeguard-openapi.svg` | `docs/OPENAPI.md` | Medium | Removed |
| Broken image ref `shapeguard-testing-helpers.svg` | `docs/TESTING.md` | Medium | Removed |
| Stale version table (missing 0.9.x, still lists 0.7.x as active) | `SECURITY.md` | Medium | Updated |
| README is 825 lines — over-long, hard to scan, duplicate sections | `README.md` | High | Rewritten to 424 lines |
| README has TWO "What's new" sections (v0.8.3 archived but still showing) | `README.md` | Medium | Removed |
| README starts with feature dump instead of value proposition | `README.md` | High | Rewritten |
| README does not address limitations until page 8 | `README.md` | Medium | Limitations in clear final section |
| No dedicated website — GitHub README is the only entry point | All | High | Docusaurus plan + scaffold |
| No deploy pipeline — no way to publish docs safely | CI/CD | High | `deploy.yml` created |
| CI lint step uses `|| true` — lint failures silently ignored | `ci.yml` | Medium | Removed `|| true` |
| No `website` job in CI — docs could break without detection | `ci.yml` | Medium | `website` job added |

### Test issues

| Issue | Status |
|---|---|
| No tests for `serveScalar`, `serveSwaggerUI`, `serveRedoc` | Fixed in v0.9.0 — `v0.9.0-features.test.ts` |
| No tests for `toPostman`, `toInsomnia`, `toBruno` | Fixed in v0.9.0 |
| No tests for `logger` singleton | Fixed in v0.9.0 |
| `joiAdapter`/`yupAdapter` `allErrors` logic inverted | Fixed in v0.9.0 |
| `patchResponseStrip` data leak on strip failure | Fixed in v0.9.0 |

---

## 2. Improved README

Rewritten. See `README.md`.

Structure follows:
1. **One-line value proposition** — "One package that replaces nine."
2. **Problem** — real developer pain shown in code
3. **Before vs After** — code that speaks for itself
4. **What it replaces** — table of 9 packages → 1
5. **Install** — 2 lines
6. **Core features** — specific, with working code examples
7. **Standalone usage** — pick any feature, use it alone
8. **Limitations** — honest, no sugarcoating
9. **Docs links** — structured table

**Before:** 825 lines, two "What's new" sections, README starts with badges and version notes, buried value proposition.

**After:** 424 lines, opens with value proposition, problem → solution → features → limitations.

---

## 3. Documentation structure

```
docs/                      # Source docs (single source of truth)
  CONFIGURATION.md         # All shapeguard() options — 619 lines, comprehensive ✅
  ERRORS.md                # AppError, errorHandler, all codes ✅ (broken image removed)
  LOGGING.md               # Pino, redaction, requestId, BYOL ✅
  OPENAPI.md               # generateOpenAPI(), all UIs, exports ✅ (broken image removed)
  RESPONSE.md              # res helpers, withShape, shapes ✅
  TESTING.md               # mockRequest, mockResponse, mockNext ✅ (broken image removed)
  VALIDATION.md            # defineRoute, createDTO, handle, adapters ✅

MIGRATION.md               # Version-by-version guide ✅
SECURITY.md                # Updated version support table ✅
CHANGELOG.md               # Full history ✅
```

### What was wrong, what was fixed

**Docs are generally high quality and accurate.** The main issues were:
- Three broken image references to SVGs that don't exist → removed
- SECURITY.md listed versions 0.7.x and 0.8.x as active, missing 0.9.x → updated
- OPENAPI.md referenced `shapeguard-openapi.svg` which was deleted in a cleanup pass → removed

---

## 4. Website (Docusaurus) structure

```
website/
  docusaurus.config.ts     # Full config — URL, navbar, footer, SEO, Algolia
  sidebars.ts              # Navigation structure
  package.json             # Docusaurus 3.x dependencies
  src/
    pages/
      index.tsx            # Homepage (NOT a copy of README)
      index.module.css     # Homepage styles
    css/
      custom.css           # Theme overrides
  docs/                    # Symlinked/copied from root docs/
    quick-start.md         # Entry point — 2 minutes to working
    validation.md          # → from docs/VALIDATION.md
    errors.md              # → from docs/ERRORS.md
    response.md            # → from docs/RESPONSE.md
    logging.md             # → from docs/LOGGING.md
    configuration.md       # → from docs/CONFIGURATION.md
    openapi.md             # → from docs/OPENAPI.md
    testing.md             # → from docs/TESTING.md
    migration.md           # → from MIGRATION.md
    changelog.md           # → from CHANGELOG.md
    guides/
      existing-app.md      # "Add to an existing app" — incremental adoption
      distributed-rate-limiting.md  # Redis store for multi-process
      webhooks.md          # Stripe, GitHub, Shopify, custom
      adapters.md          # Joi, Yup, Winston
  static/
    img/
      logo.svg
      favicon.ico
      shapeguard-social.png  # OG image for Twitter/LinkedIn shares
```

### Homepage vs README

The homepage is **not** a copy of the README. It is a **conversion page**:
- Hero with clear value prop and single CTA ("Get started in 2 minutes")
- Interactive Before/After code blocks
- Feature cards (visual scan, not prose)
- Quick start with link to full guide

The README is for **GitHub** — developers who found the repo.
The website is for **everyone else** — search, direct links, npm page visitors.

### Navigation

```
Docs
  ⚡ Quick start        ← entry point
  Core API
    Validation
    Error handling
    Response
    Logging
    Configuration
  API Docs
    OpenAPI
  Testing
  Guides
    Add to existing app
    Distributed rate limiting
    Webhook verification
    Joi / Yup / Winston adapters
  🔀 Migration guide
  📋 Changelog
```

---

## 5. CI pipeline design

```yaml
# ci.yml — triggered on push to main and every PR

jobs:
  test:      # Node 18 / 20 / 22 matrix
    - npm ci
    - npm run typecheck     # hard fail
    - npm run lint          # hard fail (was silently ignored before)
    - npm test              # hard fail
    - npm run test:coverage # Node 20 only
    - npm run build         # hard fail
    - bundle size guard     # fails if main ESM > 50KB

  audit:
    - npm audit --audit-level=critical  # hard fail on critical vulns

  website:
    - cd website && npm ci
    - cd website && npm run build  # hard fail — ensures docs don't break
```

**Key change from previous CI:** the `website` job now runs on every push. A doc change that breaks the Docusaurus build fails CI immediately, preventing a broken deployment.

**Key change:** `npm run lint || true` removed. Lint failures now block merges.

---

## 6. Deployment pipeline design

```yaml
# deploy.yml — triggered ONLY when CI workflow succeeds on main

on:
  workflow_run:
    workflows: [CI]
    types: [completed]
    branches: [main]

# Safety gate — deploys ONLY if CI passed
if: github.event.workflow_run.conclusion == 'success'

jobs:
  deploy:
    - cd website && npm ci
    - cd website && npm run build
    - actions/upload-pages-artifact  # uploads website/build
    - actions/deploy-pages           # deploys to GitHub Pages
```

**Why `workflow_run` instead of `on: push`:**
Using `workflow_run` means deployment is **causally linked** to CI passing. A failed CI cannot trigger deployment, even if someone pushes directly to main. This is stronger than checking `needs:` because it handles the case where someone bypasses branch protection.

**Setup required (one-time):**
- GitHub → Settings → Pages → Source: **GitHub Actions** (not a branch)
- No additional secrets needed — uses built-in `GITHUB_TOKEN`

---

## 7. SEO & discoverability strategy

### 5 content ideas that target real search intent

| Page title | Target query | Why it works |
|---|---|---|
| "Replace express-validator with type-safe Zod validation" | `express validation typescript`, `express-validator alternative` | Problem-solution match. express-validator has 3M+ weekly downloads. |
| "Auto-generate OpenAPI 3.1 spec from your Express routes" | `express openapi typescript`, `swagger for express`, `express-jsdoc alternative` | swagger-jsdoc is the most-googled Express OpenAPI solution — positioning shapeguard as simpler. |
| "Consistent error handling in Express — no more inconsistent error shapes" | `express error handling best practices`, `express errorhandler middleware` | High-traffic query with weak existing content. |
| "Structured logging for Express with pino — zero config" | `express pino logging`, `express request logging` | Pino is popular — shapeguard as the zero-config gateway to pino. |
| "How to verify Stripe webhooks in Express" | `verify stripe webhook express`, `stripe signature verification nodejs` | High-intent, specific query. People google this every time they add webhooks. |

### How docs + website support discoverability

1. **Each guide page targets one query.** `guides/webhooks.md` = "verify stripe webhook express". One page, one answer, clear title.

2. **Problem-based headings.** Not "Response stripping" but "How to prevent passwordHash from leaking to clients". Search engines index headings.

3. **Comparison content.** A `/docs/vs/express-validator` page comparing shapeguard to express-validator directly captures high-intent traffic from people evaluating alternatives.

4. **Sitemap generation** is enabled in the Docusaurus config. All docs pages are indexed automatically.

5. **OG tags and structured metadata** are set in `docusaurus.config.ts` — Twitter/LinkedIn previews will show the value proposition, not just the site name.

---

## 8. Critical feedback

### Is the library's value clear?

**Partially.** The value is real and substantial — replacing 9 packages is a genuine win. But the current README buries this. It leads with badges, then a version update, then a vague tagline. A developer scanning GitHub has 10 seconds before they move on.

### What would make developers ignore it?

1. **"v0.9.x — pre-1.0"** is a yellow flag for some teams with strict semver policies. Address by being explicit in docs: which APIs are stable, which may change.

2. **No production usage examples.** The examples show toy apps. Developers trust libraries used in production. Mention if any companies/teams are using it.

3. **Overwhelming feature surface for a first-time visitor.** The old README showed every feature at once. A developer evaluating it doesn't know where to start. The rewritten README focuses on ONE core use case first.

4. **Documentation website missing.** npm packages with a proper docs site feel more professional. GitHub-only docs signal a hobby project.

### Biggest gap

**Product vs Communication:** The product is solid. The communication is weak. The actual code is well-tested, handles edge cases correctly, and covers real production concerns (timingSafeEqual, response stripping, proto pollution). The problem is that none of this is communicated clearly to a developer arriving for the first time.

The rewritten README and the Docusaurus website address this directly.

### What must be fixed first

In priority order:

1. **Expand examples** — add more real-world examples showing the library in production-like contexts.

2. **Launch the docs website** — run the deploy pipeline once. A real URL makes it feel real.

3. **Add one production testimonial** — even one company or project using shapeguard in production, mentioned in the README, changes the perception entirely.

4. **Rate limiting distributed story** — the per-process limitation is mentioned in docs but there is no first-class Redis adapter. The guide exists. A `createRedisStore()` helper export would complete this story.
