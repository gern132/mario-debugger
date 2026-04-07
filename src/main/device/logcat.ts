import { spawn, ChildProcess } from 'child_process'
import type { BrowserWindow } from 'electron'
import { findAdb } from './adb'
import type { LogEntry, LogMode } from '@shared/types'

let proc: ChildProcess | null = null
let idCounter = 0

export function stopLogcat(): void {
  if (proc) {
    proc.kill()
    proc = null
  }
}

export async function startLogcat(
  win: BrowserWindow,
  device: string | undefined,
  mode: LogMode
): Promise<void> {
  stopLogcat()

  const adb = await findAdb()
  const args: string[] = []
  if (device) { args.push('-s', device) }
  args.push('logcat', '-v', 'threadtime', '-T', '1')

  if (mode === 'rn') {
    // RN-specific tags only
    args.push('ReactNative:V', 'ReactNativeJS:V', 'EXCEPTION:V', 'AndroidRuntime:E', '*:S')
  }

  proc = spawn(adb, args)

  let buffer = ''

  proc.stdout?.on('data', (chunk: Buffer) => {
    buffer += chunk.toString()
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const entry = parseLine(line)
      if (entry && !win.isDestroyed()) {
        win.webContents.send('log-entry', entry)
      }
    }
  })

  proc.on('error', () => {
    proc = null
  })

  proc.on('exit', () => {
    proc = null
  })
}

function parseLine(line: string): LogEntry | null {
  // threadtime format:
  // "MM-DD HH:MM:SS.mmm  PID  TID L TAG: message"
  const m = line.match(
    /^\d{2}-\d{2}\s+(\d{2}:\d{2}:\d{2}\.\d{3})\s+\d+\s+\d+\s+([VDIWEF])\s+([^:]+):\s*(.*)/
  )
  if (!m) return null

  const [, time, levelChar, tag, message] = m

  const level: LogEntry['level'] =
    levelChar === 'I' ? 'info'
    : levelChar === 'W' ? 'warn'
    : levelChar === 'E' || levelChar === 'F' ? 'error'
    : 'debug'

  return {
    id: String(++idCounter),
    time,
    level,
    tag: tag.trim(),
    message: message.trim(),
  }
}
