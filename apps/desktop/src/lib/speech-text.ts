const EMOJI_RE = /(?:[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]|[\u{FE0F}\u{200D}]|[\u{E0020}-\u{E007F}])+/gu

const FENCED_CODE_RE = /```[\s\S]*?(?:```|$)/g
const INLINE_CODE_RE = /`([^`]+)`/g
const LIST_MARKER_LINE_RE = /^\s*(\d{1,3})[.)]\s+/gm
const MARKDOWN_LINK_RE = /\[([^\]]+)\]\(([^)]+)\)/g
const PARAGRAPH_BREAK_RE = /[ \t]*\n{2,}[ \t]*/g
const SOFT_BREAK_RE = /[ \t]*\n[ \t]*/g

const THINKING_PREFIX_RE =
  /^\s*(?:\([^)\n]{1,48}\)\s*)?(?:processing|thinking|reasoning|analyzing|pondering|contemplating|musing|cogitating|ruminating|deliberating|mulling|reflecting|computing|synthesizing|formulating|brainstorming)\.\.\.\s*/i

const URL_RE = /\bhttps?:\/\/\S+/gi
const DEFAULT_SPEECH_CHUNK_CHARS = 280
const SENTENCE_RE = /[^.!?]+(?:[.!?]+["')\]]*)?|[^.!?]+$/g
const STANDALONE_LIST_MARKER_RE = /^(?:\d{1,3}|[A-Za-z])[.)]$/
const COLON_PARAGRAPH_BREAK_RE = /([:;])[ \t]*\n{2,}[ \t]*/g
const COMPACT_DATE_RE = /\b(Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?\s+(\d{1,2})(?=\b|,)/gi

const MONTH_NAMES: Record<string, string> = {
  apr: 'April',
  aug: 'August',
  dec: 'December',
  feb: 'February',
  jan: 'January',
  jul: 'July',
  jun: 'June',
  mar: 'March',
  nov: 'November',
  oct: 'October',
  sep: 'September',
  sept: 'September'
}

function normalizeLineBreaks(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/(\p{L})-\n(\p{L})/gu, '$1$2')
    .replace(COLON_PARAGRAPH_BREAK_RE, '$1 ')
    .replace(PARAGRAPH_BREAK_RE, '. ')
    .replace(SOFT_BREAK_RE, ' ')
}

function parseMarkdownTableRow(line: string): string[] | null {
  const trimmed = line.trim()

  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) {
    return null
  }

  return trimmed
    .slice(1, -1)
    .split('|')
    .map(cell => cell.trim())
}

function isMarkdownTableSeparator(cells: string[]): boolean {
  return cells.length > 0 && cells.every(cell => /^:?-{3,}:?$/.test(cell.replace(/\s+/g, '')))
}

function normalizeTableHeader(header: string): string {
  return header
    .toLowerCase()
    .replace(/[^a-z0-9#]+/g, ' ')
    .trim()
}

function ordinalDay(day: string): string {
  const value = Number.parseInt(day, 10)

  if (!Number.isFinite(value)) {
    return day
  }

  const teenRemainder = value % 100

  const suffix =
    teenRemainder >= 11 && teenRemainder <= 13
      ? 'th'
      : value % 10 === 1
        ? 'st'
        : value % 10 === 2
          ? 'nd'
          : value % 10 === 3
            ? 'rd'
            : 'th'

  return `${value}${suffix}`
}

function normalizeCompactDates(text: string): string {
  return text.replace(COMPACT_DATE_RE, (_match, month: string, day: string) => {
    const monthName = MONTH_NAMES[month.toLowerCase()] ?? month

    return `${monthName} ${ordinalDay(day)}`
  })
}

function formatMarkdownTableRow(headers: string[], cells: string[]): string {
  const normalizedHeaders = headers.map(normalizeTableHeader)

  const fields = headers
    .map((header, index) => ({
      header: header.trim(),
      normalizedHeader: normalizedHeaders[index],
      value: cells[index]?.trim() ?? ''
    }))
    .filter(field => field.value)

  const item = fields.find(field => field.normalizedHeader === '#')
  const subject = fields.find(field => field.normalizedHeader.includes('subject'))
  const received = fields.find(field => field.normalizedHeader.includes('received'))

  if (subject) {
    const prefix = item ? `Item ${item.value}: ` : ''
    const receivedText = received ? `, received ${received.value}` : ''

    return `${prefix}${subject.value}${receivedText}.`
  }

  return `${fields
    .map(field => {
      if (field.normalizedHeader === '#') {
        return `Item ${field.value}`
      }

      return `${field.header}: ${field.value}`
    })
    .join('; ')}.`
}

function normalizeMarkdownTables(text: string): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const output: string[] = []
  let index = 0

  while (index < lines.length) {
    const headerCells = parseMarkdownTableRow(lines[index])

    if (!headerCells) {
      output.push(lines[index])
      index += 1

      continue
    }

    const separatorCells = parseMarkdownTableRow(lines[index + 1] ?? '')

    if (!separatorCells || !isMarkdownTableSeparator(separatorCells)) {
      output.push(lines[index])
      index += 1

      continue
    }

    index += 2

    while (index < lines.length) {
      const rowCells = parseMarkdownTableRow(lines[index])

      if (!rowCells) {
        break
      }

      output.push(formatMarkdownTableRow(headerCells, rowCells))
      index += 1
    }
  }

  return output.join('\n')
}

function normalizeMarkdownLists(text: string): string {
  return text.replace(LIST_MARKER_LINE_RE, 'Item $1: ').replace(/^\s*[-+*]\s+/gm, '')
}

export function sanitizeTextForSpeech(text: string): string {
  return normalizeCompactDates(normalizeLineBreaks(normalizeMarkdownLists(normalizeMarkdownTables(text))))
    .replace(FENCED_CODE_RE, ' ')
    .replace(THINKING_PREFIX_RE, ' ')
    .replace(MARKDOWN_LINK_RE, '$1')
    .replace(INLINE_CODE_RE, '$1')
    .replace(URL_RE, ' link ')
    .replace(EMOJI_RE, ' ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_~>#]/g, '')
    .replace(/^\s*[-+*]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function mergeStandaloneListMarkers(parts: string[]): string[] {
  const merged: string[] = []
  let pendingMarker: string | null = null

  for (const rawPart of parts) {
    const part = rawPart.trim()

    if (!part) {
      continue
    }

    if (pendingMarker) {
      merged.push(`${pendingMarker} ${part}`)
      pendingMarker = null

      continue
    }

    if (STANDALONE_LIST_MARKER_RE.test(part)) {
      pendingMarker = part

      continue
    }

    merged.push(part)
  }

  if (pendingMarker) {
    merged.push(pendingMarker)
  }

  return merged
}

function pushSpeechChunk(chunks: string[], current: string) {
  const trimmed = current.trim()

  if (trimmed) {
    chunks.push(trimmed)
  }
}

function splitLongSpeechPart(part: string, maxChars: number): string[] {
  const chunks: string[] = []
  let current = ''

  for (const word of part.split(/\s+/)) {
    if (!word) {
      continue
    }

    if (word.length > maxChars) {
      pushSpeechChunk(chunks, current)
      current = ''

      for (let start = 0; start < word.length; start += maxChars) {
        chunks.push(word.slice(start, start + maxChars))
      }

      continue
    }

    const candidate = current ? `${current} ${word}` : word

    if (candidate.length > maxChars) {
      pushSpeechChunk(chunks, current)
      current = word
    } else {
      current = candidate
    }
  }

  pushSpeechChunk(chunks, current)

  return chunks
}

export function splitTextForSpeech(text: string, maxChars = DEFAULT_SPEECH_CHUNK_CHARS): string[] {
  const trimmed = text.trim()
  const limit = Math.max(80, maxChars)

  if (!trimmed) {
    return []
  }

  if (trimmed.length <= limit) {
    return [trimmed]
  }

  const chunks: string[] = []
  let current = ''
  const parts = mergeStandaloneListMarkers(trimmed.match(SENTENCE_RE) ?? [trimmed])

  for (const rawPart of parts) {
    const part = rawPart.trim()

    if (!part) {
      continue
    }

    if (part.length > limit) {
      pushSpeechChunk(chunks, current)
      current = ''
      chunks.push(...splitLongSpeechPart(part, limit))

      continue
    }

    const candidate = current ? `${current} ${part}` : part

    if (candidate.length > limit) {
      pushSpeechChunk(chunks, current)
      current = part
    } else {
      current = candidate
    }
  }

  pushSpeechChunk(chunks, current)

  return chunks
}
