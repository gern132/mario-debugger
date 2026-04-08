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

export async function findAdb(): Promise<string> {
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

export async function detectBuildType(
  packageName: string,
  device?: string
): Promise<'debug' | 'release' | 'unknown'> {
  try {
    const flag = device ? `-s ${device}` : ''
    const stdout = await adb(`${flag} shell dumpsys package ${packageName}`)
    const match = stdout.match(/pkgFlags=\[([^\]]+)\]/)
    if (!match) return 'unknown'
    return match[1].includes('DEBUGGABLE') ? 'debug' : 'release'
  } catch {
    return 'unknown'
  }
}

export async function getMemoryStats(
  packageName: string,
  device?: string
): Promise<MemoryStats & { _raw: string }> {
  const flag = device ? `-s ${device}` : ''

  // Run meminfo and build-type detection in parallel
  const [overview, buildType] = await Promise.all([
    adb(`${flag} shell dumpsys meminfo ${packageName}`),
    detectBuildType(packageName, device),
  ])

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

  return { ...stats, buildType, _raw: rawLog }
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

  // TOTAL PSS — try all known labels
  const totalPss =
    summary('TOTAL PSS') ||
    summary('Total PSS') ||
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

  // "Other" = Private Other (app-controlled anonymous allocs: JIT, misc mmap).
  // "System" in App Summary is proportional shared-library overhead — tracked
  // separately as the discrepancy between totalPss and the sum of named buckets.
  const system =
    summary('Private Other') ||
    summary('System') ||
    table('Other') ||
    table('Unknown')

  return { totalPss, javaHeap, nativeHeap, code, stack, graphics, system, buildType: 'unknown', timestamp: new Date().toISOString() }
}

// ── Performance ────────────────────────────────────

// Reset gfx stats — call at session start
export async function resetGfxStats(packageName: string, device?: string): Promise<void> {
  const flag = device ? `-s ${device}` : ''
  await adb(`${flag} shell dumpsys gfxinfo ${packageName} reset`)
}

async function getRefreshRate(device?: string): Promise<number> {
  try {
    const flag = device ? `-s ${device}` : ''
    const stdout = await adb(`${flag} shell dumpsys display`)
    const m = stdout.match(/refreshRate=(\d+\.?\d*)/) ?? stdout.match(/\bfps=(\d+\.?\d*)/)
    if (m) return Math.round(parseFloat(m[1]))
    return 60
  } catch {
    return 60
  }
}

export async function readPerformanceStats(
  packageName: string,
  device?: string
): Promise<PerformanceStats> {
  const flag = device ? `-s ${device}` : ''
  const [stdout, buildType, refreshRate] = await Promise.all([
    adb(`${flag} shell dumpsys gfxinfo ${packageName}`),
    detectBuildType(packageName, device),
    getRefreshRate(device),
  ])
  return parsePerformanceStats(stdout, buildType, refreshRate)
}

function num(raw: string, re: RegExp): number {
  const m = raw.match(re)
  return m ? parseInt(m[1].replace(/,/g, ''), 10) : 0
}

// Parse HISTOGRAM: 5ms=450 6ms=200 ...
// Each "Xms=N" bucket = N frames whose render time was in that range.
// Buckets: 5,6,7...30,32,34,36,38,40,42,44,46,48,53,57,61...
// We use >32ms as "severe" (user-visible stutter) and 17-32ms as "mild" (borderline).
function parseHistogram(raw: string): { mild: number; severe: number } {
  const match = raw.match(/HISTOGRAM:\s+(.+)/m)
  if (!match) return { mild: 0, severe: 0 }
  let mild = 0
  let severe = 0
  for (const [, msStr, countStr] of match[1].matchAll(/(\d+)ms=(\d+)/g)) {
    const ms    = parseInt(msStr, 10)
    const count = parseInt(countStr, 10)
    if (ms > 32)       severe += count
    else if (ms >= 17) mild   += count
  }
  return { mild, severe }
}

function parsePerformanceStats(
  raw: string,
  buildType: PerformanceStats['buildType'] = 'unknown',
  refreshRate = 60,
): PerformanceStats {
  const jankyMatch = raw.match(/Janky frames:\s+([\d,]+)\s+\(([\d.]+)%\)/)
  const { mild, severe } = parseHistogram(raw)

  return {
    totalFrames:       num(raw, /Total frames rendered:\s+([\d,]+)/),
    jankyFrames:       jankyMatch ? parseInt(jankyMatch[1].replace(/,/g, ''), 10) : 0,
    jankyPercent:      jankyMatch ? parseFloat(jankyMatch[2]) : 0,
    mildJankFrames:    mild,
    severeJankFrames:  severe,
    p50:  num(raw, /50th percentile:\s+(\d+)ms/),
    p90:  num(raw, /90th percentile:\s+(\d+)ms/),
    p95:  num(raw, /95th percentile:\s+(\d+)ms/),
    p99:  num(raw, /99th percentile:\s+(\d+)ms/),
    slowUiThread:      num(raw, /Number Slow UI thread:\s+([\d,]+)/),
    missedVsync:       num(raw, /Number Missed Vsync:\s+([\d,]+)/),
    slowBitmapUploads: num(raw, /Number Slow bitmap uploads:\s+([\d,]+)/),
    slowDrawCommands:  num(raw, /Number Slow issue draw commands:\s+([\d,]+)/),
    refreshRate,
    buildType,
    timestamp: new Date().toISOString(),
  }
}
