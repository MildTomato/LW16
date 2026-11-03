/**
 * How to see the tickets: as the Helix, or as Tiles — an endless sheet you
 * drag and scroll. In the console's own type, bottom left.
 */
export function ViewSwitch({ view, dark, onView }: { view: string; dark: boolean; onView: (view: string) => void }) {
  const ink = dark ? '#e8e6e1' : '#1a1a1a';
  return (
    <div style={WRAP_STYLE} role="group" aria-label="View">
      {['Helix', 'Tiles'].map((v, i) => (
        <span key={v}>
          {i > 0 && <span style={{ color: ink, opacity: 0.35 }}> · </span>}
          <button
            type="button"
            aria-pressed={view === v}
            onClick={() => onView(v)}
            style={{
              ...BUTTON_STYLE,
              color: ink,
              opacity: view === v ? 1 : 0.45,
              textDecoration: view === v ? 'underline' : 'none',
            }}
          >
            {v}
          </button>
        </span>
      ))}
    </div>
  );
}

const WRAP_STYLE: React.CSSProperties = {
  position: 'fixed',
  left: 24,
  bottom: 32,
  zIndex: 10,
  font: "11px/1 'Geist Mono', ui-monospace, monospace",
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
};

const BUTTON_STYLE: React.CSSProperties = {
  border: 'none',
  background: 'none',
  padding: '4px 2px',
  font: 'inherit',
  letterSpacing: 'inherit',
  textTransform: 'inherit',
  textUnderlineOffset: 4,
  cursor: 'pointer',
};
