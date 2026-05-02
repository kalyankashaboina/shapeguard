// src/__tests__/validation/sanitize.test.ts
import { describe, it, expect } from 'vitest'
import { sanitizeValidationIssue } from '../../validation/sanitize.js'

const baseIssue = {
  field:   'email',
  message: 'Invalid email address',
  code:    'invalid_string',
}

describe('sanitizeValidationIssue', () => {
  describe('field name exposure', () => {
    it('exposes field name when exposeFieldName is true (default)', () => {
      const result = sanitizeValidationIssue(baseIssue, { exposeFieldName: true })
      expect(result.field).toBe('email')
    })

    it('hides field name when exposeFieldName is false', () => {
      const result = sanitizeValidationIssue(baseIssue, { exposeFieldName: false })
      expect(result.field).toBe('field')
    })
  })

  describe('message exposure', () => {
    it('exposes message when exposeMessage is true (default)', () => {
      const result = sanitizeValidationIssue(baseIssue, { exposeMessage: true })
      expect(result.message).toBe('Invalid email address')
    })

    it('hides message when exposeMessage is false', () => {
      const result = sanitizeValidationIssue(baseIssue, { exposeMessage: false })
      expect(result.message).toBe('Invalid value')
    })
  })

  describe('enum value stripping', () => {
    it('strips enum values from message when exposeEnumValues is false', () => {
      const issue = {
        field:   'role',
        message: "Invalid enum value. Expected 'admin' | 'member' | 'viewer', received 'superuser'",
        code:    'invalid_enum_value',
      }
      const result = sanitizeValidationIssue(issue, { exposeEnumValues: false })
      expect(result.message).not.toContain('admin')
      expect(result.message).not.toContain('member')
      expect(result.message).not.toContain('superuser')
    })

    it('keeps enum values when exposeEnumValues is true', () => {
      const issue = {
        field:   'role',
        message: "Invalid enum value. Expected 'admin' | 'member', received 'x'",
        code:    'invalid_enum_value',
      }
      const result = sanitizeValidationIssue(issue, { exposeEnumValues: true })
      expect(result.message).toContain('admin')
    })
  })

  describe('zod code sanitization', () => {
    it('strips zod internal codes when exposeZodCodes is false (default)', () => {
      const result = sanitizeValidationIssue(baseIssue, { exposeZodCodes: false })
      expect(result.code).toBe('invalid')  // mapped from 'invalid_string'
    })

    it('keeps zod codes when exposeZodCodes is true', () => {
      const result = sanitizeValidationIssue(baseIssue, { exposeZodCodes: true })
      expect(result.code).toBe('invalid_string')
    })

    it('keeps unknown codes unchanged', () => {
      const issue = { ...baseIssue, code: 'my_custom_code' }
      const result = sanitizeValidationIssue(issue, { exposeZodCodes: false })
      expect(result.code).toBe('my_custom_code')
    })
  })

  describe('defaults', () => {
    it('uses safe defaults when no config provided', () => {
      const result = sanitizeValidationIssue(baseIssue)
      expect(result.field).toBe('email')       // exposeFieldName: true
      expect(result.message).toBe('Invalid email address') // exposeMessage: true
      expect(result.code).toBe('invalid')      // exposeZodCodes: false
    })
  })

  describe('combined options', () => {
    it('exposeFieldName=false + exposeMessage=false hides both', () => {
      const result = sanitizeValidationIssue(baseIssue, {
        exposeFieldName: false,
        exposeMessage:   false,
      })
      expect(result.field).toBe('field')
      expect(result.message).toBe('Invalid value')
    })

    it('exposeZodCodes=false maps known codes to invalid', () => {
      const codes = ['invalid_type', 'too_small', 'too_big', 'invalid_string', 'unrecognized_keys']
      for (const code of codes) {
        const issue = { field: 'x', message: 'err', code }
        const result = sanitizeValidationIssue(issue, { exposeZodCodes: false })
        expect(result.code).toBe('invalid')
      }
    })

    it('non-zod custom code passes through with exposeZodCodes=false', () => {
      const issue = { field: 'x', message: 'err', code: 'PAYMENT_DECLINED' }
      const result = sanitizeValidationIssue(issue, { exposeZodCodes: false })
      expect(result.code).toBe('PAYMENT_DECLINED')
    })

    it('all options true: everything is visible', () => {
      const issue = {
        field:   'role',
        message: "Expected 'admin' | 'user', received 'boss'",
        code:    'invalid_enum_value',
      }
      const result = sanitizeValidationIssue(issue, {
        exposeFieldName:  true,
        exposeMessage:    true,
        exposeEnumValues: true,
        exposeZodCodes:   true,
      })
      expect(result.field).toBe('role')
      expect(result.message).toContain('admin')
      expect(result.code).toBe('invalid_enum_value')
    })
  })

})