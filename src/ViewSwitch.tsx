import { motion } from 'motion/react';

/**
 * How to see the tickets: the Helix, or Tiles (a wall you drag and scroll).
 * A pair of pills at the top, in the console's type, the chosen one filled.
 * (The Rolodex and the Wheel are still in the panel.)
 */
export function ViewSwitch({ view, dark, onView }: { view: string; dark: boolean; onView: (view: string) => void }) {
  const ink = dark ? '#e8e6e1' : '#1a1a1a';
  const paper = dark ? '#000805' : '#f3f2ed';
  return (
    // a paper backing, so it reads over the wall's tiles as well as the bare room
    <div style={{ ...TOP_STYLE, borderColor: ink, background: paper }} role="group" aria-label="View">
      {VIEWS.map((v) => {
        const on = view === v;
        return (
          <button
            key={v}
            type="button"
            aria-pressed={on}
            onClick={() => onView(v)}
            style={{ ...PILL_STYLE, color: on ? paper : ink }}
          >
            {/* the filled pill slides from one to the other */}
            {on && (
              <motion.span
                layoutId="view-pill"
                style={{ ...FILL_STYLE, background: ink }}
                transition={{ type: 'spring', stiffness: 520, damping: 38 }}
              />
            )}
            <span style={{ position: 'relative' }}>{v}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Light or Dark: the room, bottom right */
export function ThemeSwitch({ theme, onTheme }: { theme: string; onTheme: (theme: string) => void }) {
  return <Switch label="Theme" options={THEMES} value={theme} dark={theme === 'Dark'} onPick={onTheme} side="right" />;
}

const VIEWS = ['Helix', 'Tiles'];
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

const TOP_STYLE: React.CSSProperties = {
  position: 'fixed',
  top: 24,
  left: '50%',
  transform: 'translateX(-50%)',
  zIndex: 10,
  display: 'flex',
  padding: 3,
  gap: 2,
  border: '1px solid',
  borderRadius: 999,
  boxShadow: '0 4px 16px rgba(0, 0, 0, 0.12)',
  font: "11px/1 'Geist Mono', ui-monospace, monospace",
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
};

const FILL_STYLE: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  borderRadius: 999,
};

const PILL_STYLE: React.CSSProperties = {
  position: 'relative',
  background: 'transparent',
  border: 'none',
  borderRadius: 999,
  padding: '7px 14px',
  font: 'inherit',
  letterSpacing: 'inherit',
  textTransform: 'inherit',
  cursor: 'pointer',
  transition: 'color 0.2s',
};

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
