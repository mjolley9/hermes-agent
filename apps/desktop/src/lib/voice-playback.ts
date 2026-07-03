import { speakText } from '@/hermes'
import {
  $voicePlayback,
  setVoicePlaybackState,
  type VoicePlaybackSource,
  type VoicePlaybackState
} from '@/store/voice-playback'

import { sanitizeTextForSpeech, splitTextForSpeech } from './speech-text'

// Free Edge TTS occasionally hands back audio that never fires `playing`/`ended`
// nor `error` — leaving voice mode stuck "speaking" forever. Reject if playback
// fails to start or stalls mid-stream for this long (rearmed on each progress
// tick, so legitimately long speech is never cut off).
const PLAYBACK_STALL_MS = 15_000
const STREAMING_AUDIO_SAMPLE_RATE = 24_000
const STREAMING_RESPONSE_FORMAT = 'pcm'

type BrowserAudioContext = typeof AudioContext

let currentAudio: HTMLAudioElement | null = null
let currentStop: (() => void) | null = null
let sequence = 0

function currentState(
  status: VoicePlaybackState['status'],
  options?: VoicePlaybackOptions,
  audioElement: HTMLAudioElement | null = null
): VoicePlaybackState {
  return {
    audioElement,
    messageId: options?.messageId ?? null,
    sequence,
    source: options?.source ?? null,
    status
  }
}

export interface VoicePlaybackOptions {
  messageId?: string | null
  source: VoicePlaybackSource
}

function createTtsStreamId(): string {
  return `tts-${window.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`
}

function decodeBase64AudioChunk(data: string): Uint8Array {
  const binary = window.atob(data)
  const bytes = new Uint8Array(binary.length)

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }

  return bytes
}

function getAudioContextConstructor(): BrowserAudioContext | null {
  const audioWindow = window as Window & { webkitAudioContext?: BrowserAudioContext }
  return window.AudioContext || audioWindow.webkitAudioContext || null
}

function canUseStreamingPlayback(): boolean {
  const streamSpeech = window.hermesDesktop.streamSpeech
  return Boolean(streamSpeech && getAudioContextConstructor())
}

export function stopVoicePlayback() {
  sequence += 1
  currentStop?.()
  currentStop = null

  if (currentAudio) {
    currentAudio.pause()
    currentAudio.src = ''
    currentAudio.load()
    currentAudio = null
  }

  setVoicePlaybackState({
    audioElement: null,
    messageId: null,
    sequence,
    source: null,
    status: 'idle'
  })
}

async function playStreamingSpeechChunk(
  text: string,
  options: VoicePlaybackOptions,
  isCurrent: () => boolean
): Promise<boolean> {
  const streamSpeech = window.hermesDesktop.streamSpeech
  const AudioContextCtor = getAudioContextConstructor()

  if (!streamSpeech || !AudioContextCtor || !canUseStreamingPlayback()) {
    return false
  }

  const streamId = createTtsStreamId()
  const audioContext = new AudioContextCtor()
  const disposers: (() => void)[] = []
  const activeSources = new Set<AudioBufferSourceNode>()

  let carry: Uint8Array | null = null
  let finishTimer: number | null = null
  let nextStartAt = 0
  let streamEnded = false
  let receivedAnyChunk = false
  let playbackStarted = false
  let settled = false

  return await new Promise<boolean>((resolve, reject) => {
    const cleanup = () => {
      if (finishTimer !== null) {
        window.clearTimeout(finishTimer)
        finishTimer = null
      }

      disposers.splice(0).forEach(dispose => dispose())
      activeSources.forEach(source => {
        try {
          source.stop()
        } catch {
          // Source may have ended naturally already.
        }
        source.disconnect()
      })
      activeSources.clear()
      void audioContext.close().catch(() => undefined)
      void streamSpeech.stop(streamId).catch(() => undefined)

      if (currentStop === stopStreaming) {
        currentStop = null
      }
    }

    const finish = (played: boolean) => {
      if (settled) {
        return
      }

      settled = true
      cleanup()
      resolve(played)
    }

    const fail = (error?: Error) => {
      if (receivedAnyChunk || playbackStarted) {
        if (settled) {
          return
        }

        settled = true
        cleanup()
        reject(error ?? new Error('Streaming playback failed'))
        return
      }

      finish(false)
    }

    function scheduleFinishAfterBufferedAudio() {
      if (finishTimer !== null) {
        window.clearTimeout(finishTimer)
      }

      const remainingMs = Math.max(0, (nextStartAt - audioContext.currentTime) * 1000)
      finishTimer = window.setTimeout(() => finish(true), remainingMs + 80)
    }

    function decodePcm16Chunk(chunk: Uint8Array): Float32Array | null {
      let bytes = chunk

      if (carry?.byteLength) {
        bytes = new Uint8Array(carry.byteLength + chunk.byteLength)
        bytes.set(carry, 0)
        bytes.set(chunk, carry.byteLength)
        carry = null
      }

      if (bytes.byteLength % 2 === 1) {
        carry = bytes.slice(bytes.byteLength - 1)
        bytes = bytes.slice(0, bytes.byteLength - 1)
      }

      if (!bytes.byteLength) {
        return null
      }

      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      const samples = new Float32Array(bytes.byteLength / 2)

      for (let i = 0; i < samples.length; i += 1) {
        const value = view.getInt16(i * 2, true)
        samples[i] = Math.max(-1, Math.min(1, value / 32768))
      }

      return samples
    }

    function schedulePcmSamples(samples: Float32Array) {
      if (!samples.length || settled) {
        return
      }

      const buffer = audioContext.createBuffer(1, samples.length, STREAMING_AUDIO_SAMPLE_RATE)
      buffer.getChannelData(0).set(samples)

      const source = audioContext.createBufferSource()
      source.buffer = buffer
      source.connect(audioContext.destination)
      activeSources.add(source)
      source.addEventListener(
        'ended',
        () => {
          activeSources.delete(source)
        },
        { once: true }
      )

      const startAt = Math.max(nextStartAt, audioContext.currentTime + 0.02)
      try {
        source.start(startAt)
      } catch (error) {
        fail(error instanceof Error ? error : new Error('Streaming playback failed'))
        return
      }

      nextStartAt = startAt + buffer.duration
      void audioContext.resume().catch(error => fail(error instanceof Error ? error : new Error('Playback failed')))

      if (!playbackStarted) {
        playbackStarted = true
        setVoicePlaybackState(currentState('speaking', options))
      }

      if (streamEnded) {
        scheduleFinishAfterBufferedAudio()
      }
    }

    function handleAudioChunk(data: string) {
      const samples = decodePcm16Chunk(decodeBase64AudioChunk(data))
      if (samples) {
        receivedAnyChunk = true
        schedulePcmSamples(samples)
      }
    }

    function stopStreaming() {
      finish(false)
    }

    currentStop = stopStreaming

    disposers.push(
      streamSpeech.onChunk(streamId, payload => {
        if (!payload.data || !isCurrent()) {
          return
        }

        try {
          handleAudioChunk(payload.data)
        } catch (error) {
          fail(error instanceof Error ? error : new Error('Streaming playback failed'))
        }
      }),
      streamSpeech.onEnd(streamId, payload => {
        if (payload.aborted) {
          finish(false)
          return
        }

        streamEnded = true
        if (!receivedAnyChunk) {
          finish(false)
          return
        }

        scheduleFinishAfterBufferedAudio()
      }),
      streamSpeech.onError(streamId, payload => {
        fail(new Error(payload.message || 'TTS stream failed'))
      })
    )

    void streamSpeech
      .start(streamId, {
        response_format: STREAMING_RESPONSE_FORMAT,
        text
      })
      .catch(() => finish(false))
  })
}

async function playBufferedSpeechChunk(
  text: string,
  options: VoicePlaybackOptions,
  isCurrent: () => boolean
): Promise<void> {
  const response = await speakText(text)

  if (!isCurrent()) {
    return
  }

  const audio = new Audio(response.data_url)
  currentAudio = audio
  setVoicePlaybackState(currentState('speaking', options, audio))

  await new Promise<void>((resolve, reject) => {
    let stall: number | null = null

    const cleanup = () => {
      if (stall !== null) {
        window.clearTimeout(stall)
        stall = null
      }

      audio.removeEventListener('ended', onEnded)
      audio.removeEventListener('error', onError)
      audio.removeEventListener('timeupdate', armStall)
      currentStop = null
    }

    const armStall = () => {
      if (stall !== null) {
        window.clearTimeout(stall)
      }

      stall = window.setTimeout(() => {
        cleanup()
        reject(new Error('Playback stalled'))
      }, PLAYBACK_STALL_MS)
    }

    const onEnded = () => {
      cleanup()
      resolve()
    }

    const onError = () => {
      cleanup()
      reject(new Error('Playback failed'))
    }

    currentStop = () => {
      cleanup()
      resolve()
    }

    audio.addEventListener('ended', onEnded, { once: true })
    audio.addEventListener('error', onError, { once: true })
    audio.addEventListener('timeupdate', armStall)
    armStall()
    void audio.play().catch(onError)
  })
}

export async function playSpeechText(text: string, options: VoicePlaybackOptions): Promise<boolean> {
  stopVoicePlayback()

  const speakableText = sanitizeTextForSpeech(text)

  if (!speakableText) {
    return false
  }

  const speakableChunks = splitTextForSpeech(speakableText)

  const ownSequence = sequence
  const isCurrent = () => ownSequence === sequence

  try {
    for (const chunk of speakableChunks) {
      if (!isCurrent()) {
        return false
      }

      setVoicePlaybackState(currentState('preparing', options))

      const streamed = await playStreamingSpeechChunk(chunk, options, isCurrent)

      if (!isCurrent()) {
        return false
      }

      if (!streamed) {
        await playBufferedSpeechChunk(chunk, options, isCurrent)
      }

      if (!isCurrent()) {
        return false
      }

      currentAudio = null
    }

    setVoicePlaybackState(currentState('idle'))

    return true
  } catch (error) {
    if (isCurrent()) {
      currentStop = null
      currentAudio = null
      setVoicePlaybackState(currentState('idle'))
    }

    throw error
  }
}

export function isVoicePlaybackActive() {
  return $voicePlayback.get().status !== 'idle'
}
