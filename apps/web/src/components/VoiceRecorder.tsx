/**
 * VoiceRecorder — record a voice note, then confirm (send) or discard.
 *
 * Replaces the auto-send-on-stop behaviour: stopping leaves a preview with
 * Send / Discard buttons. Shared by channel, DM and squad composers.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';

type State = 'idle' | 'recording' | 'recorded';

export default function VoiceRecorder({ onSend, disabled }: { onSend: (file: File) => void; disabled?: boolean }): React.JSX.Element {
  const [state, setState] = useState<State>('idle');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const fileRef = useRef<File | null>(null);

  const reset = useCallback(() => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    fileRef.current = null;
    chunksRef.current = [];
    setState('idle');
  }, [previewUrl]);

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const start = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const type = rec.mimeType || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type });
        if (blob.size === 0) { setState('idle'); return; }
        const ext = type.includes('ogg') ? 'ogg' : type.includes('mp4') ? 'mp4' : 'webm';
        fileRef.current = new File([blob], `voice-${Date.now()}.${ext}`, { type });
        setPreviewUrl(URL.createObjectURL(blob));
        setState('recorded');
      };
      recorderRef.current = rec;
      rec.start();
      setState('recording');
    } catch (err) {
      console.error('[voice] mic failed:', err);
      alert('Microphone access denied or unavailable.');
    }
  }, []);

  const stop = useCallback(() => { recorderRef.current?.stop(); }, []);

  const send = useCallback(() => {
    if (fileRef.current) onSend(fileRef.current);
    reset();
  }, [onSend, reset]);

  if (state === 'recorded' && previewUrl) {
    return (
      <div style={s.previewWrap}>
        <audio src={previewUrl} controls style={s.audio} />
        <button onClick={send} style={s.sendBtn} title="Send voice note">⬆</button>
        <button onClick={reset} style={s.discardBtn} title="Discard">🗑</button>
      </div>
    );
  }

  if (state === 'recording') {
    return <button onClick={stop} style={{ ...s.btn, color: '#E24B4A' }} title="Stop recording">⏹</button>;
  }

  return <button onClick={start} disabled={disabled} style={s.btn} title="Record voice note">{'\u{1F3A4}'}</button>;
}

const s = {
  btn: { width: '30px', height: '30px', borderRadius: '6px', background: 'transparent', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 } as React.CSSProperties,
  previewWrap: { display: 'flex', alignItems: 'center', gap: '4px' } as React.CSSProperties,
  audio: { height: '30px', maxWidth: '180px' } as React.CSSProperties,
  sendBtn: { width: '28px', height: '28px', borderRadius: '6px', background: 'var(--color-accent)', border: 'none', color: '#fff', cursor: 'pointer', fontSize: '14px', flexShrink: 0 } as React.CSSProperties,
  discardBtn: { width: '28px', height: '28px', borderRadius: '6px', background: 'transparent', border: '1px solid var(--color-border)', color: '#E24B4A', cursor: 'pointer', fontSize: '13px', flexShrink: 0 } as React.CSSProperties,
} as const;
