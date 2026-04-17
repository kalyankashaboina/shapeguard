# Security Policy

shapeguard is a security-focused Express middleware library. We take vulnerability reports seriously and respond quickly.

## Supported versions

| Version | Security fixes |
|---------|---------------|
| 0.10.x  | ✅ Active (current) |
| 0.9.x   | ✅ Active      |
| 0.8.x   | ⚠️ Critical only |
| < 0.8.0 | ❌ Not supported |

## Reporting a vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Please report security issues by email to:

**kalyankashaboina07@gmail.com**

Include in your report:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

You will receive an acknowledgement within **48 hours** and a fix timeline within **7 days**.

---

## Built-in security controls

shapeguard ships with security enabled by default. Here is what runs on every request:

### Pre-parse guards (before schema validation)
| Threat | Protection |
|---|---|
| Prototype pollution (`__proto__`, `constructor`, `prototype`) | Stripped at JSON.parse reviver and again in single-pass rebuild using `Object.defineProperty` |
| Unicode injection (null bytes, RTL override, control chars) | Stripped via single-pass NFC normalisation + UNSAFE_CHARS regex |
| Deep nesting DoS | Rejected at depth > 20 (configurable via `limits.maxDepth`) |
| Oversized array DoS | Rejected at length > 1,000 (configurable via `limits.maxArrayLength`) |
| Oversized string DoS | Rejected at length > 10,000 chars (configurable via `limits.maxStringLength`) |
| Parameter pollution | `?x=a&x=b` rejected with PARAM_POLLUTION before Zod sees it |
| Invalid Content-Type | Non-JSON/form/multipart bodies rejected with 415 |

### Response security
| Threat | Protection |
|---|---|
| Sensitive field leakage | Response schema stripping — unlisted fields removed before every send |
| Browser MIME sniffing | `X-Content-Type-Options: nosniff` on all error responses |
| Clickjacking on docs | `X-Frame-Options: SAMEORIGIN` on all doc UIs |
| Docs script injection (XSS) | Per-UI `Content-Security-Policy` headers limiting script sources to exact CDN origins |
| Docs clickjacking | `Permissions-Policy: camera=(), microphone=(), geolocation=()` |

### Webhook security
| Threat | Protection |
|---|---|
| Signature spoofing | `crypto.timingSafeEqual` — constant-time comparison prevents timing oracle attacks |
| Replay attacks (Stripe/Svix) | Timestamp tolerance window (default 300s) rejects expired deliveries |
| Replay attacks (GitHub) | Delivery-ID deduplication via `inMemoryDeduplicator()` or custom Redis store |
| Oversized payloads | `maxBodyBytes` cap (default 1 MB, configurable, disable with 0) |

### Rate limiting
| Threat | Protection |
|---|---|
| Brute force / DDoS | Per-route fixed-window rate limiting; configurable Redis store for distributed deployments |
| IP spoofing bypass | `trustProxy: false` by default — uses `socket.remoteAddress`, not `x-forwarded-for` |

> ⚠️ **`trustProxy: true`** must only be set when shapeguard runs behind a trusted reverse proxy (nginx, AWS ALB, Cloudflare). Without a real proxy, attackers can set any `x-forwarded-for` value and bypass rate limiting entirely.

---

## Known limitations

### CDN scripts for docs UIs
`serveScalar()`, `serveSwaggerUI()`, and `serveRedoc()` load scripts from public CDNs (`cdn.jsdelivr.net`, `unpkg.com`). These are:
- Pinned to specific versions (not floating `@latest`)
- Loaded with `crossorigin="anonymous"`
- Covered by a tight per-UI `Content-Security-Policy` restricting connections to the exact CDN origin
- The `integrity?` option on `serveScalar()` allows adding a Subresource Integrity hash for the Scalar script

The CSP uses `'unsafe-inline'` because all three doc UIs embed configuration in inline `<script>` blocks. This is a CDN architecture limitation of the underlying doc libraries, not shapeguard. The inline scripts cannot reach external origins beyond what the CSP allows.

**Mitigation:** Doc UIs should only be mounted in development or on protected internal routes, never exposed to end users without authentication.

### localStorage in Swagger UI
The `persist` option in `serveSwaggerUI()` (default `false`) saves authorization tokens to `localStorage`. This is standard Swagger UI behaviour. It is only a risk if XSS is already present — the CSP mitigates that.

### Rate limiting is per-process
The in-memory rate limit store is not shared across Node.js processes. For multi-instance deployments, pass a `store` implementing the async Redis interface.

---

## Security-related CI

Every push to `main` runs:
- GitHub CodeQL static analysis
- SonarCloud SAST with quality gate
- `npm audit --audit-level=high` — blocks on high and critical vulnerabilities
- OpenSSF Scorecard supply chain security scoring
