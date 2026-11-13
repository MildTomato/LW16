import { useEffect, useRef, useState } from 'react';
import {
  CAN_MAKE_TICKETS,
  PHOTO_LAYER,
  designDraft,
  drawTicket,
  myTicket,
  nextTicketNumber,
  randomDraft,
  saveTicket,
  type DrawnTicket,
  type Ticket,
  type TicketDraft,
  type TicketSticker,
} from './tickets.ts';
import type { LaserStatus } from './scene.ts';
import { logIn, onAccount, takePending, type Account } from './account.ts';
import { DESIGN_SYSTEMS, randomDesignLayer, randomSeed, type DesignLayer } from './engineArt.ts';
import { WebcamCapture } from './WebcamCapture.tsx';
import { TICKET_STICKERS } from './stickers.ts';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Camera, Plus, Shuffle, X } from 'lucide-react';

/** how a new drawing reaches the card: cut in fresh, or only relettered */
export type ArtChange = 'etch' | 'retitle';
const RANK: Record<ArtChange, number> = { retitle: 0, etch: 1 };

/** a design has one to six layers */
const MAX_LAYERS = 6;

/** what the artwork is drawn from: a change to it means a new burn */
const artKey = (d: TicketDraft) => JSON.stringify([d.engine, d.seed, d.layers, d.design ?? null, d.photo?.length ?? 0, d.photo?.slice(-64) ?? '']);

interface Props {
  /** making started or stopped: the card is the ticket meanwhile */
  onOpen: (open: boolean) => void;
  /** the laser cutting it, as the scene reports it */
  laser: LaserStatus | null;
  /** the room is dark: the console's type goes light */
  dark: boolean;
  /** a drawn ticket for the card: a new artwork is cut in by the laser, a new username just relettered */
  onArt: (drawn: DrawnTicket, how: ArtChange) => void;
  onSaved: (t: Ticket) => void;
  /** a sticker picked up from the tray: carried until it's dropped on the card (or thrown away) */
  onSticker: (img: HTMLImageElement, e: React.PointerEvent) => void;
  /** the stickers on the card now, to save with it */
  stickers: () => TicketSticker[];
  /** put a saved ticket's stickers back on the card, to remix it */
  onPlaceStickers: (list: TicketSticker[]) => void;
}

/**
 * Make your ticket: remix the artwork until you like it, put your username on
 * it, and add it to the stack (or replace yours with a remix later). The
 * ticket is shown on the card itself, cut in by the laser.
 */
export function TicketMaker({ onOpen, laser, dark, onArt, onSaved, onSticker, stickers, onPlaceStickers }: Props) {
  const [open, setOpen] = useState(false);
  const [mine, setMine] = useState<Ticket | null>(null);
  const mineRef = useRef<Ticket | null>(null);
  const [draft, setDraft] = useState<TicketDraft>(() => randomDraft(''));
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const [busy, setBusy] = useState<'drawing' | 'saving' | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** the webcam's open, to take the photo layer */
  const [shooting, setShooting] = useState(false);
  /**
   * Two stages: design (the layers, seen isometric, picked, added and
   * removed), then burn (the plate comes in and the laser burns the design
   * on, once; then stickers, then done).
   */
  const [phase, setPhase] = useState<'design' | 'burn'>('design');
  /** each layer's linework on its own, for the stack of layers; and the one being pointed at */
  const [layerUrls, setLayerUrls] = useState<string[]>([]);
  const [hoverLayer, setHoverLayer] = useState<number | null>(null);
  const artRef = useRef<DrawnTicket | null>(null);
  const drawJob = useRef(0);
  /** the biggest change waiting to reach the card: a draw that replaces its draw (typing straight away) still makes it */
  const pending = useRef<ArtChange | null>(null);
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
    const back = takePending<(TicketDraft & { stickers?: TicketSticker[] }) | { start: true }>();
    // back from logging in to start making one: straight into the design
    if (back && 'start' in back) {
      setOpen(true);
      draw(draftRef.current, null);
    }
    const resumed = back && !('start' in back) ? { ...back, stickers: undefined } : null;
    if (back && !('start' in back) && resumed) {
      // back from logging in: straight to the burned card, stickers and all, to finish
      setDraft(resumed);
      setPhase('burn');
      setOpen(true);
      onOpen(true);
      draw(resumed, 'etch');
      if ('stickers' in back && back.stickers?.length) onPlaceStickers(back.stickers);
    }
    const stop = onAccount((a) => {
      if (!live) return;
      setAccount(a);
      // the name on the ticket is the account's: it isn't picked
      setDraft((d) => ({ ...d, username: a?.suggested || (a ? `user_${a.id.slice(0, 6)}` : '') }));
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
        if (!t) return;
        numberRef.current = t.number;
        if (!resumed) setDraft((d) => ({ ...d, engine: t.engine, seed: t.seed, layers: t.layers }));
      });
    });
    return () => {
      live = false;
      stop();
    };
  }, []);

  /** the artwork the card was last burned with (null: not burned yet) */
  const burned = useRef<string | null>(null);

  /** draw the ticket; and cut it into the card (etch), reletter it, or (null) only show its layers */
  const draw = (d: TicketDraft, how: ArtChange | null) => {
    const job = ++drawJob.current;
    if (how && (!pending.current || RANK[how] > RANK[pending.current])) pending.current = how;
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
          setLayerUrls(drawn.layerInks.map((img) => img.src));
          const how = pending.current;
          pending.current = null;
          if (!how) return;
          if (how === 'etch') burned.current = artKey(d);
          onArt(drawn, how);
        })
        .catch((err) => job === drawJob.current && setError(String(err?.message ?? err)))
        .finally(() => job === drawJob.current && setBusy(null));
    });
  };

  /**
   * Designing, only the layers are shown; once it's burned, a new username
   * is relettered (the design itself can only change back in design).
   */
  const change = (d: TicketDraft) => {
    setDraft(d);
    draw(d, phase === 'burn' && burned.current ? 'retitle' : null);
  };

  /** the design's confirmed: the plate comes in, and the laser burns it on */
  const confirm = () => {
    setPhase('burn');
    onOpen(true);
    draw(draft, 'etch');
    // remixing yours: its stickers go back on
    if (mineRef.current?.stickers?.length && !stickers().length) onPlaceStickers(mineRef.current.stickers);
  };

  /** back to the design: the plate goes, and the design's burned again when it's confirmed */
  const backToDesign = () => {
    setPhase('design');
    burned.current = null;
    onOpen(false);
  };

  const toggle = () => {
    // the ticket's in your name: log in first, then make it
    if (!open && account === null) return logIn({ start: true });
    if (!open) {
      setPhase('design');
      burned.current = null;
      // an older ticket (or none) without a design starts from a fresh one
      if (!draft.design?.length) {
        const fresh = randomDraft(draft.username);
        setDraft(fresh);
        draw(fresh, null);
      } else draw(draft, null);
    } else if (phase === 'burn') onOpen(false);
    setOpen(!open);
  };

  const save = async () => {
    if (!artRef.current || !draft.username) return;
    // off to log in: the stickers come back with the draft
    if (!account) return logIn({ ...draft, stickers: stickers() });
    setBusy('saving');
    setError(null);
    try {
      const t = await saveTicket(draft, artRef.current, stickers());
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

  // the keys: Esc puts it away, Space remixes the design, Enter burns it (designing) or finishes it (burned)
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e) => {
    if ((e.target as HTMLElement | null)?.closest?.('input, textarea, [role=listbox], [role=dialog]')) return;
    if (e.key === 'Escape') toggle();
    else if (e.key === ' ' && phase === 'design') remix();
    else if (e.key === 'Enter') {
      if (phase === 'design') confirm();
      else if (canPrint && !laser) save();
    } else return;
    e.preventDefault();
  };
  // a window listener for exactly as long as the maker's open
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!CAN_MAKE_TICKETS) return null;
  const unchanged =
    !!mine && mine.username === draft.username && mine.seed === draft.seed && mine.engine === draft.engine && mine.layers === draft.layers && !draft.design;
  const canPrint = busy === null && account !== undefined && draft.username.length >= 2 && !!artRef.current && !unchanged;
  const design: DesignLayer[] = draft.design ?? [];
  const keep = { photo: draft.photo };
  const setDesign = (next: DesignLayer[]) => change(designDraft(draft.username, next, keep));
  const setLayer = (i: number, layer: DesignLayer) => setDesign(design.map((l, k) => (k === i ? layer : l)));
  // remix: every layer but the photo gets a new system and seed
  const remix = () =>
    busy === null && setDesign(design.map((l) => (l.system === PHOTO_LAYER ? l : randomDesignLayer())));
  const hasPhoto = design.some((l) => l.system === PHOTO_LAYER);
  /** the photo's taken: it's a layer of its own, at the bottom (or it replaces the one there was) */
  const usePhoto = (photo: string) => {
    setShooting(false);
    const next = hasPhoto ? design : [{ system: PHOTO_LAYER, seed: 1 }, ...design].slice(0, MAX_LAYERS);
    change(designDraft(draft.username, next, { photo }));
  };
  const addLayer = () => design.length < MAX_LAYERS && setDesign([...design, randomDesignLayer()]);
  const removeLayer = (i: number) => {
    if (design.length <= 1) return;
    const gone = design[i].system === PHOTO_LAYER;
    change(designDraft(draft.username, design.filter((_, k) => k !== i), gone ? {} : keep));
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
        <div style={NAME_STYLE} aria-label="Your name on the ticket">
          <span style={{ opacity: 0.35 }}>@</span>
          {draft.username || '…'}
        </div>
        <div style={KEYS_STYLE}>
          <button type="button" className="pill" style={{ ...PILL_STYLE, ...pill }} onClick={toggle}>
            Cancel <span style={KEY_HINT_STYLE}>Esc</span>
          </button>
          {phase === 'design' ? (
            <>
              <button type="button" className="pill" style={{ ...PILL_STYLE, ...pill }} disabled={busy !== null} onClick={remix}>
                Remix <span style={KEY_HINT_STYLE}>Space</span>
              </button>
              <button type="button" className="pill primary" style={{ ...PILL_STYLE, ...pill }} disabled={busy !== null || !artRef.current} onClick={confirm}>
                Burn it →
              </button>
            </>
          ) : (
            <>
              <button type="button" className="pill" style={{ ...PILL_STYLE, ...pill }} onClick={backToDesign}>
                ← Design
              </button>
              <button type="button" className="pill primary" style={{ ...PILL_STYLE, ...pill }} disabled={!canPrint || !!laser} onClick={save}>
                {!account ? 'Log in with Supabase to finish' : 'Done'} <span style={KEY_HINT_STYLE}>↵</span>
              </button>
            </>
          )}
        </div>
        {error && <div style={ERROR_STYLE}>{error}</div>}
      </div>
      <div
        className={dark ? 'dark' : ''}
        style={{ ...LAYERS_STYLE, color: ink, background: dark ? 'rgba(0, 8, 5, 0.9)' : 'rgba(243, 242, 237, 0.92)' }}
        role="group"
        aria-label="Your card"
      >
        {phase === 'design' ? (
          <>
            <div style={LAYERS_HEAD_STYLE}>
              <span>1 · Design</span>
              <span style={{ opacity: 0.45 }}>
                {design.length}/{MAX_LAYERS} layers
              </span>
            </div>
            {[...design].map((layer, i) => (
              <div
                key={i}
                style={LAYER_ROW_STYLE}
                onPointerEnter={() => setHoverLayer(i)}
                onPointerLeave={() => setHoverLayer(null)}
              >
                <span style={{ opacity: 0.45, fontVariantNumeric: 'tabular-nums' }}>{String(i + 1).padStart(2, '0')}</span>
                {layer.system === PHOTO_LAYER ? (
                  <button type="button" style={PHOTO_ROW_STYLE} onClick={() => setShooting(true)} title="Retake">
                    {draft.photo && <img src={draft.photo} alt="" style={PHOTO_THUMB_STYLE} />} Photo · retake
                  </button>
                ) : (
                  <Select
                    value={layer.system}
                    onValueChange={(system) => setLayer(i, { system, seed: layer.system === system ? layer.seed : randomSeed() })}
                  >
                    <SelectTrigger size="sm" aria-label={`Layer ${i + 1}`} className={`w-full min-w-0 ${dark ? 'dark' : ''}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent position="popper" className={dark ? 'dark' : ''}>
                      {DESIGN_SYSTEMS.map((name) => (
                        <SelectItem key={name} value={name}>
                          {name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <Button
                  variant="outline"
                  size="icon-sm"
                  className="rounded-full border-foreground bg-transparent shadow-none"
                  title="Another take on this layer"
                  aria-label={`Shuffle layer ${i + 1}`}
                  disabled={layer.system === PHOTO_LAYER}
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
                  onClick={() => removeLayer(i)}
                >
                  <X />
                </Button>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 6 }}>
              <Button
                variant="outline"
                size="sm"
                className="rounded-full border-foreground bg-transparent font-mono text-[11px] tracking-[0.06em] uppercase shadow-none"
                disabled={design.length >= MAX_LAYERS}
                onClick={addLayer}
              >
                <Plus /> Add layer
              </Button>
              {!hasPhoto && (
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-full border-foreground bg-transparent font-mono text-[11px] tracking-[0.06em] uppercase shadow-none"
                  disabled={design.length >= MAX_LAYERS}
                  onClick={() => setShooting(true)}
                >
                  <Camera /> Photo layer
                </Button>
              )}
            </div>
          </>
        ) : (
          <>
            <div style={LAYERS_HEAD_STYLE}>
              <span>2 · Stickers</span>
              <span style={{ opacity: 0.45 }}>{laser ? 'burning…' : 'burned'}</span>
            </div>
            <p style={HINT_STYLE}>Drag stickers onto the card. Drag one off to remove it. Then press Done.</p>
            <div style={STICKER_TRAY_STYLE}>
              {TICKET_STICKERS.map((s) => (
                <img
                  key={s.id}
                  src={s.url}
                  alt={s.id}
                  title={s.id}
                  draggable={false}
                  style={STICKER_STYLE}
                  onPointerDown={(e) => {
                    if (e.button !== 0) return;
                    e.preventDefault();
                    onSticker(e.currentTarget, e);
                  }}
                />
              ))}
            </div>
          </>
        )}
      </div>
      {phase === 'design' && (
        <div style={{ ...DESIGN_STAGE_STYLE, background: dark ? '#000805' : '#f3f2ed', color: ink }}>
          <LayerStack
            urls={layerUrls}
            names={design.map((l) => l.system)}
            active={hoverLayer}
            dark={dark}
            ink={ink}
            size={360}
          />
          <div style={DESIGN_CAPTION_STYLE}>
            {busy === 'drawing' ? 'Drawing…' : 'Your artwork, layer by layer. Burn it when it’s right.'}
          </div>
        </div>
      )}
      {shooting && <WebcamCapture dark={dark} onTake={usePhoto} onCancel={() => setShooting(false)} />}
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
  zIndex: 12,
  display: 'grid',
  gap: 8,
  width: 340,
  // a sheet of its own, so it reads over the engraver's screen
  padding: 14,
  borderRadius: 12,
  backdropFilter: 'blur(8px)',
  boxShadow: '0 1px 0 rgba(0, 0, 0, 0.04), 0 8px 24px rgba(0, 0, 0, 0.08)',
  font: `11px/1 ${MONO}`,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
};

const HINT_STYLE: React.CSSProperties = { margin: 0, textTransform: 'none', letterSpacing: 0, lineHeight: 1.5, opacity: 0.7 };
const PHOTO_ROW_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  height: 28,
  padding: '0 8px',
  border: '1px solid currentColor',
  borderRadius: 999,
  background: 'none',
  color: 'inherit',
  font: 'inherit',
  letterSpacing: 'inherit',
  textTransform: 'inherit',
  cursor: 'pointer',
};
const PHOTO_THUMB_STYLE: React.CSSProperties = { width: 18, height: 18, borderRadius: '50%', objectFit: 'cover', filter: 'grayscale(1)' };

/**
 * The artwork's layers, exploded: each layer's linework on its own sheet,
 * seen isometric and stacked bottom to top, so you see what each one adds.
 */
function LayerStack({
  urls,
  names,
  active,
  dark,
  ink,
  size,
}: {
  urls: string[];
  names: string[];
  active: number | null;
  dark: boolean;
  ink: string;
  /** a sheet's side, in px */
  size: number;
}) {
  return (
    <div style={{ ...STACK_BOX_STYLE, height: size * 1.7 }} aria-hidden>
      <div style={{ ...STACK_STYLE, width: size, height: size }}>
        {urls.map((url, i) => (
          <div
            key={i}
            style={{
              ...SHEET_STYLE,
              // spread apart, closer as there are more of them, so six still fit
              transform: `translateZ(${(i - (urls.length - 1) / 2) * Math.min(size * 0.32, (size * 1.1) / Math.max(1, urls.length - 1))}px)`,
              borderColor: active === i ? ink : dark ? 'rgba(237,237,234,0.25)' : 'rgba(22,22,22,0.2)',
              background: `${dark ? 'rgba(20, 30, 26, 0.55)' : 'rgba(241, 242, 244, 0.6)'} url("${url}") center / contain no-repeat`,
              opacity: active === null || active === i ? 1 : 0.35,
            }}
          >
            <span style={{ ...SHEET_LABEL_STYLE, color: ink, fontSize: Math.max(9, size / 22) }}>
              {String(i + 1).padStart(2, '0')} {names[i] ?? ''}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** the design steps' stage: the layers, large, over the card (which isn't burned yet) */
const DESIGN_STAGE_STYLE: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 9,
  display: 'grid',
  placeItems: 'center',
  alignContent: 'center',
  gap: 8,
  paddingRight: 360,
  // clear of the name and the print buttons below
  paddingBottom: 140,
  font: `11px/1.4 ${MONO}`,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
};
const DESIGN_CAPTION_STYLE: React.CSSProperties = { opacity: 0.55, maxWidth: 420, textAlign: 'center' };

const STACK_BOX_STYLE: React.CSSProperties = { display: 'grid', placeItems: 'center', perspective: 'none', overflow: 'visible' };
const STACK_STYLE: React.CSSProperties = {
  position: 'relative',
  transformStyle: 'preserve-3d',
  // isometric: tipped back, turned a quarter of the way round
  transform: 'rotateX(58deg) rotateZ(-42deg)',
};
const SHEET_STYLE: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  border: '1px solid',
  borderRadius: 4,
  transition: 'opacity 0.2s, border-color 0.2s',
  backdropFilter: 'blur(1px)',
};
const SHEET_LABEL_STYLE: React.CSSProperties = { position: 'absolute', left: 4, top: 4, fontSize: 9, opacity: 0.6 };

/** the stickers to drag onto the card */
const STICKER_TRAY_STYLE: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(7, 1fr)',
  gap: 4,
};
const STICKER_STYLE: React.CSSProperties = {
  width: '100%',
  aspectRatio: '1',
  cursor: 'grab',
  touchAction: 'none',
  userSelect: 'none',
};

/** a light to pick: a disc of how it colours the metal */
const SWATCH_STYLE: React.CSSProperties = {
  width: 26,
  height: 26,
  borderRadius: '50%',
  border: '1px solid rgba(0, 0, 0, 0.18)',
  cursor: 'pointer',
  padding: 0,
};

const LAYERS_HEAD_STYLE: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  paddingBottom: 6,
  borderBottom: '1px solid currentColor',
};

const LAYER_ROW_STYLE: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '22px 1fr auto auto',
  alignItems: 'center',
  gap: 6,
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
