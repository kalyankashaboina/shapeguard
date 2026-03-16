// ─────────────────────────────────────────────
// validation/create-dto.ts — shapeguard
// createDTO() — wraps any Zod schema and exposes
// auto TypeScript type inference.
// No manual z.infer<typeof ...> needed.
// ─────────────────────────────────────────────

import { zodAdapter, isZodSchema }                 from '../adapters/zod.js'
import type { SchemaAdapter, SafeParseResult, ZodLike } from '../types/index.js'

/**
 * createDTO(zodSchema) — wraps a Zod schema with auto TypeScript type inference.
 *
 * Before (v0.1.x — boilerplate on every schema):
 *   const CreateUserBodySchema = z.object({ email: z.string().email() })
 *   export type CreateUserBody = z.infer<typeof CreateUserBodySchema>
 *
 * After (v0.2.0):
 *   export const CreateUserDTO = createDTO(z.object({ email: z.string().email() }))
 *   export type CreateUserBody = typeof CreateUserDTO.Input
 *
 * Pass directly to defineRoute() — it IS a SchemaAdapter:
 *   defineRoute({ body: CreateUserDTO, response: UserResponseSchema })
 */
export function createDTO<TSchema extends ZodLike<TOutput>, TOutput = InferZod<TSchema>>(
  schema: TSchema,
): DTOResult<TOutput> {
  if (!isZodSchema(schema)) {
    throw new Error(
      '[shapeguard] createDTO() requires a Zod schema. ' +
      'Pass a z.object({ ... }) as the argument.',
    )
  }

  const adapter = zodAdapter(schema) as SchemaAdapter<TOutput>

  const dto: DTOResult<TOutput> = {
    // SchemaAdapter interface — pass DTO directly to defineRoute()
    safeParse: (data: unknown): Promise<SafeParseResult<TOutput>> =>
      adapter.safeParse(data),
    parse: (data: unknown): Promise<TOutput> =>
      adapter.parse(data),
    strip: (data: unknown): Promise<TOutput> =>
      adapter.strip(data),
    library: 'zod',

    // DTO extras
    schema,
    adapter,
    // Input is type-only — never a runtime value, always undefined at runtime
    Input:  undefined as unknown as TOutput,
    _isDTO: true,
  }

  return dto
}

// ── Type utilities ────────────────────────────

// Extract output type from a Zod schema via _output marker
type InferZod<T> = T extends { _output: infer O } ? O : unknown

export interface DTOResult<TOutput> extends SchemaAdapter<TOutput> {
  /**
   * Type-only property — never access at runtime.
   * Usage: type MyType = typeof MyDTO.Input
   */
  readonly Input:   TOutput
  /** Raw Zod schema — use for .extend(), .partial(), .pick(), .omit() */
  readonly schema:  ZodLike<TOutput>
  /** Explicit adapter reference */
  readonly adapter: SchemaAdapter<TOutput>
  readonly _isDTO:  true
}
