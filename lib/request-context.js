/**
 * Tribe — Request Context (Stage 3B)
 *
 * AsyncLocalStorage-based correlation context that propagates automatically
 * through the entire async call chain without changing function signatures.
 *
 * Every audit write, security event, moderation action, and error log
 * can access { requestId, ip, method, route, userId } from any depth
 * in the handler stack.
 *
 * Set once in the observability wrapper (route.js), read everywhere.
 */

import { AsyncLocalStorage } from 'node:async_hooks'

export const requestContext = new AsyncLocalStorage()

/**
 * Get current request context (safe — returns empty object if none).
 * Use this in any module that needs correlation data.
 */
export function getRequestContext() {
  return requestContext.getStore() || {}
}
