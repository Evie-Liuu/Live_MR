import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'

function waitForHttp(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  return new Promise((resolve, reject) => {
    const attempt = (): void => {
      const req = http.get({ host: '127.0.0.1', port, path: '/', timeout: 1000 }, (res) => {
        res.resume()
        resolve()
      })
      req.on('error', () => {
        if (Date.now() > deadline) {
          reject(new Error(`LiveKit did not become ready on port ${port} within ${timeoutMs}ms`))
          return
        }
        setTimeout(attempt, 500)
      })
      req.on('timeout', () => req.destroy())
    }
    attempt()
  })
}

/** 管理 livekit-server.exe 子行程的生命週期。 */
export class LiveKitProcess {
  private child: ChildProcess | null = null

  async start(opts: {
    binPath: string
    configYaml: string
    workDir: string
    port?: number
  }): Promise<void> {
    fs.mkdirSync(opts.workDir, { recursive: true })
    const configPath = path.join(opts.workDir, 'livekit.generated.yaml')
    fs.writeFileSync(configPath, opts.configYaml)

    this.child = spawn(opts.binPath, ['--config', configPath], {
      stdio: 'inherit',
      windowsHide: true,
    })

    await waitForHttp(opts.port ?? 7880, 15_000)
  }

  async stop(): Promise<void> {
    const child = this.child
    this.child = null
    if (!child || child.exitCode !== null) return
    await new Promise<void>((resolve) => {
      child.once('exit', () => resolve())
      child.kill()
      // Windows 上 SIGTERM 對某些子行程無效，逾時後強制終止
      setTimeout(() => {
        if (child.exitCode === null) child.kill('SIGKILL')
      }, 3000)
    })
  }
}
