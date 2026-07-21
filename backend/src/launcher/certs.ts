import fs from 'node:fs'
import path from 'node:path'
import selfsigned from 'selfsigned'

/**
 * 確保 certsDir 下有一份綁定 ip 的自簽憑證；若既有憑證的 ip.txt 側記檔案
 * 與目前 ip 相符就直接沿用，否則（IP 變更或憑證不存在）重新產生。
 * 取代 setup.ps1 呼叫 openssl.exe 的行為，改用純 JS，不需要 Git for Windows。
 */
export async function ensureCert(
  certsDir: string,
  ip: string,
): Promise<{ certPath: string; keyPath: string }> {
  const certPath = path.join(certsDir, 'cert.pem')
  const keyPath = path.join(certsDir, 'key.pem')
  const ipMarkerPath = path.join(certsDir, 'ip.txt')

  const existingIp = fs.existsSync(ipMarkerPath)
    ? fs.readFileSync(ipMarkerPath, 'utf8').trim()
    : null

  if (existingIp === ip && fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    return { certPath, keyPath }
  }

  fs.mkdirSync(certsDir, { recursive: true })

  const pems = await selfsigned.generate(
    [{ name: 'commonName', value: ip }],
    {
      // selfsigned v5 removed the `days` option (default validity is already 365
      // days); keeping it caused a tsc error against SelfsignedOptions.
      keySize: 2048,
      extensions: [
        { name: 'basicConstraints', cA: false },
        { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
        { name: 'subjectAltName', altNames: [{ type: 7, ip }] },
      ],
    },
  )

  fs.writeFileSync(certPath, pems.cert)
  fs.writeFileSync(keyPath, pems.private)
  fs.writeFileSync(ipMarkerPath, ip)

  return { certPath, keyPath }
}
