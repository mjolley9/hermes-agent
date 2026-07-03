import { describe, expect, it } from 'vitest'

import { sanitizeTextForSpeech, splitTextForSpeech } from './speech-text'

describe('splitTextForSpeech', () => {
  it('keeps short text as one chunk', () => {
    expect(splitTextForSpeech('Short reply.')).toEqual(['Short reply.'])
  })

  it('splits long speech on sentence boundaries', () => {
    const text = [
      'First sentence has enough words to make the chunking behavior visible.',
      'Second sentence should stay readable and should not be glued into a huge request.',
      'Third sentence gives the splitter another clean boundary.'
    ].join(' ')

    const chunks = splitTextForSpeech(text, 95)

    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every(chunk => chunk.length <= 95)).toBe(true)
    expect(chunks.join(' ')).toBe(text)
  })

  it('splits a long sentence by words when punctuation is unavailable', () => {
    const text = 'word '.repeat(70).trim()
    const chunks = splitTextForSpeech(text, 90)

    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every(chunk => chunk.length <= 90)).toBe(true)
    expect(chunks.join(' ')).toBe(text)
  })

  it('keeps markdown numbered list markers with their item text', () => {
    const text = [
      "Here's the full picture on this thread:",
      '',
      "Adam's latest ask (2 items):",
      '',
      '1. PAGH breakout - "Can I get a breakout of what is included in PAGH?"',
      '2. May YOY difference - "Curious what is driving the YOY difference in May."'
    ].join('\n')

    const chunks = splitTextForSpeech(sanitizeTextForSpeech(text), 120)

    expect(chunks.every(chunk => !/\b\d{1,3}[.)]$/.test(chunk))).toBe(true)
    expect(chunks.some(chunk => chunk.includes('Item 1: PAGH breakout'))).toBe(true)
    expect(chunks.some(chunk => chunk.includes('Item 2: May YOY difference'))).toBe(true)
  })

  it('does not leave standalone numbered markers at chunk endings', () => {
    const text = [
      "Here's the full picture on this thread.",
      "Adam's latest ask contains a numbered item near the chunk limit.",
      '1.',
      'PAGH breakout should stay attached to the marker.'
    ].join(' ')

    const chunks = splitTextForSpeech(text, 125)

    expect(chunks.every(chunk => !/\b\d{1,3}[.)]$/.test(chunk))).toBe(true)
    expect(chunks.some(chunk => chunk.startsWith('1. PAGH breakout'))).toBe(true)
  })

  it('turns email summary tables and compact dates into spoken sentences', () => {
    const text = [
      'Here are your five most recent received emails:',
      '',
      '| # | Subject | Received |',
      '|---|---|---|',
      '| 1 | Quarantined and Spam/Junk Email Report | Jul 3, 3:10 PM |',
      '| 2 | Re: Accrued Vacation | Jul 3, 3:00 PM |',
      "| 3 | RE: Updated TB's | Jul 3, 10:22 AM |",
      '| 4 | Designed to Belong | Jul 3, 10:06 AM |',
      '| 5 | Aldo Leal sent a message | Jul 3, 8:55 AM |',
      '',
      'Want me to pull the body of any of these for more detail?'
    ].join('\n')

    const sanitized = sanitizeTextForSpeech(text)
    const chunks = splitTextForSpeech(sanitized)

    expect(sanitized).toContain(
      'Here are your five most recent received emails: Item 1: Quarantined and Spam/Junk Email Report, received July 3rd, 3:10 PM.'
    )
    expect(sanitized).toContain('Item 5: Aldo Leal sent a message, received July 3rd, 8:55 AM.')
    expect(sanitized).not.toContain('|')
    expect(sanitized).not.toContain('Jul 3')
    expect(chunks.every(chunk => !chunk.endsWith('received emails:'))).toBe(true)
    expect(chunks.every(chunk => !chunk.endsWith('Aldo Leal sent a message'))).toBe(true)
  })
})
