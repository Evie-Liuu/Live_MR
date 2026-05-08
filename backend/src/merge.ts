import { spawn } from 'child_process'
import path from 'path'
import fs from 'fs'

/**
 * Wait for a file to appear on disk, polling every second.
 * Rejects after timeoutMs.
 */
function waitForFile(filePath: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const check = () => {
      if (fs.existsSync(filePath)) return resolve()
      if (Date.now() - start > timeoutMs) {
        return reject(new Error(`Timeout waiting for file: ${filePath}`))
      }
      setTimeout(check, 1000)
    }
    check()
  })
}

/** Run ffmpeg with the given args; resolves on exit code 0, rejects otherwise. */
function runFFmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', ['-y', ...args])
    proc.stderr.on('data', (chunk: Buffer) => {
      process.stdout.write(`[ffmpeg] ${chunk.toString()}`)
    })
    proc.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg exited with code ${code}`))
    })
    proc.on('error', reject)
  })
}

/**
 * Merge bigscreen.webm + per-participant audio files into output.mp4.
 *
 * Audio priority per participant: .ogg (LiveKit Egress) > .webm (client-side).
 * Waits up to 30 s for bigscreen.webm to be uploaded before proceeding.
 *
 * @param dir       Absolute filesystem path to the recording folder
 * @param identities Participant identities to include in the mix
 * @returns Absolute path of the generated output.mp4
 */
export async function mergeRecording(
  dir: string,
  identities: string[],
): Promise<string> {
  const bigscreenPath = path.join(dir, 'bigscreen.webm')
  const outputPath = path.join(dir, 'output.mp4')

  // Wait for BigScreen to finish uploading (it uploads after receiving recording-stop)
  await waitForFile(bigscreenPath, 30_000)

  // Collect available audio files, one per participant
  const audioInputs: string[] = []
  for (const identity of identities) {
    const oggPath = path.join(dir, `audio_${identity}.ogg`)
    const webmPath = path.join(dir, `audio_${identity}.webm`)
    if (fs.existsSync(oggPath)) audioInputs.push(oggPath)
    else if (fs.existsSync(webmPath)) audioInputs.push(webmPath)
  }

  const args: string[] = ['-i', bigscreenPath]
  for (const a of audioInputs) args.push('-i', a)

  if (audioInputs.length === 0) {
    // No audio tracks — video only
    args.push('-c:v', 'copy', outputPath)
  } else if (audioInputs.length === 1) {
    args.push('-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', outputPath)
  } else {
    // Mix all audio tracks; normalize=0 preserves individual levels
    const filterIn = audioInputs.map((_, i) => `[${i + 1}:a]`).join('')
    args.push(
      '-filter_complex',
      `${filterIn}amix=inputs=${audioInputs.length}:duration=longest:normalize=0[a]`,
      '-map', '0:v',
      '-map', '[a]',
      '-c:v', 'copy',
      '-c:a', 'aac',
      outputPath,
    )
  }

  await runFFmpeg(args)
  return outputPath
}
