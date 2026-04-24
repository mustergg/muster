/**
 * voiceNote — R25 / Phase 4.
 *
 * Captures a short audio clip via MediaRecorder, encrypts it, and sends
 * it over the two-layer envelope+blob pipeline (kind: 'voice'). Playback
 * side is symmetric: call `fetchBlob(...)` with the envelope's BlobRef,
 * hand the decrypted bytes to an `<audio>` element via Blob + objectURL.
 *
 * Kept deliberately lightweight — no Zustand store, just a recorder
 * factory. Consumer wires in transport + crypto callbacks from
 * networkStore + groupCryptoStore.
 *
 * Gated behind VITE_TWO_LAYER=1 in consumer code.
 */

import {
  buildEnvelope,
  sendBuiltEnvelope,
  type EnvelopeTransport,
  type BuildEnvelopeInput,
} from './envelope';

export interface VoiceNoteRecorderOptions {
  /** Max clip duration in ms. Hard-stops the recorder. Default 60s. */
  maxDurationMs?: number;
  /** Preferred MIME. Falls back to browser default if unsupported. */
  mimeType?: string;
  /** Audio bitrate in bps. Default 32 kbps (voice quality). */
  audioBitsPerSecond?: number;
}

export interface VoiceNoteRecorder {
  start: () => Promise<void>;
  stop: () => Promise<{ bytes: Uint8Array; mime: string; durationMs: number }>;
  cancel: () => void;
  isRecording: () => boolean;
}

/**
 * Open a microphone stream and return a recorder controller. The caller
 * handles UI state (press-and-hold vs toggle). `stop()` resolves with
 * the finalised audio bytes + mime — typical flow:
 *
 *   const rec = createVoiceNoteRecorder();
 *   await rec.start();
 *   // ...user releases...
 *   const { bytes, mime } = await rec.stop();
 *   await sendVoiceNote(transport, { ...envelopeInput, payload: bytes, mime, kind: 'voice' });
 */
export function createVoiceNoteRecorder(opts: VoiceNoteRecorderOptions = {}): VoiceNoteRecorder {
  const maxDurationMs = opts.maxDurationMs ?? 60_000;
  let stream: MediaStream | null = null;
  let recorder: MediaRecorder | null = null;
  let chunks: Blob[] = [];
  let startedAt = 0;
  let stopTimer: ReturnType<typeof setTimeout> | null = null;
  let resolveStop: ((v: { bytes: Uint8Array; mime: string; durationMs: number }) => void) | null = null;
  let rejectStop: ((err: Error) => void) | null = null;

  async function start(): Promise<void> {
    if (recorder) throw new Error('voiceNote: already recording');
    chunks = [];
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    const mime = pickMime(opts.mimeType);
    recorder = new MediaRecorder(stream, {
      mimeType: mime,
      audioBitsPerSecond: opts.audioBitsPerSecond ?? 32_000,
    });
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };
    recorder.onstop = async () => {
      const durationMs = Date.now() - startedAt;
      const effectiveMime = chunks[0]?.type || recorder?.mimeType || 'audio/webm';
      const blob = new Blob(chunks, { type: effectiveMime });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      cleanup();
      resolveStop?.({ bytes, mime: effectiveMime, durationMs });
      resolveStop = null; rejectStop = null;
    };
    recorder.onerror = (ev) => {
      cleanup();
      rejectStop?.(new Error('voiceNote: recorder error: ' + (ev as any)?.error?.message));
      resolveStop = null; rejectStop = null;
    };
    startedAt = Date.now();
    recorder.start();
    stopTimer = setTimeout(() => { try { recorder?.stop(); } catch { /* ignore */ } }, maxDurationMs);
  }

  function stop(): Promise<{ bytes: Uint8Array; mime: string; durationMs: number }> {
    if (!recorder) return Promise.reject(new Error('voiceNote: not recording'));
    return new Promise((resolve, reject) => {
      resolveStop = resolve;
      rejectStop = reject;
      try { recorder!.stop(); } catch (err) { reject(err as Error); }
    });
  }

  function cancel(): void {
    try { recorder?.stop(); } catch { /* ignore */ }
    cleanup();
    resolveStop = null;
    rejectStop?.(new Error('voiceNote: cancelled'));
    rejectStop = null;
  }

  function isRecording(): boolean {
    return recorder !== null && recorder.state === 'recording';
  }

  function cleanup(): void {
    if (stopTimer) { clearTimeout(stopTimer); stopTimer = null; }
    if (stream) { for (const t of stream.getTracks()) t.stop(); stream = null; }
    recorder = null;
  }

  return { start, stop, cancel, isRecording };
}

/**
 * Convenience: build + send a voice-note envelope. Thin wrapper around
 * buildEnvelope/sendBuiltEnvelope that fills in `kind:'voice'` so
 * callers don't forget.
 */
export async function sendVoiceNote(
  transport: EnvelopeTransport,
  input: Omit<BuildEnvelopeInput, 'kind'>,
): Promise<void> {
  const built = await buildEnvelope({ ...input, kind: 'voice' });
  await sendBuiltEnvelope(transport, built);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function pickMime(preferred?: string): string {
  const candidates = [
    preferred,
    'audio/webm;codecs=opus',
    'audio/ogg;codecs=opus',
    'audio/mp4',
    'audio/webm',
  ].filter(Boolean) as string[];
  for (const c of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(c)) return c;
  }
  // Fallback — browser defaults.
  return '';
}
