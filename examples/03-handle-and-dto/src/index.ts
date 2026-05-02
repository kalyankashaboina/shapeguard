// ─────────────────────────────────────────────────────────────────────────────
// examples/handle-and-dto
//
// Shows two core DX patterns:
//   1. handle()    — replaces [validate(), asyncHandler()] array pattern
//   2. createDTO() — replaces manual z.infer<typeof ...> on every schema
//
// Before (without shapeguard):
//
//   const CreatePostBodySchema = z.object({ title: z.string(), body: z.string() })
//   export type CreatePostBody = z.infer<typeof CreatePostBodySchema>
//
//   export const createPost = [
//     validate(CreatePostRoute),
//     asyncHandler(async (req, res) => { ... })
//   ]
//
// With shapeguard:
//
//   export const CreatePostDTO = createDTO(z.object({ title: z.string(), body: z.string() }))
//   export type CreatePostBody = typeof CreatePostDTO.Input
//
//   export const createPost = handle(CreatePostRoute, async (req, res) => { ... })
//
// Run:  npx tsx src/index.ts
// Try:
//   curl -X POST http://localhost:3000/posts \
//     -H "Content-Type: application/json" \
//     -d '{"title":"Hello","body":"World","authorId":"550e8400-e29b-41d4-a716-446655440000"}'
//
//   curl http://localhost:3000/posts
//   curl http://localhost:3000/posts/550e8400-e29b-41d4-a716-446655440000
//
//   # Validation error — missing required fields
//   curl -X POST http://localhost:3000/posts \
//     -H "Content-Type: application/json" \
//     -d '{"title":""}'
// ─────────────────────────────────────────────────────────────────────────────

import express from 'express'
import { z } from 'zod'
import {
  shapeguard,
  createDTO,
  defineRoute,
  handle,
  createRouter,
  AppError,
  notFoundHandler,
  errorHandler,
} from 'shapeguard'

// ── 1. Define DTOs — no manual z.infer needed ─────────────────────────────────
const CreatePostDTO = createDTO(z.object({
  title:    z.string().min(1).max(200),
  body:     z.string().min(1),
  authorId: z.string().uuid(),
}))

const UpdatePostDTO = createDTO(z.object({
  title: z.string().min(1).max(200).optional(),
  body:  z.string().min(1).optional(),
}))

// ── 2. Response schema — strips internal fields ───────────────────────────────
const PostResponseSchema = z.object({
  id:        z.string().uuid(),
  title:     z.string(),
  body:      z.string(),
  authorId:  z.string().uuid(),
  createdAt: z.string().datetime(),
})

// ── 3. Route definitions ──────────────────────────────────────────────────────
const CreatePostRoute = defineRoute({ body: CreatePostDTO,  response: PostResponseSchema })
const UpdatePostRoute = defineRoute({ body: UpdatePostDTO,  response: PostResponseSchema,
  params: z.object({ id: z.string().uuid() }) })
const GetPostRoute    = defineRoute({ params: z.object({ id: z.string().uuid() }), response: PostResponseSchema })
const ListPostsRoute  = defineRoute({ query:  z.object({ page: z.coerce.number().default(1), limit: z.coerce.number().default(10) }) })

// ── 4. Types — inferred automatically ────────────────────────────────────────
type CreatePostBody = typeof CreatePostDTO.Input   // ← no z.infer needed
type UpdatePostBody = typeof UpdatePostDTO.Input   // ← no z.infer needed

// ── 5. In-memory store ────────────────────────────────────────────────────────
type Post = { id: string; title: string; body: string; authorId: string; createdAt: string; internal: string }
const posts = new Map<string, Post>()

// ── 6. Controllers — handle() replaces [validate(), asyncHandler()] ───────────
const createPost = handle(CreatePostRoute, async (req, res) => {
  const post: Post = {
    id:        crypto.randomUUID(),
    title:     req.body.title,
    body:      req.body.body,
    authorId:  req.body.authorId,
    createdAt: new Date().toISOString(),
    internal:  'NEVER_SENT_TO_CLIENT',  // response schema strips this ✅
  }
  posts.set(post.id, post)
  res.created({ data: post, message: 'Post created' })
})

const listPosts = handle(ListPostsRoute, async (req, res) => {
  const all   = [...posts.values()]
  // Zod coerces query strings to numbers at runtime; cast to satisfy TypeScript
  const page  = req.query.page  as unknown as number
  const limit = req.query.limit as unknown as number
  const start = (page - 1) * limit
  res.paginated({
    data:  all.slice(start, start + limit),
    total: all.length,
    page,
    limit,
  })
})

const getPost = handle(GetPostRoute, async (req, res) => {
  const post = posts.get(req.params.id as string)
  if (!post) throw AppError.notFound('Post')
  res.ok({ data: post, message: 'Post found' })
})

const updatePost = handle(UpdatePostRoute, async (req, res) => {
  const post = posts.get(req.params.id as string)
  if (!post) throw AppError.notFound('Post')
  const updated = { ...post, ...req.body }
  posts.set(post.id, updated)
  res.ok({ data: updated, message: 'Post updated' })
})

// ── 7. Router — auto 405 ──────────────────────────────────────────────────────
const router = createRouter()
router.post('/',    ...createPost)
router.get('/',     ...listPosts)
router.get('/:id',  ...getPost)
router.put('/:id',  ...updatePost)

// ── 8. App setup ──────────────────────────────────────────────────────────────
const app = express()
app.use(express.json())
app.use(shapeguard())
app.use('/posts', router)
app.use(notFoundHandler())
app.use(errorHandler())

app.listen(3000, () => {
  console.log('handle-and-dto example → http://localhost:3000')
  console.log('')
  console.log('POST   /posts       — create (validates + strips internal fields)')
  console.log('GET    /posts       — list with pagination')
  console.log('GET    /posts/:id   — get by id')
  console.log('PUT    /posts/:id   — update')
  console.log('PATCH  /posts       — 405 Method Not Allowed (auto)')
})
