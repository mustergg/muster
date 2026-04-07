/**
 * CreateSquadModal — R13
 */

import React, { useState } from 'react';
import { useSquadStore } from '../stores/squadStore.js';

interface Props {
  communityId: string;
  onClose: () => void;
}

export default function CreateSquadModal({ communityId, onClose }: Props): React.JSX.Element {
  const { createSquad, loading } = useSquadStore();
  const [name, setName] = useState('');

  const handleSubmit = () => {
    if (!name.trim()) return;
    createSquad(communityId, name.trim());
    onClose();
  };

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.modal} onClick={(e) => e.stopPropagation()}>
        <div style={s.header}>
          <span style={s.title}>Create squad</span>
          <button onClick={onClose} style={s.closeBtn}>&#x2715;</button>
        </div>
        <div style={s.body}>
          <label style={s.label}>
            Squad name
            <input
              type="text" value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
              placeholder="e.g. Ranked Team, Raid Group..."
              maxLength={50} autoFocus style={s.input}
            />
          </label>
          <p style={s.hint}>Squads are invite-only groups with their own text and voice channels. You'll be the squad owner.</p>
        </div>
        <div style={s.footer}>
          <button className="btn btn-ghost" onClick={onClose} disabled={loading}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={loading || !name.trim()}>
            {loading ? 'Creating...' : 'Create squad'}
          </button>
        </div>
      </div>
    </div>
  );
}

const s = {
  overlay: { position: 'fixed' as const, inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 } as React.CSSProperties,
  modal: { background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', width: '100%', maxWidth: '420px', overflow: 'hidden' } as React.CSSProperties,
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--color-border)' } as React.CSSProperties,
  title: { fontSize: '16px', fontWeight: 600 } as React.CSSProperties,
  closeBtn: { background: 'transparent', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: '16px', padding: '4px' } as React.CSSProperties,
  body: { padding: '20px', display: 'flex', flexDirection: 'column' as const, gap: '12px' } as React.CSSProperties,
  label: { display: 'flex', flexDirection: 'column' as const, gap: '6px', fontSize: '13px', color: 'var(--color-text-secondary)', fontWeight: 500 } as React.CSSProperties,
  input: { width: '100%', padding: '10px 12px', background: 'var(--color-bg-input)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', color: 'var(--color-text-primary)', outline: 'none', fontSize: '13px', fontFamily: 'inherit', boxSizing: 'border-box' as const } as React.CSSProperties,
  hint: { fontSize: '11px', color: 'var(--color-text-muted)', lineHeight: 1.5, margin: 0 } as React.CSSProperties,
  footer: { display: 'flex', justifyContent: 'flex-end', gap: '8px', padding: '16px 20px', borderTop: '1px solid var(--color-border)' } as React.CSSProperties,
} as const;
