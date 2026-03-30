# Security Policy

shapeguard is a security-focused Express middleware library. We take vulnerability reports seriously and respond quickly.

## Supported versions

| Version | Security fixes |
|---------|---------------|
| 0.8.x   | ✅ Active      |
| 0.7.x   | ✅ Active      |
| 0.6.x   | ⚠️ Critical only |
| < 0.6.0 | ❌ Not supported |

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

## What we consider a security issue

shapeguard is designed to be a security layer for Express apps. These areas are particularly sensitive:

- **Pre-parse guards** — prototype pollution, PARAM_POLLUTION, depth/size limits, unicode injection
- **Webhook verification** — timing attacks in `verifyWebhook()`, replay attack protection
- **Response stripping** — sensitive fields leaking to clients
- **Rate limiting** — bypass or state isolation issues
- **Swagger UI** — XSS in `createDocs()`, CSP bypass

## What we do not consider a security issue

- Vulnerabilities only exploitable by the app developer (not end users)
- Issues in example code in the `examples/` directory
- Issues requiring local network access to exploit

## Responsible disclosure

We follow coordinated disclosure. After a fix is released, we will:
1. Publish a patch version
2. Add a security entry to `CHANGELOG.md`
3. Open a GitHub Security Advisory

We will credit you in the advisory unless you prefer to remain anonymous.

## Security-related CI

Every push to `main` runs:
- GitHub CodeQL static analysis
- OpenSSF Scorecard supply chain security scoring  
- `npm audit` for dependency vulnerabilities
