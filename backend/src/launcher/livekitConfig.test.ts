import { describe, it, expect } from 'vitest'
import { buildLivekitConfig } from './livekitConfig.js'

describe('buildLivekitConfig', () => {
  it('generates config with node_ip, keys, and default ports', () => {
    const yaml = buildLivekitConfig({
      nodeIp: '192.168.1.50',
      apiKey: 'devkey',
      apiSecret: 'devsecret1234567890devsecret1234567890',
    })
    expect(yaml).toContain('port: 7880')
    expect(yaml).toContain('node_ip: 192.168.1.50')
    expect(yaml).toContain('port_range_start: 40000')
    expect(yaml).toContain('port_range_end: 40020')
    expect(yaml).toContain('use_external_ip: false')
    expect(yaml).toContain('devkey: devsecret1234567890devsecret1234567890')
  })

  it('does not include a redis section (single-node mode)', () => {
    const yaml = buildLivekitConfig({
      nodeIp: '192.168.1.50',
      apiKey: 'devkey',
      apiSecret: 'devsecret1234567890devsecret1234567890',
    })
    expect(yaml).not.toContain('redis:')
  })

  it('honors custom port and udp range overrides', () => {
    const yaml = buildLivekitConfig({
      nodeIp: '10.0.0.5',
      apiKey: 'k',
      apiSecret: 's',
      port: 7999,
      udpPortStart: 41000,
      udpPortEnd: 41020,
    })
    expect(yaml).toContain('port: 7999')
    expect(yaml).toContain('port_range_start: 41000')
    expect(yaml).toContain('port_range_end: 41020')
  })
})
