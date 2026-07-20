import type { RequestHandler } from 'express'

/**
 * 對應現有 nginx/default.conf.template 443 server block 的安全標頭，逐字搬過來
 * （見 docs/superpowers/plans/2026-07-20-native-launcher-packaging.md 的 Global
 * Constraints）。serverName 對應 nginx 設定裡的 ${SERVER_NAME}，用於 CSP 的
 * connect-src wss:// 來源。
 */
export function securityHeaders(serverName: string): RequestHandler {
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self' wss://${serverName} blob:`,
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
    'upgrade-insecure-requests',
  ].join('; ')

  return (_req, res, next) => {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('X-Frame-Options', 'SAMEORIGIN')
    res.setHeader('Content-Security-Policy', csp)
    next()
  }
}
