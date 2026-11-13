import { useEffect, useRef, useState } from 'react';
import {
  CAN_MAKE_TICKETS,
  USERNAME_MAX,
  cleanUsername,
  designDraft,
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
import { logIn, onAccount, takePending, type Account } from './account.ts';
import { ENGINE_SYSTEMS, randomDesignLayer, randomSeed, type DesignLayer } from './engineArt.ts';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { GripVertical, Plus, Shuffle, X } from 'lucide-react';

/** the most layers a design can have */
const MAX_LAYERS = 6;

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
  /** the layer being dragged, and the row it's over */
  const [dragging, setDragging] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const artRef = useRef<DrawnTicket | null>(null);
  const drawJob = useRef(0);
  /** a new artwork is waiting to be cut: a draw that replaces its draw (typing straight away) cuts it */
  const etchPending = useRef(false);
  /** the number this ticket shows: yours, or the one it's about to get */
  const numberRef = useRef<number | undefined>(undefined);

  /** who's logged in (undefined until known) */
  const [account, setAccount] = useState<Account | null | undefined>(undefined);

  // follow the login: someone logged in starts from their ticket, if they've made one;
  // someone back from logging in carries on with the ticket they were making
  useEffect(() => {
    if (!CAN_MAKE_TICKETS) return;
    let live = true;
    let lastId: string | null | undefined;
    const pending = takePending<TicketDraft>();
    if (pending) {
      setDraft(pending);
      draw(pending, true);
      onOpen(true);
      setOpen(true);
    }
    const stop = onAccount((a) => {
      if (!live) return;
      setAccount(a);
      if (a?.id === lastId) return;
      lastId = a?.id ?? null;
      if (!a) {
        setMine(null);
        mineRef.current = null;
        return;
      }
      myTicket().then((t) => {
        if (!live) return;
        setMine(t);
        mineRef.current = t;
        if (!t) {
          if (a.suggested) setDraft((d) => (d.username ? d : { ...d, username: a.suggested }));
          return;
        }
        numberRef.current = t.number;
        if (!pending) setDraft({ username: t.username, engine: t.engine, seed: t.seed, layers: t.layers });
      });
    });
    return () => {
      live = false;
      stop();
    };
  }, []);

  const draw = (d: TicketDraft, etch: boolean) => {
    const job = ++drawJob.current;
    if (etch) etchPending.current = true;
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
          const cut = etchPending.current;
          etchPending.current = false;
          onArt(drawn, cut);
        })
        .catch((err) => job === drawJob.current && setError(String(err?.message ?? err)))
        .finally(() => job === drawJob.current && setBusy(null));
    });
  };

  /** a new artwork is cut fresh; a new username is only relettered */
  const change = (d: TicketDraft) => {
    const etch =
      d.seed !== draft.seed || d.engine !== draft.engine || d.layers !== draft.layers || JSON.stringify(d.design) !== JSON.stringify(draft.design);
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
    if (!account) return logIn(draft);
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
  const unchanged =
    !!mine && mine.username === draft.username && mine.seed === draft.seed && mine.engine === draft.engine && mine.layers === draft.layers && !draft.design;
  const canPrint = busy === null && account !== undefined && draft.username.length >= 2 && !!artRef.current && !unchanged;
  const remix = () => busy === null && change(randomDraft(draft.username));
  // the design, layer by layer: an older ticket without one is shown as a fresh random design to start from
  const design: DesignLayer[] = draft.design ?? [];
  const setDesign = (next: DesignLayer[]) => change(designDraft(draft.username, next));
  const setLayer = (i: number, layer: DesignLayer) => setDesign(design.map((l, k) => (k === i ? layer : l)));
  /** a layer dragged from one place in the list to another (the first is the bottom of the stack) */
  const moveLayer = (from: number, to: number) => {
    if (from === to) return;
    const next = [...design];
    const [layer] = next.splice(from, 1);
    next.splice(to, 0, layer);
    setDesign(next);
  };
  const ink = dark ? '#e8e6e1' : '#1a1a1a';
  /** the buttons' colours: the page's ink, and a fill a shade off the page */
  const pill = { '--ink': ink, '--paper': dark ? '#17201c' : '#f6f4f0' } as React.CSSProperties;

  if (!open) {
    return (
      <button
        type="button"
        className="pill"
        style={{ ...CALL_STYLE, ...PILL_STYLE, ...pill }}
        onClick={toggle}
      >
        {mine ? `@${mine.username} #${pad(mine.number)} — remix yours →` : 'Make your ticket →'}
      </button>
    );
  }

  // the laser's passes: the number and name first, then each engine layer by name
  const names = [
    'number',
    'username',
    ...(artRef.current?.design?.map((d) => d.system) ??
      (artRef.current?.composition ?? []).map((l) => String((l as { gen?: string }).gen ?? 'layer'))),
  ];
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
          <button type="button" className="pill" style={{ ...PILL_STYLE, ...pill }} onClick={toggle}>
            Cancel <span style={KEY_HINT_STYLE}>Esc</span>
          </button>
          <button type="button" className="pill" style={{ ...PILL_STYLE, ...pill }} disabled={busy !== null} onClick={remix}>
            Remix <span style={KEY_HINT_STYLE}>Space</span>
          </button>
          <button type="button" className="pill primary" style={{ ...PILL_STYLE, ...pill }} disabled={!canPrint} onClick={save}>
            {!account ? 'Log in with Supabase to print' : mine ? 'Reprint yours' : 'Print to the stack'} <span style={KEY_HINT_STYLE}>↵</span>
          </button>
        </div>
        {error && <div style={ERROR_STYLE}>{error}</div>}
      </div>
      <div className={dark ? 'dark' : ''} style={{ ...LAYERS_STYLE, color: ink }} role="group" aria-label="Layers">
        <div style={LAYERS_HEAD_STYLE}>
          <span>Layers</span>
          <span style={{ opacity: 0.45 }}>
            {design.length}/{MAX_LAYERS}
          </span>
        </div>
        {design.map((layer, i) => (
          <div
            key={`${layer.system}-${layer.seed}-${i}`}
            draggable
            onDragStart={(e) => {
              setDragging(i);
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', String(i));
            }}
            onDragOver={(e) => {
              if (dragging === null) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              if (dragOver !== i) setDragOver(i);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragging !== null) moveLayer(dragging, i);
              setDragging(null);
              setDragOver(null);
            }}
            onDragEnd={() => {
              setDragging(null);
              setDragOver(null);
            }}
            style={{
              ...LAYER_ROW_STYLE,
              opacity: dragging === i ? 0.4 : 1,
              boxShadow: dragOver === i && dragging !== null && dragging !== i ? `0 ${dragging < i ? 1 : -1}px 0 0 ${ink}` : 'none',
            }}
          >
            <GripVertical aria-hidden size={14} style={GRIP_STYLE} />
            <span style={{ opacity: 0.45, fontVariantNumeric: 'tabular-nums' }}>{String(i + 1).padStart(2, '0')}</span>
            <Select value={layer.system} onValueChange={(system) => setLayer(i, { system, seed: layer.seed })}>
              <SelectTrigger size="sm" aria-label={`Layer ${i + 1} system`} className={`w-full min-w-0 ${dark ? 'dark' : ''}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" className={dark ? 'dark' : ''}>
                {Object.keys(ENGINE_SYSTEMS).map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="icon-sm"
              className="rounded-full border-foreground bg-transparent shadow-none"
              title="Randomise this layer"
              aria-label={`Randomise layer ${i + 1}`}
              onClick={() => setLayer(i, { system: layer.system, seed: randomSeed() })}
            >
              <Shuffle />
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              className="rounded-full border-foreground bg-transparent shadow-none"
              title="Remove this layer"
              aria-label={`Remove layer ${i + 1}`}
              disabled={design.length <= 1}
              onClick={() => setDesign(design.filter((_, k) => k !== i))}
            >
              <X />
            </Button>
          </div>
        ))}
        <Button
          variant="outline"
          size="sm"
          className="justify-self-start rounded-full border-foreground bg-transparent font-mono text-[11px] tracking-[0.06em] uppercase shadow-none"
          disabled={design.length >= MAX_LAYERS}
          onClick={() => setDesign([...design, randomDesignLayer()])}
        >
          <Plus /> Add layer
        </Button>
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
};

/** a rounded button in the console's type (its colours and states are the .pill class's) */
const PILL_STYLE: React.CSSProperties = {
  padding: '9px 16px',
  border: '1px solid var(--ink)',
  borderRadius: 999,
  font: `11px/1 ${MONO}`,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  whiteSpace: 'nowrap',
  cursor: 'pointer',
};

/** the design's layers: a list to the right, under the monitor */
const LAYERS_STYLE: React.CSSProperties = {
  position: 'fixed',
  right: 32,
  bottom: 84,
  zIndex: 10,
  display: 'grid',
  gap: 8,
  width: 300,
  font: `11px/1 ${MONO}`,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
};

const LAYERS_HEAD_STYLE: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  paddingBottom: 6,
  borderBottom: '1px solid currentColor',
};

const LAYER_ROW_STYLE: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '14px 22px 1fr auto auto',
  alignItems: 'center',
  gap: 6,
};

/** the handle a layer's dragged by */
const GRIP_STYLE: React.CSSProperties = {
  cursor: 'grab',
  opacity: 0.45,
};

/** a button's key, quieter beside its name */
const KEY_HINT_STYLE: React.CSSProperties = {
  marginLeft: 6,
  opacity: 0.45,
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
  gap: 8,
};

const ERROR_STYLE: React.CSSProperties = {
  font: `11px/1.4 ${MONO}`,
  color: LASER,
  maxWidth: 420,
  textAlign: 'center',
};
