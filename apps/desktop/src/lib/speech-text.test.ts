import { describe, expect, it } from 'vitest'

import { splitTextForSpeech } from './speech-text'

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
})
