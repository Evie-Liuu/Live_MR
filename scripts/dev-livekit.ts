import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildLivekitConfig } from '../backend/src/launcher/livekitConfig.js'
import { LiveKitProcess } from '../backend/src/launcher/livekitProcess.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const LIVEKIT_BIN = path.join(ROOT, '.build-cache', 'livekit-server.exe')

async function main(): Promise<void> {
  if (!fs.existsSync(LIVEKIT_BIN)) {
    console.error(`找不到 ${LIVEKIT_BIN}。請先執行：node scripts/fetch-livekit-server.mjs`)
    process.exit(1)
  }

  const configYaml = buildLivekitConfig({
    nodeIp: '127.0.0.1',
    apiKey: 'devkey',
    apiSecret: 'devsecret1234567890devsecret1234567890',
  })

  const livekit = new LiveKitProcess()
  await livekit.start({
    binPath: LIVEKIT_BIN,
    configYaml,
    workDir: path.join(ROOT, '.build-cache', 'livekit-dev-data'),
    port: 7880,
  })

  console.log('LiveKit（dev，僅 localhost）已啟動：ws://127.0.0.1:7880\n按 Ctrl+C 結束。')

  const shutdown = async (): Promise<void> => {
    console.log('\n正在關閉 LiveKit...')
    await livekit.stop()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((err) => {
  console.error('啟動失敗：', err)
  process.exit(1)
})
