/**
 * CreateSquadGlobalModal — create a squad from the main UI.
 *
 * Lets the user pick where the squad lives: their personal/friends space, or
 * (if they own/admin any community) inside one of those communities.
 */

import React, { useState } from 'react';
import { useSquadStore } from '../stores/squadStore.js';
import { useCommunityStore } from '../stores/communityStore.js';
import { useNetworkStore } from '../stores/networkStore.js';

export default function CreateSquadGlobalModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const { createSquad, personalSpaceId } = useSquadStore();
  const { communities, myRoles } = useCommunityStore();
  const myKey = useNetworkStore((s) => s.publicKey);

  // Communities where the user is owner/admin (can create community squads).
  const adminCommunities = Object.values(communities).filter(
    (c) => c.ownerPublicKey === myKey || ['owner', 'admin'].includes(myRoles[c.id] || ''),
  );

  const [name, setName] = useState('');
  const [where, setWhere] = useState<string>('personal');
  const [loading, setLoading] = useState(false);

  const submit = (): void => {
    if (!name.trim()) return;
    setLoading(true);
    const communityId = where === 'personal' ? personalSpaceId() : where;
    createSquad(communityId, name.trim());
    onClose();
  };

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.modal} onClick={(e) => e.stopPropagation()}>
        <div style={s.header}>
          <span style={s.title}>Create Squad</span>
          <button onClick={onClose} style={s.closeBtn}>&#x2715;</button>
        </div>
        <div style={s.body}>
          <label style={s.label}>
            Squad name
            <input
              type="text" value={name} autoFocus maxLength={50}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              placeholder="my-squad" style={s.input}
            />
          </label>

          {adminCommunities.length > 0 && (
            <label style={s.label}>
              Where
              <select value={where} onChange={(e) => setWhere(e.target.value)} style={s.input}>
                <option value="personal">Personal / Friends</option>
                {adminCommunities.map((c) => (
                  <option key={c.id} value={c.id}>Community: {c.name}</option>
                ))}
              </select>
            </label>
          )}
          {adminCommunities.length === 0 && (
            <div style={s.note}>This squad will be in your personal / friends space.</div>
          )}
        </div>
        <div style={s.footer}>
          <button className="btn btn-ghost" onClick={onClose} disabled={loading}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={loading || !name.trim()}>
            {loading ? 'Creating…' : 'Create squad'}
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
  closeBtn: { background: 'transparent', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: '16px' } as React.CSSProperties,
  body: { padding: '20px', display: 'flex', flexDirection: 'column' as const, gap: '16px' } as React.CSSProperties,
  label: { display: 'flex', flexDirection: 'column' as const, gap: '6px', fontSize: '13px', color: 'var(--color-text-secondary)', fontWeight: 500 } as React.CSSProperties,
  input: { padding: '10px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-bg-input, var(--color-bg-primary))', color: 'var(--color-text-primary)', fontSize: '13px', outline: 'none' } as React.CSSProperties,
  note: { fontSize: '12px', color: 'var(--color-text-muted)' } as React.CSSProperties,
  footer: { display: 'flex', justifyContent: 'flex-end', gap: '8px', padding: '16px 20px', borderTop: '1px solid var(--color-border)' } as React.CSSProperties,
} as const;
