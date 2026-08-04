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
    "style-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com",
    "style-src-elem 'self' https://fonts.googleapis.com https://fonts.gstatic.com",
    "img-src 'self' data:",
    "font-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com",
    `connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://api.sdgs-journey.com wss://${serverName} blob:`,
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
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
    // 弱點掃描修正：禁止所有回應被瀏覽器或中介設備（代理、CDN）快取，
    // 防止 token、房間狀態、錄音等敏感資料殘留在快取中。
    // Pragma: no-cache 為 HTTP/1.0 向下相容；靜態資源快取由 standalone.ts 靜態中介件另行控制。
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Pragma', 'no-cache')
    next()
  }
}
