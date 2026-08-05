import { describe, expect, it } from 'vitest'

import { sanitizeTextForSpeech } from './speech-text'

describe('sanitizeTextForSpeech', () => {
  it('summarizes fenced code blocks instead of reading them literally', () => {
    expect(sanitizeTextForSpeech('Here is code:\n```ts\nconst x = 1\n```\nDone.')).toBe(
      'Here is code: code block omitted Done.'
    )
  })

  it('still keeps normal prose and inline code readable', () => {
    expect(sanitizeTextForSpeech('Use `git status` after the change.')).toBe('Use git status after the change.')
  })

  it('turns markdown table data into spoken rows while preserving surrounding human text', () => {
    const text = `Here is the quick takeaway: the totals remain unchanged.

| Item | Value | Notes |
| --- | ---: | --- |
| Example A | 10 | first row |
| Example B | 20 | second row |

Full detail stays visible on screen.`

    expect(sanitizeTextForSpeech(text)).toBe(
      'Here is the quick takeaway: the totals remain unchanged. Item: Example A; Value: 10; Notes: first row. Item: Example B; Value: 20; Notes: second row. Full detail stays visible on screen.'
    )
  })

  it('does not strip prose that merely contains a pipe character', () => {
    const text = 'Use the summary first | keep the table on screen when it matters.'

    expect(sanitizeTextForSpeech(text)).toBe('Use the summary first | keep the table on screen when it matters.')
  })

  it('does not duplicate punctuation across paragraph breaks', () => {
    const text = `First sentence.

Second sentence.`

    expect(sanitizeTextForSpeech(text)).toBe('First sentence. Second sentence.')
  })

  it.each([
    ['markdown emphasis', '**First sentence.**\n\nSecond sentence.', 'First sentence. Second sentence.'],
    ['a closing quote', '“First sentence.”\n\nSecond sentence.', '“First sentence.” Second sentence.'],
    ['a closing parenthesis', '(First sentence.)\n\nSecond sentence.', '(First sentence.) Second sentence.']
  ])('does not duplicate punctuation after %s', (_label, text, expected) => {
    expect(sanitizeTextForSpeech(text)).toBe(expected)
  })

  it('speaks markdown tables without leading and trailing pipes', () => {
    const text = `Main takeaway: total is unchanged.

Item | Value
--- | ---:
Example A | 10
Example B | 20

Done.`

    expect(sanitizeTextForSpeech(text)).toBe(
      'Main takeaway: total is unchanged. Item: Example A; Value: 10. Item: Example B; Value: 20. Done.'
    )
  })

  it('speaks markdown tables nested inside blockquotes', () => {
    const text = `Before the table.

> | Item | Value |
> | --- | ---: |
> | Example A | 10 |
> | Example B | 20 |

After the table.`

    expect(sanitizeTextForSpeech(text)).toBe(
      'Before the table. Item: Example A; Value: 10. Item: Example B; Value: 20. After the table.'
    )
  })

  it('allows marker padding plus three spaces in blockquoted tables', () => {
    const text = `Before the table.

>    | Item | Value |
>    | --- | ---: |
>    | Example A | 10 |

After the table.`

    expect(sanitizeTextForSpeech(text)).toBe(
      'Before the table. Item: Example A; Value: 10. After the table.'
    )
  })

  it('speaks explicit single-column markdown tables', () => {
    const text = `Before the table.

| Item |
| --- |
| Example A |

After the table.`

    expect(sanitizeTextForSpeech(text)).toBe('Before the table. Item: Example A. After the table.')
  })

  it('preserves rows outside a table blockquote', () => {
    const text = `> | Item | Value |
> | --- | ---: |
> | Example A | 10 |
Outside | prose`

    expect(sanitizeTextForSpeech(text)).toBe('Item: Example A; Value: 10. Outside | prose')
  })

  it('preserves malformed tables with mismatched column counts', () => {
    const text = `Heading | Detail
--- | --- | ---
Keep this prose.`

    expect(sanitizeTextForSpeech(text)).toContain('Heading | Detail')
  })

  it('speaks available GFM cells when body row counts differ from the header', () => {
    const text = `Before the table.

| Item | Value |
| --- | ---: |
| Example A |
| Example B | 20 | ignored |

After the table.`

    expect(sanitizeTextForSpeech(text)).toBe(
      'Before the table. Item: Example A. Item: Example B; Value: 20. After the table.'
    )
  })

  it('speaks tables containing escaped pipe characters', () => {
    const text = `Before the table.

| Item \\| detail | Value |
| --- | ---: |
| Example A | 10 |

After the table.`

    expect(sanitizeTextForSpeech(text)).toBe(
      'Before the table. Item | detail: Example A; Value: 10. After the table.'
    )
  })

  it('preserves indented code that resembles a table', () => {
    const text = `    Item | Value
    --- | ---
    Example A | 10`

    expect(sanitizeTextForSpeech(text)).toContain('Item | Value')
  })

  it('turns email summary tables and compact dates into spoken sentences', () => {
    const text = `Here are your two most recent received emails:

| # | Subject | Received |
|---|---|---|
| 1 | Quarantined and Spam/Junk Email Report | Jul 3, 3:10 PM |
| 2 | RE: Updated TB's | Jul 3, 10:22 AM |

Want me to pull the body of either message?`

    const sanitized = sanitizeTextForSpeech(text)

    expect(sanitized).toContain(
      'Item 1: Quarantined and Spam and Junk Email Report, received July 3rd, 3:10 PM.'
    )
    expect(sanitized).toContain('Item 2: RE: Updated T Bs, received July 3rd, 10:22 AM.')
    expect(sanitized).not.toContain('|')
    expect(sanitized).not.toContain('Jul 3')
  })

  it('normalizes numbered interview prompts and common speech tokens', () => {
    const text = `Round 1 — Professional Role & Day-to-Day Work

I know you're SVP Finance/Accounting.

1. Ask 5-7 focused questions (e.g., close, reporting, etc.).
2. What’s your email/calendar load like?`

    const sanitized = sanitizeTextForSpeech(text)

    expect(sanitized).toContain('Professional Role and Day-to-Day Work')
    expect(sanitized).toContain('S V P Finance and Accounting')
    expect(sanitized).toContain('Item 1: Ask 5 to 7 focused questions (for example, close, reporting, etcetera.)')
    expect(sanitized).toContain('Item 2: What’s your email and calendar load like?')
  })
})
