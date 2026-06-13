/**
 * MobileNavGrid — the pull-down fullscreen grid behind the mobile top bar.
 *
 * Shows squads first, then a divider, then communities; each group ordered by
 * pin → recency. Tap a tile to jump, star to pin. Rendered between the top bar
 * and the bottom user panel — it never covers the user panel.
 */
import React, { useRef } from 'react';
import { useCommunityStore } from '../stores/communityStore.js';
import { useSquadStore } from '../stores/squadStore.js';
import { useNavRecency, orderByRecency } from '../stores/navRecencyStore.js';

interface Props {
  onSelectCommunity: (id: string) => void;
  onSelectSquad: (id: string) => void;
  onClose: () => void;
}

interface Tile { id: string; kind: 'community' | 'squad'; name: string; }

function initials(name: string): string {
  return name.split(/\s+/).map((w) => w[0] ?? '').join('').toUpperCase().slice(0, 2) || '?';
}
function tileColors(t: Tile): { color: string; bg: string } {
  const hue = parseInt((t.id || '0000').slice(0, 4).replace(/[^0-9a-f]/gi, '0') || '0', 16) % 360;
  return t.kind === 'community'
    ? { color: `hsl(${hue},60%,65%)`, bg: `hsl(${hue},40%,18%)` }
    : { color: `hsl(${hue},60%,70%)`, bg: `hsl(${hue},35%,20%)` };
}

export default function MobileNavGrid({ onSelectCommunity, onSelectSquad, onClose }: Props): React.JSX.Element {
  const communities = useCommunityStore((s) => s.communities);
  const squads = useSquadStore((s) => s.allMySquads());
  const lastUsed = useNavRecency((s) => s.lastUsed);
  const pinned = useNavRecency((s) => s.pinned);
  const togglePin = useNavRecency((s) => s.togglePin);

  const squadTiles = orderByRecency(
    squads.map((sq) => ({ id: sq.id, kind: 'squad' as const, name: sq.name })),
    lastUsed, pinned,
  );
  const communityTiles = orderByRecency(
    Object.values(communities).map((c: any) => ({ id: c.id, kind: 'community' as const, name: c.name })),
    lastUsed, pinned,
  );

  const select = (t: Tile): void => {
    if (t.kind === 'community') onSelectCommunity(t.id);
    else onSelectSquad(t.id);
    onClose();
  };

  const renderTile = (t: Tile): React.JSX.Element => {
    const { color, bg } = tileColors(t);
    const isPinned = pinned.includes(t.id);
    return (
      <div key={`${t.kind}:${t.id}`} style={g.cell}>
        <button style={{ ...g.tile, background: bg, color }} onClick={() => select(t)} title={t.name}>
          {initials(t.name)}
        </button>
        <span style={g.name} title={t.name}>{t.name}</span>
        <button
          style={{ ...g.pin, color: isPinned ? 'var(--color-amber)' : 'var(--color-text-muted)' }}
          onClick={(e) => { e.stopPropagation(); togglePin(t.id); }}
          title={isPinned ? 'Unpin' : 'Pin'}
        >
          {isPinned ? '★' : '☆'}
        </button>
      </div>
    );
  };

  const empty = squadTiles.length === 0 && communityTiles.length === 0;

  // Pull up (when the grid is scrolled to the top) closes it.
  const scrollRef = useRef<HTMLDivElement>(null);
  const startY = useRef<number | null>(null);
  const onTouchStart = (e: React.TouchEvent): void => { startY.current = e.touches[0]?.clientY ?? null; };
  const onTouchEnd = (e: React.TouchEvent): void => {
    const sy = startY.current; startY.current = null;
    const ey = e.changedTouches[0]?.clientY;
    if (sy == null || ey == null) return;
    if (ey - sy < -50 && (scrollRef.current?.scrollTop ?? 0) <= 0) onClose();
  };

  return (
    <div style={g.wrap} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <div style={g.scroll} ref={scrollRef}>
        {empty && <div style={g.empty}>No communities or squads yet</div>}
        {squadTiles.length > 0 && (
          <>
            <div style={g.label}>Squads</div>
            <div style={g.grid}>{squadTiles.map(renderTile)}</div>
          </>
        )}
        {squadTiles.length > 0 && communityTiles.length > 0 && <div style={g.divider} />}
        {communityTiles.length > 0 && (
          <>
            <div style={g.label}>Communities</div>
            <div style={g.grid}>{communityTiles.map(renderTile)}</div>
          </>
        )}
      </div>
      <div style={g.header} onClick={onClose} title="Close">
        <span style={g.handle} />
      </div>
    </div>
  );
}

const g = {
  wrap: { flex: 1, display: 'flex', flexDirection: 'column' as const, minHeight: 0, background: 'var(--color-bg-primary)', overflow: 'hidden' } as React.CSSProperties,
  header: { minHeight: '30px', paddingBottom: 'var(--safe-bottom)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, cursor: 'pointer', borderTop: '1px solid var(--color-border)' } as React.CSSProperties,
  handle: { width: '40px', height: '4px', borderRadius: '2px', background: 'var(--color-border)' } as React.CSSProperties,
  scroll: { flex: 1, minHeight: 0, overflowY: 'auto' as const, padding: '4px 12px calc(16px + var(--safe-bottom))' } as React.CSSProperties,
  label: { fontSize: '11px', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.5px', color: 'var(--color-text-muted)', margin: '10px 2px 8px' } as React.CSSProperties,
  divider: { height: '1px', background: 'var(--color-border)', margin: '14px 0 2px' } as React.CSSProperties,
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(76px, 1fr))', gap: '14px 8px' } as React.CSSProperties,
  cell: { position: 'relative' as const, display: 'flex', flexDirection: 'column' as const, alignItems: 'center', gap: '5px' } as React.CSSProperties,
  tile: { width: '56px', height: '56px', borderRadius: '16px', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '17px', fontWeight: 700 } as React.CSSProperties,
  name: { fontSize: '11px', lineHeight: 1.2, color: 'var(--color-text-secondary)', textAlign: 'center' as const, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const } as React.CSSProperties,
  pin: { position: 'absolute' as const, top: '-4px', right: '6px', width: '22px', height: '22px', borderRadius: '50%', border: 'none', background: 'var(--color-bg-secondary)', cursor: 'pointer', fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 } as React.CSSProperties,
  empty: { textAlign: 'center' as const, color: 'var(--color-text-muted)', fontSize: '13px', padding: '24px 0' } as React.CSSProperties,
} as const;
