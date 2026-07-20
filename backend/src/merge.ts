import { spawn } from 'child_process'
import path from 'path'
import fs from 'fs'
import ffmpegPath from 'ffmpeg-static';

/**
 * Wait for a file to exist AND stop growing (two consecutive 1-second polls with
 * identical non-zero size). This is necessary for chunked streaming uploads where
 * the file is created with the first chunk and continues to grow until the last
 * chunk is written — checking existence alone would cause ffmpeg to read a
 * partial file.
 */
async function waitForFileStable(filePath: string, timeoutMs: number): Promise<void> {
  const start = Date.now()
  let lastSize = -1
  let stableCount = 0

  while (Date.now() - start < timeoutMs) {
    if (fs.existsSync(filePath)) {
      const size = fs.statSync(filePath).size
      if (size > 0 && size === lastSize) {
        stableCount++
        if (stableCount >= 2) return // stable for 2 consecutive seconds → upload complete
      } else {
        stableCount = 0
        lastSize = size
      }
    } else {
      stableCount = 0
      lastSize = -1
    }
    await new Promise<void>(r => setTimeout(r, 1000))
  }
  throw new Error(`Timeout waiting for file to complete: ${filePath}`)
}

/**
 * Wait for all audio files (audio_*.webm) in the directory to finish
 * writing. Polls every second; resolves once every found file has had an identical
 * non-zero size for two consecutive polls, OR when timeoutMs elapses (proceeds
 * with whatever is available rather than throwing).
 *
 * Gives client-side .webm uploads time to land before ffmpeg runs.
 */
async function waitForAudioFilesStable(dir: string, timeoutMs: number): Promise<void> {
  const start = Date.now()
  const prevSizes = new Map<string, number>()
  let stableCount = 0

  while (Date.now() - start < timeoutMs) {
    await new Promise<void>(r => setTimeout(r, 1000))

    let entries: string[]
    try {
      entries = fs.readdirSync(dir).filter(
        f => f.startsWith('audio_') && f.endsWith('.webm'),
      )
    } catch {
      continue
    }

    if (entries.length === 0) {
      stableCount = 0
      continue
    }

    let allStable = true
    for (const f of entries) {
      try {
        const size = fs.statSync(path.join(dir, f)).size
        const prev = prevSizes.get(f)
        if (prev === undefined || size !== prev || size === 0) allStable = false
        prevSizes.set(f, size)
      } catch {
        allStable = false
      }
    }

    if (allStable) {
      stableCount++
      if (stableCount >= 2) return
    } else {
      stableCount = 0
    }
  }
  // Timeout — proceed with whatever files are present rather than erroring
}

/** Run ffmpeg with the given args; resolves on exit code 0, rejects otherwise. */
function runFFmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const ffmpegExecutable = (ffmpegPath as unknown as string) || 'ffmpeg';
    const proc = spawn(ffmpegExecutable, ['-y', ...args])
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
 * Audio discovery: scans the directory for all audio_*.webm files
 * rather than relying solely on the identity list — this captures participants whose
 * client-side upload arrived late.
 *
 * Waits up to 30 s for bigscreen.webm to finish uploading, then up to 20 s for
 * audio files to finish writing, before invoking ffmpeg.
 *
 * @param dir        Absolute filesystem path to the recording folder
 * @param identities Participant identities (used only for logging)
 * @returns Absolute path of the generated output.mp4
 */
export async function mergeRecording(
  dir: string,
  identities: string[],
): Promise<string> {
  const bigscreenPath = path.join(dir, 'bigscreen.webm')
  const outputPath = path.join(dir, 'output.mp4')

  // Wait for BigScreen canvas upload to finish (chunked streaming creates the file
  // on the first chunk, so we must wait for size to be stable, not just for existence).
  await waitForFileStable(bigscreenPath, 30_000)

  // Wait for client-side (.webm) audio files to stabilise.
  // Without this wait the files may not exist or may still be growing when ffmpeg opens them.
  await waitForAudioFilesStable(dir, 20_000)

  // Scan the directory for all audio files — don't rely on the identity list alone,
  // because client-side uploads may have added identities not tracked at start time.
  const dirEntries = fs.readdirSync(dir)
  const audioInputs: string[] = []

  for (const f of dirEntries) {
    if (f.startsWith('audio_') && f.endsWith('.webm')) {
      audioInputs.push(path.join(dir, f))
    }
  }

  console.log(`[merge] identities=${identities.join(',') || '(none)'} audioFiles=[${audioInputs.map(p => path.basename(p)).join(', ')}]`)

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
