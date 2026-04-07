import { useState } from 'react'

type JsonVal = string | number | boolean | null | JsonVal[] | { [k: string]: JsonVal }

// ── Parse helpers ─────────────────────────────────

type ParsedPart =
  | { type: 'text'; value: string }
  | { type: 'json'; value: JsonVal }

// Hermes formats console.log args as space-separated tokens where objects/arrays
// are valid JSON and primitives are plain strings. We scan left-to-right:
// on { or [ we attempt one JSON extraction; on failure we advance one char.
export function tryParseLogMessage(raw: string): { parts: ParsedPart[] } {
  const parts: ParsedPart[] = []
  let i = 0
  let textStart = 0

  while (i < raw.length) {
    const ch = raw[i]
    if (ch === '{' || ch === '[') {
      const text = raw.slice(textStart, i).trim()
      if (text) parts.push({ type: 'text', value: text })

      const result = extractJson(raw, i)
      if (result) {
        parts.push({ type: 'json', value: result.value })
        i = result.end
      } else {
        i++ // not JSON — advance past this char to avoid infinite loop
      }
      textStart = i
    } else {
      i++
    }
  }

  const tail = raw.slice(textStart).trim()
  if (tail) parts.push({ type: 'text', value: tail })

  return { parts }
}

// Max chars to scan per extraction attempt — guards against huge stack traces
const MAX_JSON_SCAN = 50_000

function extractJson(str: string, start: number): { value: JsonVal; end: number } | null {
  const open  = str[start] as '{' | '['
  const close = open === '{' ? '}' : ']'
  const limit = Math.min(str.length, start + MAX_JSON_SCAN)
  let depth   = 0
  let inStr   = false
  let escape  = false
  // Track string delimiter to handle both ' and "
  let strChar = ''

  for (let i = start; i < limit; i++) {
    const c = str[i]
    if (escape)                    { escape = false; continue }
    if (c === '\\' && inStr)       { escape = true;  continue }
    if (inStr) {
      if (c === strChar)           { inStr = false }
      continue
    }
    if (c === '"' || c === '\'')   { inStr = true; strChar = c; continue }
    if (c === open)                depth++
    else if (c === close) {
      depth--
      if (depth === 0) {
        const slice = str.slice(start, i + 1)
        // Try strict JSON first
        try { return { value: JSON.parse(slice) as JsonVal, end: i + 1 } } catch { /* */ }
        // Try converting JS literal notation (unquoted keys, single-quoted strings, etc.)
        const val = jsLiteralToJsonVal(slice)
        if (val !== null) return { value: val, end: i + 1 }
        return null
      }
    }
  }
  return null
}

// Convert JS object/array literal notation to a JSON-parseable value.
// Handles: unquoted keys, single-quoted strings, undefined, NaN, Infinity, trailing commas.
function jsLiteralToJsonVal(raw: string): JsonVal | null {
  try {
    let s = raw.trim()

    // Single-quoted strings → double-quoted (handles escaped single quotes inside)
    s = s.replace(/'((?:[^'\\]|\\.)*)'/g, (_, inner: string) => {
      const escaped = inner.replace(/\\'/g, "'").replace(/"/g, '\\"')
      return `"${escaped}"`
    })

    // Unquoted object keys → quoted  { key: → { "key":
    s = s.replace(/([{,]\s*)([a-zA-Z_$][a-zA-Z0-9_$]*)(\s*:)/g, '$1"$2"$3')

    // JS-only literals → JSON equivalents
    s = s.replace(/\bundefined\b/g, 'null')
    s = s.replace(/\bNaN\b/g, 'null')
    s = s.replace(/\b-?Infinity\b/g, 'null')

    // Trailing commas before } or ]
    s = s.replace(/,(\s*[}\]])/g, '$1')

    return JSON.parse(s) as JsonVal
  } catch {
    return null
  }
}

// ── Preview ───────────────────────────────────────

function preview(val: JsonVal, budget = 60): string {
  if (val === null) return 'null'
  if (typeof val === 'string') {
    const s = val.length > 40 ? val.slice(0, 40) + '…' : val
    return `"${s}"`
  }
  if (typeof val === 'number' || typeof val === 'boolean') return String(val)

  if (Array.isArray(val)) {
    if (val.length === 0) return '[]'
    const inner = val.slice(0, 4).map(v => previewShort(v)).join(', ')
    const more = val.length > 4 ? ', …' : ''
    return `(${val.length}) [${inner}${more}]`
  }

  // object
  const keys = Object.keys(val)
  if (keys.length === 0) return '{}'
  let acc = '{'
  let spent = 1
  for (const k of keys) {
    const chunk = `${k}: ${previewShort(val[k])}, `
    if (spent + chunk.length > budget) { acc += '…'; break }
    acc += chunk
    spent += chunk.length
  }
  return acc.replace(/, $/, '') + '}'
}

function previewShort(val: JsonVal): string {
  if (val === null) return 'null'
  if (typeof val === 'string') {
    const s = val.slice(0, 12)
    return val.length > 12 ? ('"' + s + '…"') : ('"' + val + '"')
  }
  if (typeof val !== 'object') return String(val)
  if (Array.isArray(val)) return val.length === 0 ? '[]' : '[…]'
  return Object.keys(val).length === 0 ? '{}' : '{…}'
}

// ── Node components ───────────────────────────────

interface NodeProps {
  label?: string | number
  value: JsonVal
  depth: number
  defaultExpanded?: boolean
}

export function JsonNode({ label, value, depth, defaultExpanded = false }: NodeProps) {
  const [open, setOpen] = useState(defaultExpanded)
  const isComplex = value !== null && typeof value === 'object'
  const indent = depth * 14

  if (!isComplex) {
    return (
      <div className="jt-row" style={{ paddingLeft: indent + 16 }}>
        {label !== undefined && <span className="jt-key">{label}: </span>}
        <Primitive value={value} />
      </div>
    )
  }

  const isArr = Array.isArray(value)
  const entries = isArr
    ? (value as JsonVal[]).map((v, i) => [i, v] as [number | string, JsonVal])
    : Object.entries(value as Record<string, JsonVal>)

  return (
    <div>
      <div
        className="jt-row jt-expandable"
        style={{ paddingLeft: indent }}
        onClick={() => setOpen(o => !o)}
      >
        <span className="jt-arrow">{open ? '▼' : '▶'}</span>
        {label !== undefined && <span className="jt-key">{label}: </span>}
        {open ? (
          <span className="jt-preview-open">{isArr ? '[' : '{'}</span>
        ) : (
          <span className="jt-preview">{preview(value)}</span>
        )}
      </div>

      {open && (
        <div>
          {entries.map(([k, v]) => (
            <JsonNode key={String(k)} label={k} value={v} depth={depth + 1} />
          ))}
          {isArr && (
            <div className="jt-row jt-meta" style={{ paddingLeft: (depth + 1) * 14 + 16 }}>
              <span className="jt-key">length: </span>
              <span className="jt-number">{(value as JsonVal[]).length}</span>
            </div>
          )}
          <div className="jt-row" style={{ paddingLeft: indent + 16 }}>
            <span className="jt-preview-open">{isArr ? ']' : '}'}</span>
          </div>
        </div>
      )}
    </div>
  )
}

function Primitive({ value }: { value: string | number | boolean | null }) {
  if (value === null)            return <span className="jt-null">null</span>
  if (typeof value === 'boolean') return <span className="jt-bool">{String(value)}</span>
  if (typeof value === 'number')  return <span className="jt-number">{value}</span>
  return <span className="jt-string">"{value}"</span>
}

// ── Top-level renderer ────────────────────────────

interface LogMessageProps {
  message: string
}

export function LogMessage({ message }: LogMessageProps) {
  const { parts } = tryParseLogMessage(message)

  // If nothing parsed as JSON — just plain text
  if (parts.every(p => p.type === 'text')) {
    return <span className="log-message">{message}</span>
  }

  return (
    <div className="log-message log-message-rich">
      {parts.map((part, i) => {
        if (part.type === 'text') {
          return <span key={i} className="jt-inline-text">{part.value}</span>
        }
        return (
          <div key={i} className="jt-root">
            <JsonNode value={part.value} depth={0} defaultExpanded={false} />
          </div>
        )
      })}
    </div>
  )
}
