import { describe, it, expect } from 'vitest'
import { detectLanIp } from './network.js'
import type { NetworkInterfaceInfo } from 'node:os'

function iface(address: string, family: 'IPv4' | 'IPv6', internal: boolean): NetworkInterfaceInfo {
  return {
    address,
    netmask: '255.255.255.0',
    family,
    mac: '00:00:00:00:00:00',
    internal,
    cidr: `${address}/24`,
  } as NetworkInterfaceInfo
}

describe('detectLanIp', () => {
  it('picks the first non-internal IPv4 address', () => {
    const fake = {
      'Loopback': [iface('127.0.0.1', 'IPv4', true)],
      'Ethernet': [iface('192.168.1.50', 'IPv4', false)],
    }
    expect(detectLanIp(fake)).toBe('192.168.1.50')
  })

  it('excludes loopback (127.x)', () => {
    const fake = {
      'Loopback': [iface('127.0.0.1', 'IPv4', true)],
    }
    expect(detectLanIp(fake)).toBeNull()
  })

  it('excludes link-local (169.254.x)', () => {
    const fake = {
      'Ethernet': [iface('169.254.1.2', 'IPv4', false)],
    }
    expect(detectLanIp(fake)).toBeNull()
  })

  it('ignores IPv6-only interfaces', () => {
    const fake = {
      'Ethernet': [iface('fe80::1', 'IPv6', false)],
    }
    expect(detectLanIp(fake)).toBeNull()
  })

  it('when multiple candidates exist, deterministically picks the first key/entry in iteration order', () => {
    const fake = {
      'Wi-Fi': [iface('192.168.1.50', 'IPv4', false)],
      'Ethernet': [iface('10.0.0.5', 'IPv4', false)],
    }
    expect(detectLanIp(fake)).toBe('192.168.1.50')
  })

  it('returns null when no interfaces given', () => {
    expect(detectLanIp({})).toBeNull()
  })

  it('prefers a real adapter over a WSL/Hyper-V virtual adapter, regardless of iteration order', () => {
    const fake = {
      'vEthernet (WSL (Hyper-V firewall))': [iface('172.24.224.1', 'IPv4', false)],
      'Wi-Fi': [iface('192.168.0.145', 'IPv4', false)],
    }
    expect(detectLanIp(fake)).toBe('192.168.0.145')
  })

  it('prefers a real adapter over Docker Desktop / VirtualBox / VMware virtual adapters', () => {
    const fake = {
      'Ethernet (Docker Desktop)': [iface('172.17.0.1', 'IPv4', false)],
      'VirtualBox Host-Only Network': [iface('192.168.56.1', 'IPv4', false)],
      'VMware Network Adapter VMnet1': [iface('192.168.150.1', 'IPv4', false)],
      'Ethernet': [iface('10.0.0.5', 'IPv4', false)],
    }
    expect(detectLanIp(fake)).toBe('10.0.0.5')
  })

  it('falls back to a virtual adapter address if that is the only candidate available', () => {
    const fake = {
      'vEthernet (WSL (Hyper-V firewall))': [iface('172.24.224.1', 'IPv4', false)],
    }
    expect(detectLanIp(fake)).toBe('172.24.224.1')
  })
})
