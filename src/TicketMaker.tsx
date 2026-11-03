import { useEffect, useRef, useState } from 'react';
import {
  CAN_MAKE_TICKETS,
  USERNAME_MAX,
  cleanUsername,
  drawTicket,
  myTicket,
  nextTicketNumber,
  randomDraft,
  saveTicket,
  type DrawnTicket,
  type Ticket,
  type TicketDraft,
} from './tickets.ts';
import type { LaserStatus } from './scene.ts';

interface Props {
  /** making started or stopped: the card is the ticket meanwhile */
  onOpen: (open: boolean) => void;
  /** the laser cutting it, as the scene reports it */
  laser: LaserStatus | null;
  /** the room is dark: the console's type goes light */
  dark: boolean;
  /** a drawn ticket for the card: a new artwork is cut in by the laser, a new username just relettered */
  onArt: (drawn: DrawnTicket, etch: boolean) => void;
  onSaved: (t: Ticket) => void;
}

/**
 * Make your ticket: remix the artwork until you like it, put your username on
 * it, and add it to the stack (or replace yours with a remix later). The
 * ticket is shown on the card itself, cut in by the laser.
 */
export function TicketMaker({ onOpen, laser, dark, onArt, onSaved }: Props) {
  const [open, setOpen] = useState(false);
  const [mine, setMine] = useState<Ticket | null>(null);
  const mineRef = useRef<Ticket | null>(null);
  const [draft, setDraft] = useState<TicketDraft>(() => randomDraft(''));
  const [busy, setBusy] = useState<'drawing' | 'saving' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const artRef = useRef<DrawnTicket | null>(null);
  const drawJob = useRef(0);
  /** the number this ticket shows: yours, or the one it's about to get */
  const numberRef = useRef<number | undefined>(undefined);

  // a browser that already made one starts from it
  useEffect(() => {
    if (!CAN_MAKE_TICKETS) return;
    let live = true;
    myTicket().then((t) => {
      if (!live || !t) return;
      setMine(t);
      mineRef.current = t;
      numberRef.current = t.number;
      setDraft({ username: t.username, engine: t.engine, seed: t.seed, layers: t.layers });
    });
    return () => {
      live = false;
    };
  }, []);

  const draw = (d: TicketDraft, etch: boolean) => {
    const job = ++drawJob.current;
    setBusy('drawing');
    setError(null);
    // a frame first, so "Drawing…" shows before the engine takes the thread
    requestAnimationFrame(() => {
      (numberRef.current !== undefined ? Promise.resolve(numberRef.current) : nextTicketNumber())
        .then((n) => {
          numberRef.current = mineRef.current?.number ?? n;
          return drawTicket(d, numberRef.current);
        })
        .then((drawn) => {
          if (job !== drawJob.current) return;
          artRef.current = drawn;
          onArt(drawn, etch);
        })
        .catch((err) => job === drawJob.current && setError(String(err?.message ?? err)))
        .finally(() => job === drawJob.current && setBusy(null));
    });
  };

  /** a new artwork is cut fresh; a new username is only relettered */
  const change = (d: TicketDraft) => {
    const etch = d.seed !== draft.seed || d.engine !== draft.engine || d.layers !== draft.layers;
    setDraft(d);
    draw(d, etch);
  };

  const toggle = () => {
    if (!open) draw(draft, true);
    onOpen(!open);
    setOpen(!open);
  };

  const save = async () => {
    if (!artRef.current || !draft.username) return;
    setBusy('saving');
    setError(null);
    try {
      const t = await saveTicket(draft, artRef.current);
      setMine(t);
      mineRef.current = t;
      numberRef.current = t.number;
      setOpen(false);
      onOpen(false);
      onSaved(t);
    } catch (err) {
      setError(String((err as Error)?.message ?? err));
    } finally {
      setBusy(null);
    }
  };

  if (!CAN_MAKE_TICKETS) return null;
  const unchanged = !!mine && mine.username === draft.username && mine.seed === draft.seed && mine.engine === draft.engine && mine.layers === draft.layers;
  const canPrint = busy === null && draft.username.length >= 2 && !!artRef.current && !unchanged;
  const remix = () => busy === null && change(randomDraft(draft.username));
  const ink = dark ? '#e8e6e1' : '#1a1a1a';

  if (!open) {
    return (
      <button type="button" style={{ ...CALL_STYLE, color: ink }} onClick={toggle}>
        {mine ? `@${mine.username} #${pad(mine.number)} — remix yours →` : 'Make your ticket →'}
      </button>
    );
  }

  // the laser's passes: each engine layer by name, then the lettering
  const names = [...(artRef.current?.composition ?? []).map((l) => String((l as { gen?: string }).gen ?? 'layer')), 'lettering'];
  const status = busy === 'drawing'
    ? 'Drawing'
    : busy === 'saving'
      ? 'Printing to the stack'
      : laser
        ? `Pass ${laser.pass + 1}/${laser.passes} · ${names[laser.pass] ?? ''}`
        : 'Ready';

  return (
    <>
      <div style={{ ...READOUT_STYLE, color: ink }} aria-live="polite">
        <div>Ticket #{pad(numberRef.current)}</div>
        <div>{status}</div>
        <div style={{ opacity: laser ? 1 : 0.35 }}>{bar(laser?.progress ?? (busy ? 0 : 1))}</div>
        <div style={{ opacity: laser ? 1 : 0.35 }}>
          X {(laser?.u ?? 0).toFixed(3)} Y {(1 - (laser?.v ?? 1)).toFixed(3)}
        </div>
        <div>
          <span style={{ ...LAMP_STYLE, background: laser?.firing ? LASER : 'transparent', borderColor: laser?.firing ? LASER : ink }} />
          {laser ? (laser.firing ? 'Firing' : 'Moving') : 'Idle'}
        </div>
      </div>
      <div style={{ ...CONSOLE_STYLE, color: ink }}>
        <label style={NAME_STYLE}>
          <span style={{ opacity: draft.username ? 1 : 0.35 }}>@</span>
          <input
            autoFocus
            value={draft.username}
            maxLength={USERNAME_MAX}
            placeholder="username"
            aria-label="Username"
            spellCheck={false}
            autoComplete="off"
            size={Math.max(8, draft.username.length + 1)}
            onChange={(e) => change({ ...draft, username: cleanUsername(e.target.value) })}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === ' ') {
                e.preventDefault();
                remix();
              } else if (e.key === 'Enter') {
                e.preventDefault();
                if (canPrint) save();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                toggle();
              }
            }}
            style={{ ...INPUT_STYLE, color: ink }}
          />
        </label>
        <div style={KEYS_STYLE}>
          <button type="button" style={{ ...KEY_STYLE, color: ink }} disabled={busy !== null} onClick={remix}>
            [Space] Remix
          </button>
          <button type="button" style={{ ...KEY_STYLE, color: ink, opacity: canPrint ? 1 : 0.35 }} disabled={!canPrint} onClick={save}>
            [↵] {mine ? 'Reprint yours' : 'Print to the stack'}
          </button>
          <button type="button" style={{ ...KEY_STYLE, color: ink }} onClick={toggle}>
            [Esc] Cancel
          </button>
        </div>
        {error && <div style={ERROR_STYLE}>{error}</div>}
      </div>
    </>
  );
}

/** a ticket's number as it's lettered */
const pad = (n?: number) => (n ? String(n).padStart(4, '0') : '----');

/** progress as a row of cells, like the machine's own display */
const bar = (p: number) => {
  const n = 20;
  const filled = Math.round(Math.min(1, Math.max(0, p)) * n);
  return `${'█'.repeat(filled)}${'░'.repeat(n - filled)} ${String(Math.round(p * 100)).padStart(3, ' ')}%`;
};

/** the laser's colour: the firing lamp */
const LASER = '#ff6a2b';
const MONO = "'Geist Mono', ui-monospace, monospace";
const PIXEL = "'Geist Pixel Square', ui-monospace, monospace";

const CALL_STYLE: React.CSSProperties = {
  position: 'fixed',
  left: '50%',
  bottom: 28,
  transform: 'translateX(-50%)',
  zIndex: 10,
  padding: '6px 4px',
  border: 'none',
  background: 'none',
  font: `20px/1 ${PIXEL}`,
  letterSpacing: '0.02em',
  cursor: 'pointer',
};

const READOUT_STYLE: React.CSSProperties = {
  position: 'fixed',
  left: 24,
  top: 24,
  zIndex: 10,
  display: 'grid',
  gap: 6,
  font: `11px/1.2 ${MONO}`,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  whiteSpace: 'pre',
  pointerEvents: 'none',
  fontVariantNumeric: 'tabular-nums',
};

const LAMP_STYLE: React.CSSProperties = {
  display: 'inline-block',
  width: 7,
  height: 7,
  marginRight: 8,
  border: '1px solid',
  verticalAlign: 'baseline',
};

const CONSOLE_STYLE: React.CSSProperties = {
  position: 'fixed',
  left: '50%',
  bottom: 28,
  transform: 'translateX(-50%)',
  zIndex: 10,
  display: 'grid',
  justifyItems: 'center',
  gap: 14,
};

const NAME_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  font: `44px/1 ${PIXEL}`,
};

const INPUT_STYLE: React.CSSProperties = {
  border: 'none',
  borderBottom: '2px solid currentColor',
  background: 'none',
  outline: 'none',
  padding: '0 0 6px',
  font: 'inherit',
  caretColor: LASER,
};

const KEYS_STYLE: React.CSSProperties = {
  display: 'flex',
  gap: 24,
};

const KEY_STYLE: React.CSSProperties = {
  border: 'none',
  background: 'none',
  padding: 0,
  font: `11px/1 ${MONO}`,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  cursor: 'pointer',
};

const ERROR_STYLE: React.CSSProperties = {
  font: `11px/1.4 ${MONO}`,
  color: LASER,
  maxWidth: 420,
  textAlign: 'center',
};
