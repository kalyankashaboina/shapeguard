// Shared env flag — imported by all modules so bundler deduplicates to one var.
export const isDev = process.env['NODE_ENV'] !== 'production'
