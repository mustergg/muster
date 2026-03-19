import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useCommunityStore } from '../stores/communityStore.js';
import CreateCommunityModal from '../pages/CreateCommunityModal.js';
import JoinCommunityModal from '../pages/JoinCommunityModal.js';

interface Props {
  activeCommunityId: string | null;
  onSelectCommunity: (id: string) => void;
}

function communityInitials(name: string): string {
  return name.split(/\s+/).map((w) => w[0] ?? '').join('').toUpperCase().slice(0, 2);
}

function communityColor(id: string): { color: string; bg: string } {
  const hue = parseInt(id.slice(0, 4), 16) % 360;
  return { color: `hsl(${hue},60%,65%)`, bg: `hsl(${hue},40%,18%)` };
}

export default function GuildsSidebar({ activeCommunityId, onSelectCommunity }: Props): React.JSX.Element {
  const { t } = useTranslation();
  const { communities, loadCommunities } = useCommunityStore();
  const [showCreate, setShowCreate] = useState(false);
  const [showJoin,   setShowJoin]   = useState(false);
  const [showMenu,   setShowMenu]   = useState(false);

  useEffect(() => {
    loadCommunities();
  }, []);

  // Check URL for invite link on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('join')) setShowJoin(true);
  }, []);

  const communityList = Object.values(communities);

  return (
    <>
      <div style={styles.sidebar}>
        {communityList.map((c) => {
          const { color, bg } = communityColor(c.id);
          const isActive = activeCommunityId === c.id;
          return (
            <button
              key={c.id}
              title={c.name}
              onClick={() => onSelectCommunity(c.id)}
              style={{
                ...styles.icon,
                background: bg,
                color,
                borderRadius: isActive ? '14px' : '50%',
                border: isActive ? `2px solid var(--color-accent)` : '2px solid transparent',
                position: 'relative' as const,
              }}
            >
              {isActive && <div style={styles.activePip} />}
              {communityInitials(c.name)}
            </button>
          );
        })}

        {communityList.length === 0 && (
          <div style={styles.emptyHint}>No communities yet</div>
        )}

        <div style={styles.divider} />

        {/* Add community button */}
        <div style={{ position: 'relative' as const }}>
          <button
            title={t('nav.addCommunity')}
            onClick={() => setShowMenu((v) => !v)}
            style={{ ...styles.icon, background: 'var(--color-bg-hover)', color: 'var(--color-accent)', fontSize: '22px', fontWeight: 300, borderRadius: '50%', border: '2px solid transparent' }}
          >
            +
          </button>
          {showMenu && (
            <div style={styles.menu}>
              <button style={styles.menuItem} onClick={() => { setShowCreate(true); setShowMenu(false); }}>
                Create a community
              </button>
              <button style={styles.menuItem} onClick={() => { setShowJoin(true); setShowMenu(false); }}>
                Join with invite
              </button>
            </div>
          )}
        </div>
      </div>

      {showCreate && (
        <CreateCommunityModal
          onClose={() => setShowCreate(false)}
          onCreated={(id) => { onSelectCommunity(id); setShowCreate(false); }}
        />
      )}
      {showJoin && (
        <JoinCommunityModal
          onClose={() => setShowJoin(false)}
          onJoined={(id) => { onSelectCommunity(id); setShowJoin(false); }}
          prefillLink={new URLSearchParams(window.location.search).get('join')
            ? window.location.href : undefined}
        />
      )}
    </>
  );
}

const styles = {
  sidebar:   { width:'var(--sidebar-guilds-w)', background:'var(--color-bg-tertiary)', display:'flex', flexDirection:'column' as const, alignItems:'center', padding:'10px 0', gap:'6px', borderRight:'1px solid var(--color-border)', flexShrink:0, overflowY:'auto' as const } as React.CSSProperties,
  icon:      { width:'44px', height:'44px', border:'none', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', fontSize:'14px', fontWeight:700, transition:'border-radius 0.2s, border-color 0.2s', flexShrink:0 } as React.CSSProperties,
  activePip: { position:'absolute' as const, left:'-7px', top:'50%', transform:'translateY(-50%)', width:'4px', height:'24px', background:'var(--color-accent)', borderRadius:'0 2px 2px 0' } as React.CSSProperties,
  divider:   { width:'32px', height:'1px', background:'var(--color-border)', margin:'2px 0', flexShrink:0 } as React.CSSProperties,
  emptyHint: { fontSize:'9px', color:'var(--color-text-muted)', textAlign:'center' as const, padding:'4px', lineHeight:1.4, maxWidth:'50px' } as React.CSSProperties,
  menu:      { position:'absolute' as const, left:'52px', top:'0', background:'var(--color-bg-secondary)', border:'1px solid var(--color-border)', borderRadius:'var(--radius-md)', minWidth:'180px', zIndex:200, boxShadow:'0 4px 16px rgba(0,0,0,0.4)' } as React.CSSProperties,
  menuItem:  { display:'block', width:'100%', padding:'10px 14px', background:'transparent', border:'none', color:'var(--color-text-secondary)', cursor:'pointer', fontSize:'13px', textAlign:'left' as const } as React.CSSProperties,
} as const;
