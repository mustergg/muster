/**
 * TransferOwnershipModal — shown when the owner tries to leave a community.
 * Lists eligible verified members to receive ownership, or shows delete option.
 */

import React, { useState, useEffect } from 'react';
import { useCommunityStore } from '../stores/communityStore.js';
import { useNetworkStore } from '../stores/networkStore.js';
import type { TransportMessage } from '@muster/transport';

interface Props {
  communityId: string;
  communityName: string;
  onClose: () => void;
  onDeleted?: () => void;
}

interface EligibleMember {
  publicKey: string;
  username: string;
  role: string;
}

export default function TransferOwnershipModal({ communityId, communityName, onClose, onDeleted }: Props): React.JSX.Element {
  const { transport } = useNetworkStore();
  const { leaveCommunity } = useCommunityStore();
  const [eligible, setEligible] = useState<EligibleMember[]>([]);
  const [totalMembers, setTotalMembers] = useState(0);
  const [isOnlyMember, setIsOnlyMember] = useState(false);
  const [loading, setLoading] = useState(true);
  const [transferring, setTransferring] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [showDelete, setShowDelete] = useState(false);
  const [confirmName, setConfirmName] = useState('');
  const [deleting, setDeleting] = useState(false);

  // Request eligibility on mount
  useEffect(() => {
    if (!transport?.isConnected) return;

    const cleanup = useNetworkStore.getState().onMessage((msg: TransportMessage) => {
      if (msg.type === 'TRANSFER_ELIGIBILITY') {
        const p = msg.payload as any;
        if (p.communityId === communityId) {
          setEligible(p.eligibleMembers || []);
          setTotalMembers(p.totalMembers || 0);
          setIsOnlyMember(p.isOnlyMember || false);
          setLoading(false);
        }
      }
      if (msg.type === 'OWNERSHIP_TRANSFERRED') {
        const p = msg.payload as any;
        if (p.communityId === communityId) {
          // Transfer succeeded — now leave
          leaveCommunity(communityId);
          onClose();
        }
      }
      if (msg.type === 'COMMUNITY_DELETED') {
        const p = msg.payload as any;
        if (p.communityId === communityId) {
          onDeleted?.();
          onClose();
        }
      }
      if (msg.type === 'ERROR') {
        setError((msg.payload as any).message || 'An error occurred');
        setTransferring(false);
        setDeleting(false);
      }
    });

    transport.send({
      type: 'CHECK_TRANSFER_ELIGIBILITY',
      payload: { communityId },
      timestamp: Date.now(),
    });

    return cleanup;
  }, [communityId]);

  const handleTransfer = (): void => {
    if (!selected || !transport?.isConnected) return;
    setTransferring(true);
    setError('');
    transport.send({
      type: 'TRANSFER_OWNERSHIP',
      payload: { communityId, newOwnerPublicKey: selected },
      timestamp: Date.now(),
    });
  };

  const handleDelete = (): void => {
    if (confirmName.trim() !== communityName || !transport?.isConnected) return;
    setDeleting(true);
    setError('');
    transport.send({
      type: 'DELETE_COMMUNITY_CMD',
      payload: { communityId, confirmName: confirmName.trim() },
      timestamp: Date.now(),
    });
  };

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <span style={styles.title}>
            {showDelete ? 'Delete community' : 'Transfer ownership'}
          </span>
          <button onClick={onClose} style={styles.closeBtn}>&#x2715;</button>
        </div>

        <div style={styles.body}>
          {loading ? (
            <p style={styles.loadingText}>Checking eligible members...</p>
          ) : showDelete ? (
            /* ── Delete confirmation ── */
            <>
              <div style={styles.dangerBox}>
                <p style={styles.dangerTitle}>This action is permanent</p>
                <p style={styles.dangerText}>
                  Deleting <strong>{communityName}</strong> will permanently remove all channels,
                  messages, and member data. This cannot be undone.
                </p>
              </div>
              <label style={styles.label}>
                Type the community name to confirm:
                <input
                  type="text"
                  value={confirmName}
                  onChange={(e) => setConfirmName(e.target.value)}
                  placeholder={communityName}
                  style={styles.input}
                  autoFocus
                />
              </label>
            </>
          ) : isOnlyMember ? (
            /* ── Only member — can only delete ── */
            <>
              <p style={styles.desc}>
                You are the only member of <strong>{communityName}</strong>.
                There is no one to transfer ownership to.
              </p>
              <p style={styles.desc}>
                You can delete the community to remove all data permanently.
              </p>
            </>
          ) : eligible.length === 0 ? (
            /* ── No verified members ── */
            <>
              <p style={styles.desc}>
                There are {totalMembers - 1} other member(s) in <strong>{communityName}</strong>,
                but none have verified their email. Ownership can only be transferred to verified accounts.
              </p>
              <p style={styles.desc}>
                Ask a member to verify their email, or delete the community.
              </p>
            </>
          ) : (
            /* ── Normal transfer ── */
            <>
              <p style={styles.desc}>
                Select a verified member to become the new owner of <strong>{communityName}</strong>.
                You will be demoted to admin after the transfer.
              </p>
              <div style={styles.memberList}>
                {eligible.map((m) => {
                  const hue = parseInt((m.publicKey || '0000').slice(0, 4), 16) % 360;
                  const isSelected = selected === m.publicKey;
                  return (
                    <button
                      key={m.publicKey}
                      onClick={() => setSelected(m.publicKey)}
                      style={{
                        ...styles.memberItem,
                        borderColor: isSelected ? 'var(--color-accent)' : 'var(--color-border)',
                        background: isSelected ? 'var(--color-accent-dim)' : 'transparent',
                      }}
                    >
                      <div style={{ ...styles.avatar, background: `hsl(${hue},40%,20%)`, color: `hsl(${hue},70%,65%)` }}>
                        {(m.username || '??').slice(0, 2).toUpperCase()}
                      </div>
                      <div style={styles.memberInfo}>
                        <span style={styles.memberName}>{m.username}</span>
                        <span style={styles.memberRole}>{m.role}</span>
                      </div>
                      {isSelected && <span style={styles.checkmark}>&#x2713;</span>}
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {error && <p style={styles.error}>{error}</p>}
        </div>

        <div style={styles.footer}>
          {showDelete ? (
            <>
              <button className="btn btn-ghost" onClick={() => setShowDelete(false)} disabled={deleting}>Back</button>
              <button
                onClick={handleDelete}
                disabled={deleting || confirmName.trim() !== communityName}
                style={styles.dangerBtn}
              >
                {deleting ? 'Deleting...' : 'Delete community'}
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setShowDelete(true)}
                style={styles.deleteLinkBtn}
              >
                Delete community instead
              </button>
              <div style={{ flex: 1 }} />
              <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
              {eligible.length > 0 && (
                <button
                  className="btn btn-primary"
                  onClick={handleTransfer}
                  disabled={!selected || transferring}
                >
                  {transferring ? 'Transferring...' : 'Transfer & leave'}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const styles = {
  overlay: { position: 'fixed' as const, inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 } as React.CSSProperties,
  modal: { background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', width: '100%', maxWidth: '480px', overflow: 'hidden' } as React.CSSProperties,
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--color-border)' } as React.CSSProperties,
  title: { fontSize: '16px', fontWeight: 600 } as React.CSSProperties,
  closeBtn: { background: 'transparent', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: '16px', padding: '4px' } as React.CSSProperties,
  body: { padding: '20px', maxHeight: '400px', overflowY: 'auto' as const } as React.CSSProperties,
  desc: { fontSize: '13px', color: 'var(--color-text-secondary)', lineHeight: 1.5, marginBottom: '12px' } as React.CSSProperties,
  loadingText: { fontSize: '13px', color: 'var(--color-text-muted)', textAlign: 'center' as const, padding: '20px 0' } as React.CSSProperties,
  memberList: { display: 'flex', flexDirection: 'column' as const, gap: '6px' } as React.CSSProperties,
  memberItem: { display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', cursor: 'pointer', transition: 'border-color 0.15s, background 0.15s', background: 'transparent', width: '100%', textAlign: 'left' as const } as React.CSSProperties,
  avatar: { width: '32px', height: '32px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 700, flexShrink: 0 } as React.CSSProperties,
  memberInfo: { flex: 1, display: 'flex', flexDirection: 'column' as const } as React.CSSProperties,
  memberName: { fontSize: '13px', fontWeight: 600, color: 'var(--color-text-primary)' } as React.CSSProperties,
  memberRole: { fontSize: '11px', color: 'var(--color-text-muted)' } as React.CSSProperties,
  checkmark: { fontSize: '16px', color: 'var(--color-accent)', flexShrink: 0 } as React.CSSProperties,
  dangerBox: { padding: '12px 14px', background: 'rgba(226,75,74,0.08)', border: '1px solid rgba(226,75,74,0.3)', borderRadius: 'var(--radius-md)', marginBottom: '16px' } as React.CSSProperties,
  dangerTitle: { fontSize: '14px', fontWeight: 600, color: '#E24B4A', marginBottom: '6px' } as React.CSSProperties,
  dangerText: { fontSize: '12px', color: 'var(--color-text-secondary)', lineHeight: 1.5 } as React.CSSProperties,
  label: { display: 'flex', flexDirection: 'column' as const, gap: '6px', fontSize: '13px', color: 'var(--color-text-secondary)', fontWeight: 500 } as React.CSSProperties,
  input: { width: '100%', padding: '10px 12px', background: 'var(--color-bg-input)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', color: 'var(--color-text-primary)', outline: 'none', fontSize: '13px', fontFamily: 'inherit' } as React.CSSProperties,
  error: { fontSize: '12px', color: '#E24B4A', marginTop: '8px' } as React.CSSProperties,
  footer: { display: 'flex', alignItems: 'center', gap: '8px', padding: '16px 20px', borderTop: '1px solid var(--color-border)' } as React.CSSProperties,
  dangerBtn: { padding: '8px 16px', borderRadius: 'var(--radius-md)', border: 'none', background: '#E24B4A', color: '#fff', fontSize: '13px', fontWeight: 600, cursor: 'pointer' } as React.CSSProperties,
  deleteLinkBtn: { background: 'transparent', border: 'none', color: '#E24B4A', cursor: 'pointer', fontSize: '12px', padding: 0, textDecoration: 'underline' } as React.CSSProperties,
} as const;
