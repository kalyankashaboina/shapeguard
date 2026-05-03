// ─────────────────────────────────────────────
// openapi/utils.ts — shapeguard
// Shared utilities for openapi/index.ts and openapi/serve.ts
// ─────────────────────────────────────────────

/**
 * HTML-escape a string for safe embedding in HTML attributes and text.
 */
export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/**
 * Safely serialize an object for embedding inside an HTML <script> tag.
 * JSON.stringify does NOT escape </ sequences — a spec with "</script>" in a
 * title or description would break or XSS-inject the page.
 * This escapes all </ to <\/ to prevent script tag injection.
 */
export function safeJson(o: unknown): string {
  return JSON.stringify(o).replace(/<\//g, '<\\/')
}
