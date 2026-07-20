import os from 'node:os'

/**
 * 偵測本機區網 IPv4 位址。移植自 setup.ps1 的 Get-LanIP：排除 loopback（127.x）
 * 與 link-local（169.254.x），多個候選時取第一個（Node 不像 Windows
 * Get-NetIPAddress 能查 PrefixOrigin=Dhcp，這裡簡化為「第一個非內部 IPv4」）。
 */
export function detectLanIp(
  interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces(),
): string | null {
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] ?? []) {
      if (
        iface.family === 'IPv4' &&
        !iface.internal &&
        !iface.address.startsWith('169.254.')
      ) {
        return iface.address
      }
    }
  }
  return null
}
