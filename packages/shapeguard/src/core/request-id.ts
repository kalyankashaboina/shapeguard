import { randomBytes } from 'crypto'

const PREFIX = 'req_'

export function generateRequestId(): string {
  const ts  = Date.now().toString(16).padStart(12, '0')  // 12 hex chars of timestamp
  const rnd = randomBytes(8).toString('hex')              // 16 hex chars of random
  return PREFIX + ts + rnd
}
