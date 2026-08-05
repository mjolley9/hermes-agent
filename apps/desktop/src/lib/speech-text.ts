const EMOJI_RE = /(?:[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]|[\u{FE0F}\u{200D}]|[\u{E0020}-\u{E007F}])+/gu

const FENCED_CODE_RE = /```[\s\S]*?(?:```|$)/g
const CODE_BLOCK_SUMMARY = ' code block omitted '
const INLINE_CODE_RE = /`([^`]+)`/g
const LIST_MARKER_LINE_RE = /^\s*(\d{1,3})[.)]\s+/gm
const MARKDOWN_LINK_RE = /\[([^\]]+)\]\(([^)]+)\)/g
const PARAGRAPH_BREAK_RE = /[ \t]*\n{2,}[ \t]*/g
const PUNCTUATED_PARAGRAPH_BREAK_RE = /([.!?])([*_~`>"'’”)}\]]*)[ \t]*\n{2,}[ \t]*/g
const COLON_PARAGRAPH_BREAK_RE = /([:;])([*_~`>"'’”)}\]]*)[ \t]*\n{2,}[ \t]*/g
const SOFT_BREAK_RE = /[ \t]*\n[ \t]*/g

const THINKING_PREFIX_RE =
  /^\s*(?:\([^)\n]{1,48}\)\s*)?(?:processing|thinking|reasoning|analyzing|pondering|contemplating|musing|cogitating|ruminating|deliberating|mulling|reflecting|computing|synthesizing|formulating|brainstorming)\.\.\.\s*/i

const URL_RE = /\bhttps?:\/\/\S+/gi
const COMPACT_DATE_RE = /\b(Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?\s+(\d{1,2})(?=\b|,)/gi
const NUMERIC_RANGE_RE = /\b(\d+)\s*[-–—]\s*(\d+)\b/g
const WORD_SLASH_WORD_RE = /\b([\p{L}][\p{L}-]*)\/([\p{L}][\p{L}-]*)\b/gu
const SPACED_DASH_RE = /\s+[–—-]\s+/g

const MARKDOWN_TABLE_DELIMITER_CELL_RE = /^:?-{3,}:?$/

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

const SPOKEN_TOKEN_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\be\.g\.,?/gi, 'for example,'],
  [/\bi\.e\.,?/gi, 'that is,'],
  [/\betc\./gi, 'etcetera.'],
  [/\bvs\./gi, 'versus'],
  [/\bSVP\b/g, 'S V P'],
  [/\bTB'?s\b/g, 'T Bs']
]

interface MarkdownTableRow {
  blockquoteDepth: number
  cells: string[]
}

function isUnescapedPipe(row: string, index: number): boolean {
  let backslashes = 0

  for (let cursor = index - 1; cursor >= 0 && row[cursor] === '\\'; cursor -= 1) {
    backslashes += 1
  }

  return backslashes % 2 === 0
}

function splitMarkdownTableCells(row: string): string[] {
  const cells: string[] = []
  let cellStart = 0

  for (let index = 0; index < row.length; index += 1) {
    if (row[index] === '|' && isUnescapedPipe(row, index)) {
      cells.push(row.slice(cellStart, index).trim())
      cellStart = index + 1
    }
  }

  cells.push(row.slice(cellStart).trim())

  return cells
}

function parseMarkdownTableRow(line: string): MarkdownTableRow | null {
  let row = line
  let blockquoteDepth = 0

  while (true) {
    const indentation = row.match(/^[ \t]*/)?.[0] ?? ''

    if (indentation.includes('\t') || indentation.length > 3) {
      return null
    }

    row = row.slice(indentation.length)

    if (!row.startsWith('>')) {
      break
    }

    blockquoteDepth += 1
    row = row.slice(1)

    if (row.startsWith(' ')) {
      row = row.slice(1)
    }
  }

  row = row.trimEnd()

  const pipeIndexes = [...row.matchAll(/\|/g)].map(match => match.index).filter(index => isUnescapedPipe(row, index))

  if (pipeIndexes.length === 0) {
    return null
  }

  const hasLeadingPipe = pipeIndexes[0] === 0
  const hasTrailingPipe = pipeIndexes.at(-1) === row.length - 1

  if (hasLeadingPipe) {
    row = row.slice(1)
  }

  if (hasTrailingPipe) {
    row = row.slice(0, -1)
  }

  const cells = splitMarkdownTableCells(row)

  if (cells.length < 2 && !(hasLeadingPipe && hasTrailingPipe && cells.length === 1)) {
    return null
  }

  return { blockquoteDepth, cells }
}

function normalizeTableHeader(header: string): string {
  return header
    .toLowerCase()
    .replace(/[^a-z0-9#]+/g, ' ')
    .trim()
}

function formatMarkdownTableRow(headers: string[], cells: string[]): string {
  const fields = headers
    .map((header, index) => ({
      header: header.trim().replace(/\\\|/g, '|'),
      normalizedHeader: normalizeTableHeader(header),
      value: (cells[index] ?? '').trim().replace(/\\\|/g, '|')
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
    .map(field => field.normalizedHeader === '#' ? `Item ${field.value}` : `${field.header}: ${field.value}`)
    .join('; ')}.`
}

function normalizeMarkdownTables(text: string): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const output: string[] = []
  let index = 0

  while (index < lines.length) {
    const headerRow = parseMarkdownTableRow(lines[index])
    const delimiterRow = parseMarkdownTableRow(lines[index + 1] ?? '')

    if (
      !delimiterRow ||
      !headerRow ||
      !delimiterRow.cells.every(cell => MARKDOWN_TABLE_DELIMITER_CELL_RE.test(cell)) ||
      headerRow.cells.length !== delimiterRow.cells.length ||
      headerRow.blockquoteDepth !== delimiterRow.blockquoteDepth
    ) {
      output.push(lines[index])
      index += 1

      continue
    }

    let rowIndex = index + 2

    for (; rowIndex < lines.length; rowIndex += 1) {
      const bodyRow = parseMarkdownTableRow(lines[rowIndex])

      if (!bodyRow || bodyRow.blockquoteDepth !== delimiterRow.blockquoteDepth) {
        break
      }

      output.push(formatMarkdownTableRow(headerRow.cells, bodyRow.cells))
    }

    index = rowIndex
  }

  return output.join('\n')
}

function ordinalDay(day: string): string {
  const value = Number.parseInt(day, 10)
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

function normalizeSpokenTokens(text: string): string {
  let normalized = text
    .replace(NUMERIC_RANGE_RE, '$1 to $2')
    .replace(WORD_SLASH_WORD_RE, '$1 and $2')
    .replace(/&/g, ' and ')
    .replace(SPACED_DASH_RE, ', ')

  for (const [pattern, replacement] of SPOKEN_TOKEN_REPLACEMENTS) {
    normalized = normalized.replace(pattern, replacement)
  }

  return normalized
}

function normalizeLineBreaks(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/(\p{L})-\n(\p{L})/gu, '$1$2')
    .replace(COLON_PARAGRAPH_BREAK_RE, '$1$2 ')
    .replace(PUNCTUATED_PARAGRAPH_BREAK_RE, '$1$2 ')
    .replace(PARAGRAPH_BREAK_RE, '. ')
    .replace(SOFT_BREAK_RE, ' ')
}

export function sanitizeTextForSpeech(text: string): string {
  const normalized = normalizeCompactDates(
    normalizeLineBreaks(
      normalizeMarkdownTables(text.replace(LIST_MARKER_LINE_RE, 'Item $1: '))
    )
  )
    .replace(FENCED_CODE_RE, CODE_BLOCK_SUMMARY)
    .replace(THINKING_PREFIX_RE, ' ')
    .replace(MARKDOWN_LINK_RE, '$1')
    .replace(INLINE_CODE_RE, '$1')
    .replace(URL_RE, ' link ')
    .replace(EMOJI_RE, ' ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_~>#]/g, '')
    .replace(/^\s*[-+*]\s+/gm, '')

  return normalizeSpokenTokens(normalized)
    .replace(/\s+/g, ' ')
    .trim()
}
