// ─────────────────────────────────────────────
// validation/string-transforms.ts — shapeguard
// Global string transforms applied to all validated string fields.
// Pure recursive function — no Express imports.
// ─────────────────────────────────────────────

export interface StringTransformConfig {
  trim?:      boolean
  lowercase?: boolean
}

export function applyStringTransforms(
  data: unknown,
  cfg:  StringTransformConfig,
): unknown {
  if (typeof data === 'string') {
    let s = data
    if (cfg.trim)      s = s.trim()
    if (cfg.lowercase) s = s.toLowerCase()
    return s
  }
  if (Array.isArray(data)) return data.map(item => applyStringTransforms(item, cfg))
  if (data !== null && typeof data === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(data as object)) {
      out[k] = applyStringTransforms(v, cfg)
    }
    return out
  }
  return data
}
