export interface LivekitConfigOptions {
  nodeIp: string
  apiKey: string
  apiSecret: string
  port?: number
  /**
   * 所有 WebRTC 媒體共用的單一 UDP 埠（UDP mux）。不論多少人連線都只用這一個埠，
   * 避免 port range 太小時人數一多就用光（每位參與者會建立多條連線）。
   */
  udpPort?: number
  /** UDP 被擋（例如校園網路只放行 TCP）時的 ICE/TCP 備援埠 */
  tcpPort?: number
  /** 舊設定：改用 UDP 埠範圍（同時提供 start 與 end 時才生效，取代 udpPort） */
  udpPortStart?: number
  udpPortEnd?: number
}

export const DEFAULT_LIVEKIT_UDP_PORT = 7882
export const DEFAULT_LIVEKIT_TCP_PORT = 7881

export function buildLivekitConfig(opts: LivekitConfigOptions): string {
  const port = opts.port ?? 7880
  const tcpPort = opts.tcpPort ?? DEFAULT_LIVEKIT_TCP_PORT
  const useRange = opts.udpPortStart !== undefined && opts.udpPortEnd !== undefined
  const udpLines = useRange
    ? `  port_range_start: ${opts.udpPortStart}
  port_range_end: ${opts.udpPortEnd}`
    : `  udp_port: ${opts.udpPort ?? DEFAULT_LIVEKIT_UDP_PORT}`

  return `port: ${port}
rtc:
  node_ip: ${opts.nodeIp}
${udpLines}
  tcp_port: ${tcpPort}
  use_external_ip: false
room:
  enable_remote_unmute: true
keys:
  ${opts.apiKey}: ${opts.apiSecret}
logging:
  level: info
`
}
