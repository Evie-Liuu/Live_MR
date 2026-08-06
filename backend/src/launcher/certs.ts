import fs from 'node:fs'
import path from 'node:path'
import selfsigned from 'selfsigned'

// 憑證格式版本：每當產生憑證的參數（簽章演算法、金鑰長度等）變動導致既有憑證
// 需要強制換發時就遞增此值，讓舊版（例如 v1 的 sha1 簽章）憑證自動被判定為過期。
// v2：簽章演算法改為 sha256（弱點掃描修正：SHA-1 簽章憑證）。
// v3：改由本機 CA 簽發（弱點掃描修正：自簽憑證 Issuer==Subject 判定為弱憑證）。
const CERT_FORMAT_VERSION = '3'

/**
 * 確保 certsDir 下有一份本機 CA（key+cert）；已存在就直接沿用，否則產生一份
 * 效期較長（10 年）的 CA，之後每次 IP 變動只需重簽 leaf 憑證，不需重建 CA。
 */
async function ensureCa(certsDir: string): Promise<{ key: string; cert: string }> {
  const caKeyPath = path.join(certsDir, 'ca-key.pem')
  const caCertPath = path.join(certsDir, 'ca-cert.pem')

  if (fs.existsSync(caKeyPath) && fs.existsSync(caCertPath)) {
    return { key: fs.readFileSync(caKeyPath, 'utf8'), cert: fs.readFileSync(caCertPath, 'utf8') }
  }

  fs.mkdirSync(certsDir, { recursive: true })

  const notBeforeDate = new Date()
  const notAfterDate = new Date(notBeforeDate)
  notAfterDate.setFullYear(notAfterDate.getFullYear() + 10)

  const ca = await selfsigned.generate(
    [{ name: 'commonName', value: 'LiveMR Local CA' }],
    {
      keySize: 2048,
      algorithm: 'sha256',
      notBeforeDate,
      notAfterDate,
      extensions: [
        { name: 'basicConstraints', cA: true, critical: true },
        { name: 'keyUsage', keyCertSign: true, cRLSign: true, digitalSignature: true, critical: true },
      ],
    },
  )

  fs.writeFileSync(caKeyPath, ca.private)
  fs.writeFileSync(caCertPath, ca.cert)

  return { key: ca.private, cert: ca.cert }
}

/**
 * 確保 certsDir 下有一份綁定 ip、由本機 CA 簽發的憑證；若既有憑證的 ip.txt 側記檔案
 * 與目前 ip、憑證格式版本相符就直接沿用，否則（IP 變更、格式升級或憑證不存在）重新產生。
 * 取代 setup.ps1 呼叫 openssl.exe 的行為，改用純 JS，不需要 Git for Windows。
 */
export async function ensureCert(
  certsDir: string,
  ip: string,
): Promise<{ certPath: string; keyPath: string; caCertPath: string }> {
  const certPath = path.join(certsDir, 'cert.pem')
  const keyPath = path.join(certsDir, 'key.pem')
  const caCertPath = path.join(certsDir, 'ca-cert.pem')
  const ipMarkerPath = path.join(certsDir, 'ip.txt')

  const [existingIp, existingVersion] = fs.existsSync(ipMarkerPath)
    ? fs.readFileSync(ipMarkerPath, 'utf8').trim().split('\n')
    : [null, null]

  if (
    existingIp === ip &&
    existingVersion === CERT_FORMAT_VERSION &&
    fs.existsSync(certPath) &&
    fs.existsSync(keyPath) &&
    fs.existsSync(caCertPath)
  ) {
    return { certPath, keyPath, caCertPath }
  }

  fs.mkdirSync(certsDir, { recursive: true })

  const ca = await ensureCa(certsDir)

  const pems = await selfsigned.generate(
    [{ name: 'commonName', value: ip }],
    {
      // selfsigned v5 removed the `days` option (default validity is already 365
      // days); keeping it caused a tsc error against SelfsignedOptions.
      keySize: 2048,
      // 弱點掃描修正：selfsigned 預設簽章演算法是 sha1，明確指定 sha256 避免產生弱憑證。
      algorithm: 'sha256',
      // 弱點掃描修正：改由本機 CA 簽發，讓 leaf 憑證的 Issuer 不再等於 Subject，
      // 不再被判定為自簽憑證。CA 只存在伺服器端，不需分發給使用者裝置。
      ca,
      extensions: [
        { name: 'basicConstraints', cA: false },
        { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
        { name: 'extKeyUsage', serverAuth: true },
        { name: 'subjectAltName', altNames: [{ type: 7, ip }] },
      ],
    },
  )

  fs.writeFileSync(certPath, pems.cert)
  fs.writeFileSync(keyPath, pems.private)
  fs.writeFileSync(ipMarkerPath, `${ip}\n${CERT_FORMAT_VERSION}`)

  return { certPath, keyPath, caCertPath }
}
