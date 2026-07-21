import os from 'node:os'

/**
 * 常見虛擬網卡的介面名稱關鍵字（Hyper-V/WSL2、Docker Desktop、VirtualBox、
 * VMware、常見 VPN 客戶端）。教師電腦常同時裝這些工具，它們的虛擬網卡也會
 * 拿到一個非 internal 的 IPv4，若被誤選會導致憑證/LiveKit 綁到一個學生裝置
 * 連不到的位址，且完全沒有錯誤訊息——這比選錯 IP 本身更難排查，所以優先
 * 排除這些已知模式，而不是單純依賴 os.networkInterfaces() 的列舉順序。
 */
const VIRTUAL_ADAPTER_NAME_PATTERN =
  /vEthernet|Hyper-V|WSL|Virtual|VMware|VirtualBox|Docker|Tailscale|ZeroTier|Npcap|Loopback/i

/**
 * 偵測本機區網 IPv4 位址。移植自 setup.ps1 的 Get-LanIP：排除 loopback（127.x）
 * 與 link-local（169.254.x）。Node 不像 Windows Get-NetIPAddress 能查
 * PrefixOrigin=Dhcp，這裡改用「介面名稱關聯的虛擬網卡黑名單」做同樣目的的近似：
 * 優先選非虛擬網卡的位址；若排除後完全沒有候選（不尋常的環境），才退回列舉到
 * 的第一個非內部 IPv4，避免直接回傳 null 讓工具完全無法啟動。
 */
export function detectLanIp(
  interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces(),
): string | null {
  const candidates: string[] = []

  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] ?? []) {
      if (
        iface.family === 'IPv4' &&
        !iface.internal &&
        !iface.address.startsWith('169.254.')
      ) {
        if (!VIRTUAL_ADAPTER_NAME_PATTERN.test(name)) {
          return iface.address
        }
        candidates.push(iface.address)
      }
    }
  }

  return candidates[0] ?? null
}
