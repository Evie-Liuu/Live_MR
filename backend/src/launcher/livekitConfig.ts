export interface LivekitConfigOptions {
  nodeIp: string
  apiKey: string
  apiSecret: string
  port?: number
  udpPortStart?: number
  udpPortEnd?: number
}

/**
 * 產生 LiveKit 執行期設定（YAML）。取代 docker-compose 用 envsubst 套
 * livekit.yaml.template 的做法，改在 JS 端組字串。刻意不寫 redis 區塊——
 * 單機教室場景不需要，LiveKit 沒有 redis 設定時會自動用單機模式。
 */
export function buildLivekitConfig(opts: LivekitConfigOptions): string {
  const port = opts.port ?? 7880
  const udpPortStart = opts.udpPortStart ?? 40000
  const udpPortEnd = opts.udpPortEnd ?? 40020

  return `port: ${port}
rtc:
  node_ip: ${opts.nodeIp}
  port_range_start: ${udpPortStart}
  port_range_end: ${udpPortEnd}
  use_external_ip: false
room:
  enable_remote_unmute: true
keys:
  ${opts.apiKey}: ${opts.apiSecret}
logging:
  level: info
`
}
