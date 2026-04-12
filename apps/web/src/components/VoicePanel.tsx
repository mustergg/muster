/**
 * VoicePanel — R18
 *
 * Displays voice channel state: participants, mute/unmute, join/leave.
 * Replaces the "Voice coming in R18" placeholder from R13.
 */

import React from 'react';
import { useVoiceStore } from '../stores/voiceStore.js';
import { useNetworkStore } from '../stores/networkStore.js';

interface Props {
  channelId: string;
  channelName: string;
}

export default function VoicePanel({ channelId, channelName }: Props): React.JSX.Element {
  const { currentChannel, participants, muted, connecting, error, join, leave, toggleMute } = useVoiceStore();
  const { publicKey: myKey } = useNetworkStore();

  const isInThisChannel = currentChannel === channelId;
  const isInOtherChannel = currentChannel !== null && !isInThisChannel;

  return (
    <div style={s.container}>
      {/* Header */}
      <div style={s.header}>
        <span style={s.headerIcon}>{'\u{1F50A}'}</span>
        <span style={s.headerTitle}>{channelName}</span>
        {isInThisChannel && (
          <span style={s.liveBadge}>LIVE</span>
        )}
      </div>

      {error && <div style={s.error}>{error}</div>}

      {/* Not connected state */}
      {!isInThisChannel && (
        <div style={s.joinSection}>
          <div style={s.voiceIcon}>{'\u{1F3A4}'}</div>
          <p style={s.joinText}>
            {isInOtherChannel
              ? 'You are in another voice channel. Leave it first to join this one.'
              : 'Click below to join the voice channel.'
            }
          </p>
          <button
            onClick={() => join(channelId)}
            disabled={connecting || isInOtherChannel}
            style={{ ...s.joinBtn, opacity: connecting || isInOtherChannel ? 0.5 : 1 }}
          >
            {connecting ? 'Connecting...' : 'Join Voice'}
          </button>
        </div>
      )}

      {/* Connected state */}
      {isInThisChannel && (
        <>
          {/* Participants */}
          <div style={s.participantList}>
            {participants.length === 0 && (
              <p style={s.emptyText}>Waiting for others to join...</p>
            )}
            {participants.map((p) => (
              <div key={p.publicKey} style={s.participant}>
                <div style={{
                  ...s.avatar,
                  borderColor: p.publicKey === myKey ? 'var(--color-accent)' : 'transparent',
                }}>
                  {p.username.slice(0, 2).toUpperCase()}
                </div>
                <span style={s.participantName}>
                  {p.username}
                  {p.publicKey === myKey && ' (you)'}
                </span>
                <span style={s.muteIcon}>
                  {p.muted ? '\u{1F507}' : '\u{1F50A}'}
                </span>
              </div>
            ))}
          </div>

          {/* Controls */}
          <div style={s.controls}>
            <button onClick={toggleMute} style={{ ...s.controlBtn, background: muted ? '#E24B4A' : 'var(--color-bg-tertiary)' }}>
              {muted ? '\u{1F507} Unmute' : '\u{1F50A} Mute'}
            </button>
            <button onClick={leave} style={s.leaveBtn}>
              {'\u{1F4F4}'} Leave
            </button>
          </div>
        </>
      )}
    </div>
  );
}

const s = {
  container: { display: 'flex', flexDirection: 'column' as const, height: '100%', background: 'var(--color-bg-primary)' } as React.CSSProperties,
  header: { display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 16px', borderBottom: '1px solid var(--color-border)', flexShrink: 0 } as React.CSSProperties,
  headerIcon: { fontSize: '16px' } as React.CSSProperties,
  headerTitle: { fontSize: '15px', fontWeight: 600, flex: 1 } as React.CSSProperties,
  liveBadge: { fontSize: '10px', fontWeight: 700, color: '#fff', background: '#E24B4A', padding: '2px 8px', borderRadius: '4px', letterSpacing: '0.05em' } as React.CSSProperties,
  error: { padding: '8px 16px', fontSize: '12px', color: '#E24B4A', background: 'var(--color-bg-secondary)', borderBottom: '1px solid var(--color-border)' } as React.CSSProperties,
  joinSection: { flex: 1, display: 'flex', flexDirection: 'column' as const, alignItems: 'center', justifyContent: 'center', gap: '16px', padding: '32px' } as React.CSSProperties,
  voiceIcon: { fontSize: '64px', opacity: 0.3 } as React.CSSProperties,
  joinText: { fontSize: '13px', color: 'var(--color-text-muted)', textAlign: 'center' as const, maxWidth: '280px', lineHeight: 1.5, margin: 0 } as React.CSSProperties,
  joinBtn: { padding: '10px 32px', borderRadius: 'var(--radius-md)', border: 'none', background: '#43B581', color: '#fff', fontSize: '14px', fontWeight: 600, cursor: 'pointer' } as React.CSSProperties,
  participantList: { flex: 1, overflowY: 'auto' as const, padding: '12px 16px', display: 'flex', flexDirection: 'column' as const, gap: '4px' } as React.CSSProperties,
  emptyText: { fontSize: '13px', color: 'var(--color-text-muted)', textAlign: 'center' as const, padding: '32px 0' } as React.CSSProperties,
  participant: { display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', borderRadius: 'var(--radius-md)', background: 'var(--color-bg-secondary)' } as React.CSSProperties,
  avatar: { width: '32px', height: '32px', borderRadius: '50%', background: 'var(--color-bg-tertiary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 600, color: 'var(--color-text-secondary)', border: '2px solid transparent', flexShrink: 0 } as React.CSSProperties,
  participantName: { fontSize: '13px', fontWeight: 500, flex: 1 } as React.CSSProperties,
  muteIcon: { fontSize: '14px', flexShrink: 0 } as React.CSSProperties,
  controls: { display: 'flex', gap: '8px', padding: '12px 16px', borderTop: '1px solid var(--color-border)', flexShrink: 0, justifyContent: 'center' } as React.CSSProperties,
  controlBtn: { padding: '8px 20px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)', fontSize: '13px', fontWeight: 500, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' } as React.CSSProperties,
  leaveBtn: { padding: '8px 20px', borderRadius: 'var(--radius-md)', border: '1px solid #E24B4A', background: 'transparent', color: '#E24B4A', fontSize: '13px', fontWeight: 500, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' } as React.CSSProperties,
} as const;
