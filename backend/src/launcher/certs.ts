import fs from 'node:fs'
import path from 'node:path'
import selfsigned from 'selfsigned'

// 憑證格式版本：每當產生憑證的參數（簽章演算法、金鑰長度等）變動導致既有憑證
// 需要強制換發時就遞增此值，讓舊版（例如 v1 的 sha1 簽章）憑證自動被判定為過期。
// v2：簽章演算法改為 sha256（弱點掃描修正：SHA-1 簽章憑證）。
const CERT_FORMAT_VERSION = '2'

/**
 * 確保 certsDir 下有一份綁定 ip 的自簽憑證；若既有憑證的 ip.txt 側記檔案
 * 與目前 ip、憑證格式版本相符就直接沿用，否則（IP 變更、格式升級或憑證不存在）重新產生。
 * 取代 setup.ps1 呼叫 openssl.exe 的行為，改用純 JS，不需要 Git for Windows。
 */
export async function ensureCert(
  certsDir: string,
  ip: string,
): Promise<{ certPath: string; keyPath: string }> {
  const certPath = path.join(certsDir, 'cert.pem')
  const keyPath = path.join(certsDir, 'key.pem')
  const ipMarkerPath = path.join(certsDir, 'ip.txt')

  const [existingIp, existingVersion] = fs.existsSync(ipMarkerPath)
    ? fs.readFileSync(ipMarkerPath, 'utf8').trim().split('\n')
    : [null, null]

  if (
    existingIp === ip &&
    existingVersion === CERT_FORMAT_VERSION &&
    fs.existsSync(certPath) &&
    fs.existsSync(keyPath)
  ) {
    return { certPath, keyPath }
  }

  fs.mkdirSync(certsDir, { recursive: true })

  const pems = await selfsigned.generate(
    [{ name: 'commonName', value: ip }],
    {
      // selfsigned v5 removed the `days` option (default validity is already 365
      // days); keeping it caused a tsc error against SelfsignedOptions.
      keySize: 2048,
      // 弱點掃描修正：selfsigned 預設簽章演算法是 sha1，明確指定 sha256 避免產生弱憑證。
      algorithm: 'sha256',
      extensions: [
        { name: 'basicConstraints', cA: false },
        { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
        { name: 'subjectAltName', altNames: [{ type: 7, ip }] },
      ],
    },
  )

  fs.writeFileSync(certPath, pems.cert)
  fs.writeFileSync(keyPath, pems.private)
  fs.writeFileSync(ipMarkerPath, `${ip}\n${CERT_FORMAT_VERSION}`)

  return { certPath, keyPath }
}
