import { exec } from 'child_process'
import { promisify } from 'util'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import type { MemoryStats, PerformanceStats } from '@shared/types'

const execAsync = promisify(exec)

function run(cmd: string) {
  return execAsync(cmd)
}

// In a packaged .app macOS doesn't inherit the user's PATH so 'adb' won't be
// found as a bare command. We search known install locations once and cache it.
let _adbPath: string | null = null

async function findAdb(): Promise<string> {
  if (_adbPath) return _adbPath

  const home = os.homedir()
  const envSdk = process.env['ANDROID_HOME'] ?? process.env['ANDROID_SDK_ROOT']

  const candidates = [
    // env variable (works in dev, might work in release if set system-wide)
    envSdk ? path.join(envSdk, 'platform-tools/adb') : null,
    // Android Studio default locations
    path.join(home, 'Library/Android/sdk/platform-tools/adb'),
    path.join(home, 'Android/sdk/platform-tools/adb'),
    // Homebrew
    '/opt/homebrew/bin/adb',
    '/usr/local/bin/adb',
    // system
    '/usr/bin/adb',
  ].filter(Boolean) as string[]

  for (const p of candidates) {
    try { await fs.access(p); _adbPath = p; return p } catch { /* try next */ }
  }

  // Last resort: ask login shell (works in dev, may work in release)
  try {
    const { stdout } = await execAsync('/bin/zsh -l -c "which adb"')
    const found = stdout.trim()
    if (found) { _adbPath = found; return found }
  } catch { /* ignore */ }

  throw new Error(
    'adb not found. Install Android SDK platform-tools and ensure ' +
    '~/Library/Android/sdk/platform-tools/adb exists.'
  )
}

async function adb(args: string): Promise<string> {
  const bin = await findAdb()
  const { stdout } = await run(`"${bin}" ${args}`)
  return stdout
}

// ── Devices ────────────────────────────────────────

export async function getConnectedDevices(): Promise<string[]> {
  try {
    const stdout = await adb('devices')
    return stdout
      .split('\n')
      .slice(1)
      .filter(line => line.includes('\tdevice'))
      .map(line => line.split('\t')[0].trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

// ── Package name detection ─────────────────────────

export async function detectPackageName(projectPath: string): Promise<string | null> {
  // 1. app.json (Expo)
  try {
    const raw = await fs.readFile(path.join(projectPath, 'app.json'), 'utf-8')
    const pkg = (JSON.parse(raw) as { expo?: { android?: { package?: string } } })
      ?.expo?.android?.package
    if (pkg) return pkg
  } catch { /* ignore */ }

  // 2. android/app/build.gradle
  try {
    const gradle = await fs.readFile(
      path.join(projectPath, 'android/app/build.gradle'),
      'utf-8'
    )
    const match = gradle.match(/applicationId\s+["']([^"']+)["']/)
    if (match) return match[1]
  } catch { /* ignore */ }

  return null
}

// ── Memory ─────────────────────────────────────────

function escRe(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

export async function getMemoryStats(
  packageName: string,
  device?: string
): Promise<MemoryStats & { _raw: string }> {
  const flag = device ? `-s ${device}` : ''

  // Step 1 — global overview: extract total PSS and PID for our app
  const overview = await adb(`${flag} shell dumpsys meminfo ${packageName}`)

  // "    802,765K: app.puzzleplay.client (pid 10306 / activities)"
  const pssMatch = overview.match(new RegExp(`([\\d,]+)K:\\s+${escRe(packageName)}`, 'i'))
  const totalFromOverview = pssMatch ? parseInt(pssMatch[1].replace(/,/g, ''), 10) : 0

  const pidMatch = overview.match(new RegExp(`${escRe(packageName)}.*?pid\\s+(\\d+)`, 'i'))
  const pid = pidMatch?.[1]

  // Step 2 — per-PID detail for breakdown (Native Heap, Java Heap, etc.)
  let detail = overview
  if (pid) {
    try {
      detail = await adb(`${flag} shell dumpsys meminfo ${pid}`)
    } catch { /* keep overview */ }
  }

  const stats = parseMemoryStats(detail)
  if (!stats.totalPss && totalFromOverview) stats.totalPss = totalFromOverview

  const rawLog = pid
    ? `=== Overview ===\n${overview}\n\n=== Detail (pid ${pid}) ===\n${detail}`
    : overview

  return { ...stats, _raw: rawLog }
}

function parseMemoryStats(raw: string): MemoryStats {
  // Strategy 1: "App Summary" block — Android 8+ clean format
  //   Java Heap:    15234
  //   Native Heap:  42156
  const summary = (key: string): number => {
    const re = new RegExp(`^\\s*${key}:\\s*([\\d,]+)`, 'im')
    const m = raw.match(re)
    return m ? parseInt(m[1].replace(/,/g, ''), 10) : 0
  }

  // Strategy 2: table rows — "  Native Heap    42156    ..."
  // Uses ^ + multiline so we match start of line precisely
  const table = (key: string): number => {
    const esc = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(`^[ \\t]+${esc}[ \\t]+(\\d+)`, 'im')
    const m = raw.match(re)
    return m ? parseInt(m[1], 10) : 0
  }

  // TOTAL PSS — try both App Summary label and raw TOTAL row
  const totalPss =
    summary('TOTAL PSS') ||
    (() => {
      const m = raw.match(/^\s+TOTAL\s+(\d+)/im)
      return m ? parseInt(m[1], 10) : 0
    })()

  // Java / Dalvik Heap
  const javaHeap =
    summary('Java Heap') || table('Dalvik Heap') || table('Java Heap')

  // Native Heap
  const nativeHeap = summary('Native Heap') || table('Native Heap')

  // Code
  const code =
    summary('Code') ||
    table('\\.so mmap') + table('\\.jar mmap') + table('\\.apk mmap') + table('\\.dex mmap')

  // Stack
  const stack = summary('Stack') || table('Stack')

  // Graphics — EGL + GL tracks
  const graphics =
    summary('Graphics') || table('EGL mtrack') + table('GL mtrack')

  // System / Other
  const system =
    summary('System') || summary('Private Other') || table('Unknown')

  return { totalPss, javaHeap, nativeHeap, code, stack, graphics, system, timestamp: new Date().toISOString() }
}

// ── Performance ────────────────────────────────────

// Reset gfx stats — call at session start
export async function resetGfxStats(packageName: string, device?: string): Promise<void> {
  const flag = device ? `-s ${device}` : ''
  await adb(`${flag} shell dumpsys gfxinfo ${packageName} reset`)
}

export async function readPerformanceStats(
  packageName: string,
  device?: string
): Promise<PerformanceStats> {
  const flag = device ? `-s ${device}` : ''
  const stdout = await adb(`${flag} shell dumpsys gfxinfo ${packageName}`)
  return parsePerformanceStats(stdout)
}

function num(raw: string, re: RegExp): number {
  const m = raw.match(re)
  return m ? parseInt(m[1].replace(/,/g, ''), 10) : 0
}

function parsePerformanceStats(raw: string): PerformanceStats {
  const jankyMatch = raw.match(/Janky frames:\s+([\d,]+)\s+\(([\d.]+)%\)/)

  return {
    totalFrames:  num(raw, /Total frames rendered:\s+([\d,]+)/),
    jankyFrames:  jankyMatch ? parseInt(jankyMatch[1].replace(/,/g, ''), 10) : 0,
    jankyPercent: jankyMatch ? parseFloat(jankyMatch[2]) : 0,
    p50: num(raw, /50th percentile:\s+(\d+)ms/),
    p90: num(raw, /90th percentile:\s+(\d+)ms/),
    p95: num(raw, /95th percentile:\s+(\d+)ms/),
    p99: num(raw, /99th percentile:\s+(\d+)ms/),
    slowUiThread: num(raw, /Number Slow UI thread:\s+([\d,]+)/),
    missedVsync:  num(raw, /Number Missed Vsync:\s+([\d,]+)/),
    timestamp:    new Date().toISOString(),
  }
}
