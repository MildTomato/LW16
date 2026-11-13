/**
 * How to see the tickets: as the Rolodex, the Wheel, the Helix, or as Tiles — an endless sheet you
 * drag and scroll. In the console's own type, bottom left.
 */
export function ViewSwitch({ view, dark, onView }: { view: string; dark: boolean; onView: (view: string) => void }) {
  return <Switch label="View" options={VIEWS} value={view} dark={dark} onPick={onView} side="left" />;
}

/** Light or Dark: the room, bottom right */
export function ThemeSwitch({ theme, onTheme }: { theme: string; onTheme: (theme: string) => void }) {
  return <Switch label="Theme" options={THEMES} value={theme} dark={theme === 'Dark'} onPick={onTheme} side="right" />;
}

const VIEWS = ['Rolodex', 'Wheel', 'Helix', 'Tiles'];
const THEMES = ['Light', 'Dark'];

/** a row of choices in the console's own type, the chosen one underlined */
function Switch({
  label,
  options,
  value,
  dark,
  onPick,
  side,
}: {
  label: string;
  options: string[];
  value: string;
  dark: boolean;
  onPick: (v: string) => void;
  side: 'left' | 'right';
}) {
  const ink = dark ? '#e8e6e1' : '#1a1a1a';
  return (
    <div style={{ ...WRAP_STYLE, [side]: 24 }} role="group" aria-label={label}>
      {options.map((v, i) => (
        <span key={v}>
          {i > 0 && <span style={{ color: ink, opacity: 0.35 }}> · </span>}
          <button
            type="button"
            aria-pressed={value === v}
            onClick={() => onPick(v)}
            style={{
              ...BUTTON_STYLE,
              color: ink,
              opacity: value === v ? 1 : 0.45,
              textDecoration: value === v ? 'underline' : 'none',
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
