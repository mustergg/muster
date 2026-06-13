/**
 * MediaRecorder — record a voice note (audio) or video note (video), preview
 * it, then send or discard. Shared by every composer.
 *
 * Recording UI is an overlay panel anchored above the trigger button: for video
 * it shows a live camera preview; for audio a recording indicator. While
 * recording the only safe actions are Stop and Discard — clicking elsewhere on
 * the composer is warned against (the panel stays put). The parent can call
 * `stopAndSend()` (via ref) to finish + send in one step, e.g. on Enter.
 */
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';

export interface MediaRecorderHandle {
  isRecording: boolean;
  isBusy: boolean;          // recording or holding a recorded clip
  stopAndSend: () => void;
}

interface Props {
  mode: 'audio' | 'video';
  onSend: (file: File) => void;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
  buttonStyle?: React.CSSProperties;
  /** Which edge the preview panel is anchored to (opens inward). */
  align?: 'left' | 'right';
}

type State = 'idle' | 'recording' | 'recorded';

const MediaRecorderControl = forwardRef<MediaRecorderHandle, Props>(function MediaRecorderControl(
  { mode, onSend, disabled, onBusyChange, buttonStyle, align = 'right' }, ref,
) {
  const [state, setState] = useState<State>('idle');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const fileRef = useRef<File | null>(null);
  const autoSendRef = useRef(false);
  const liveVideoRef = useRef<HTMLVideoElement | null>(null);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const reset = useCallback(() => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    fileRef.current = null;
    chunksRef.current = [];
    autoSendRef.current = false;
    stopStream();
    setState('idle');
  }, [previewUrl, stopStream]);

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); stopStream(); }, [previewUrl, stopStream]);
  useEffect(() => { onBusyChange?.(state !== 'idle'); }, [state, onBusyChange]);

  // Attach the live stream to the preview <video> once it's mounted.
  useEffect(() => {
    if (state === 'recording' && mode === 'video' && liveVideoRef.current && streamRef.current) {
      liveVideoRef.current.srcObject = streamRef.current;
      liveVideoRef.current.play().catch(() => { /* ignore */ });
    }
  }, [state, mode]);

  const doSend = useCallback(() => { if (fileRef.current) onSend(fileRef.current); reset(); }, [onSend, reset]);

  const start = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia(
        mode === 'video' ? { audio: true, video: { facingMode: 'user' } } : { audio: true },
      );
      streamRef.current = stream;
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onstop = () => {
        const type = rec.mimeType || (mode === 'video' ? 'video/webm' : 'audio/webm');
        const blob = new Blob(chunksRef.current, { type });
        stopStream();
        if (blob.size === 0) { setState('idle'); return; }
        const ext = type.includes('mp4') ? 'mp4' : type.includes('ogg') ? 'ogg' : 'webm';
        const prefix = mode === 'video' ? 'video' : 'voice';
        const file = new File([blob], `${prefix}-${Date.now()}.${ext}`, { type });
        fileRef.current = file;
        if (autoSendRef.current) { autoSendRef.current = false; onSend(file); reset(); return; }
        setPreviewUrl(URL.createObjectURL(blob));
        setState('recorded');
      };
      recorderRef.current = rec;
      rec.start();
      setState('recording');
    } catch (err) {
      console.error('[media] capture failed:', err);
      alert(mode === 'video' ? 'Camera/mic access denied or unavailable.' : 'Microphone access denied or unavailable.');
      stopStream();
    }
  }, [mode, onSend, reset, stopStream]);

  const stop = useCallback(() => { recorderRef.current?.stop(); }, []);

  useImperativeHandle(ref, () => ({
    isRecording: state === 'recording',
    isBusy: state !== 'idle',
    stopAndSend: () => {
      if (state === 'recording') { autoSendRef.current = true; stop(); }
      else if (state === 'recorded') doSend();
    },
  }), [state, stop, doSend]);

  const trigger = (
    <button
      type="button"
      onClick={start}
      disabled={disabled}
      style={buttonStyle ?? s.btn}
      title={mode === 'video' ? 'Record video note' : 'Record voice note'}
    >
      {mode === 'video' ? '\u{1F3A5}' : '\u{1F3A4}'}
    </button>
  );

  if (state === 'idle') return trigger;

  return (
    <div style={s.anchor}>
      {trigger}
      <div style={{ ...s.panel, [align]: 0 }}>
        {state === 'recording' ? (
          <>
            {mode === 'video'
              ? <video ref={liveVideoRef} muted playsInline style={s.video} />
              : <div style={s.recRow}><span style={s.recDot} /> Recording…</div>}
            <div style={s.btnRow}>
              <button onClick={stop} style={s.stopBtn} title="Stop">{'⏹'} Stop</button>
              <button onClick={reset} style={s.discardBtn} title="Discard">{'\u{1F5D1}'}</button>
            </div>
            <div style={s.hint}>Tap Stop to finish, or discard.</div>
          </>
        ) : (
          <>
            {previewUrl && (mode === 'video'
              ? <video src={previewUrl} controls playsInline style={s.video} />
              : <audio src={previewUrl} controls style={s.audio} />)}
            <div style={s.btnRow}>
              <button onClick={doSend} style={s.sendBtn} title="Send">{'↑'} Send</button>
              <button onClick={reset} style={s.discardBtn} title="Discard">{'\u{1F5D1}'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
});

export default MediaRecorderControl;

const s = {
  btn: { width: '30px', height: '30px', borderRadius: '6px', background: 'transparent', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 } as React.CSSProperties,
  anchor: { position: 'relative' as const, display: 'flex' } as React.CSSProperties,
  panel: { position: 'absolute' as const, bottom: 'calc(100% + 8px)', width: '240px', padding: '10px', background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', borderRadius: '12px', boxShadow: '0 8px 24px rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', flexDirection: 'column' as const, gap: '8px' } as React.CSSProperties,
  video: { width: '100%', maxHeight: '180px', borderRadius: '8px', background: '#000', objectFit: 'cover' as const } as React.CSSProperties,
  audio: { width: '100%', height: '32px' } as React.CSSProperties,
  recRow: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--color-text-secondary)', padding: '8px 4px' } as React.CSSProperties,
  recDot: { width: '10px', height: '10px', borderRadius: '50%', background: '#E24B4A', animation: 'muster-flash 1s ease-in-out infinite' } as React.CSSProperties,
  btnRow: { display: 'flex', gap: '6px' } as React.CSSProperties,
  stopBtn: { flex: 1, padding: '6px 10px', borderRadius: '8px', background: 'var(--color-bg-hover)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)', cursor: 'pointer', fontSize: '13px' } as React.CSSProperties,
  sendBtn: { flex: 1, padding: '6px 10px', borderRadius: '8px', background: 'var(--color-accent)', border: 'none', color: '#fff', cursor: 'pointer', fontSize: '13px' } as React.CSSProperties,
  discardBtn: { width: '36px', borderRadius: '8px', background: 'transparent', border: '1px solid var(--color-border)', color: '#E24B4A', cursor: 'pointer', fontSize: '13px' } as React.CSSProperties,
  hint: { fontSize: '11px', color: 'var(--color-text-muted)', textAlign: 'center' as const } as React.CSSProperties,
} as const;
