// ─────────────────────────────────────────────
// core/constants.ts — shapeguard
// Single source of truth for all internal cross-module keys.
// These keys are used as contracts between shapeguard() middleware,
// validate(), errorHandler(), and withShape().
//
// NEVER duplicate these strings — import from here.
// A collision on any of these keys silently corrupts internal state.
// ─────────────────────────────────────────────

/**
 * Key used to store the logger instance on req.app.locals.
 * Set by: shapeguard()
 * Read by: errorHandler() (auto-discovery fallback)
 */
export const SG_LOGGER_KEY = '__sg_logger__' as const

/**
 * Key used to store the per-request validation + response config on res.locals.
 * Set by: shapeguard() on every request
 * Read by: validate(), withShape()
 */
export const SG_CONFIG_KEY = '__sg_validation_config__' as const
