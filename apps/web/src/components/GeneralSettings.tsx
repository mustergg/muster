/**
 * GeneralSettings — language + general app preferences.
 *
 * English is the development source language; other locales are
 * translations. The choice is persisted (localStorage) and applied on
 * boot by main.tsx.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { SUPPORTED_LOCALES, setLocale, getStoredLocale, type SupportedLocale } from '@muster/i18n';

export default function GeneralSettings(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const current = (i18n.language as SupportedLocale) || getStoredLocale();

  const pick = (loc: SupportedLocale): void => { void setLocale(loc); };

  return (
    <div style={s.container}>
      <div style={s.header}>
        <span style={s.headerIcon}>{'\u{1F310}'}</span>
        <span style={s.headerTitle}>{t('settings.general')}</span>
      </div>

      <div style={s.scrollArea}>
        <div style={s.section}>
          <div style={s.sectionTitle}>{t('settings.language')}</div>
          <div style={s.langList}>
            {(Object.entries(SUPPORTED_LOCALES) as [SupportedLocale, string][]).map(([code, label]) => (
              <button
                key={code}
                onClick={() => pick(code)}
                style={{
                  ...s.langBtn,
                  borderColor: current === code ? 'var(--color-accent)' : 'var(--color-border)',
                  background: current === code ? 'var(--color-accent-dim, rgba(46,117,182,0.1))' : 'var(--color-bg-secondary)',
                }}
              >
                <span style={s.langLabel}>{label}</span>
                {current === code && <span style={s.check}>{'✓'}</span>}
              </button>
            ))}
          </div>
          <div style={s.note}>{t('settings.languageNote')}</div>
        </div>

        <div style={s.section}>
          <div style={s.sectionTitle}>{t('settings.about')}</div>
          <div style={s.aboutRow}><span style={s.aboutK}>{t('settings.version')}</span><span style={s.aboutV}>{__APP_VERSION__}</span></div>
          <div style={s.aboutRow}><span style={s.aboutK}>{t('settings.build')}</span><span style={s.aboutV}>{__APP_BUILD__} ({__APP_STAGE__})</span></div>
        </div>
      </div>
    </div>
  );
}

const s = {
  container: { display: 'flex', flexDirection: 'column' as const, height: '100%', background: 'var(--color-bg-primary)' } as React.CSSProperties,
  header: { display: 'flex', alignItems: 'center', gap: '8px', padding: '16px 20px', borderBottom: '1px solid var(--color-border)', flexShrink: 0 } as React.CSSProperties,
  headerIcon: { fontSize: '18px' } as React.CSSProperties,
  headerTitle: { fontSize: '16px', fontWeight: 700 } as React.CSSProperties,
  scrollArea: { flex: 1, overflow: 'auto', padding: '0 20px 20px' } as React.CSSProperties,
  section: { marginTop: '20px' } as React.CSSProperties,
  sectionTitle: { fontSize: '12px', fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase' as const, letterSpacing: '0.05em', marginBottom: '8px' } as React.CSSProperties,
  langList: { display: 'flex', flexDirection: 'column' as const, gap: '8px', maxWidth: '320px' } as React.CSSProperties,
  langBtn: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', cursor: 'pointer', color: 'var(--color-text-primary)', fontSize: '14px' } as React.CSSProperties,
  langLabel: { fontWeight: 500 } as React.CSSProperties,
  check: { color: 'var(--color-accent)', fontWeight: 700 } as React.CSSProperties,
  note: { fontSize: '12px', color: 'var(--color-text-muted)', marginTop: '10px', maxWidth: '320px', lineHeight: 1.4 } as React.CSSProperties,
  aboutRow: { display: 'flex', justifyContent: 'space-between', maxWidth: '320px', fontSize: '13px', padding: '3px 0' } as React.CSSProperties,
  aboutK: { color: 'var(--color-text-muted)' } as React.CSSProperties,
  aboutV: { fontWeight: 500, fontFamily: 'var(--font-mono, monospace)' } as React.CSSProperties,
} as const;
