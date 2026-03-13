// ─────────────────────────────────────────────
// validation/sanitize.ts — shapeguard
// Controls what validation error info reaches the client.
// ─────────────────────────────────────────────

import type { ValidationIssue, ValidationConfig } from '../types/index.js'

import { isDev } from '../core/env.js'

// Zod internal codes that leak implementation details — map to 'invalid'
const ZOD_CODES = new Set([
  'invalid_type','invalid_literal','unrecognized_keys','invalid_union',
  'invalid_union_discriminator','invalid_enum_value','invalid_arguments',
  'invalid_return_type','invalid_date','invalid_string','too_small','too_big',
  'invalid_intersection_types','not_multiple_of','not_finite','custom',
])

export function sanitizeValidationIssue(issue: ValidationIssue, config: ValidationConfig = {}): ValidationIssue {
  const {
    exposeFieldName  = true,
    exposeMessage    = true,
    exposeEnumValues = isDev,
    exposeZodCodes   = false,
  } = config

  return {
    field:   exposeFieldName ? issue.field   : 'field',
    message: exposeMessage   ? (exposeEnumValues ? issue.message : issue.message.replace(/Expected '.*?'(?:\s*\|\s*'.*?')*, received '.*?'/g, 'Invalid value')) : 'Invalid value',
    code:    exposeZodCodes  ? issue.code    : (ZOD_CODES.has(issue.code) ? 'invalid' : issue.code),
  }
}
