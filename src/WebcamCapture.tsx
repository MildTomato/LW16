import { useEffect, useRef, useState } from 'react';

interface Props {
  dark: boolean;
  /** the photo, as a JPEG data URL */
  onTake: (photo: string) => void;
  onCancel: () => void;
}

/**
 * The webcam, to take the photo that's etched into the ticket: a mirror of
 * yourself, square like the card, and a button to take it (or a photo
 * uploaded instead). The camera's on only while this is open.
 */
export function WebcamCapture({ dark, onTake, onCancel }: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);

  // the camera is an external resource that lives exactly as long as this does
  useEffect(() => {
    let stream: MediaStream | null = null;
    let gone = false;
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 1280 } }, audio: false })
      .then((s) => {
        if (gone) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        const v = video.current;
        if (!v) return;
        v.srcObject = s;
        return v.play().then(() => setLive(true));
      })
      .catch((err: Error) => setError(err.name === 'NotAllowedError' ? 'Camera access was blocked. Allow it in your browser to take a photo.' : "Couldn't start the camera."));
    if (!navigator.mediaDevices) setError("This browser can't use a camera here.");
    return () => {
      gone = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  /** the middle square of the frame, as you see it (mirrored) */
  const take = () => {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const side = Math.min(v.videoWidth, v.videoHeight);
    const out = 1000;
    const c = document.createElement('canvas');
    c.width = c.height = out;
    const g = c.getContext('2d')!;
    g.translate(out, 0);
    g.scale(-1, 1);
    g.drawImage(v, (v.videoWidth - side) / 2, (v.videoHeight - side) / 2, side, side, 0, 0, out, out);
    onTake(c.toDataURL('image/jpeg', 0.9));
  };

  /** a photo from the device instead: the middle square of it */
  const upload = (file: File | undefined) => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const side = Math.min(img.width, img.height);
      const out = 1000;
      const c = document.createElement('canvas');
      c.width = c.height = out;
      c.getContext('2d')!.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, out, out);
      URL.revokeObjectURL(url);
      onTake(c.toDataURL('image/jpeg', 0.9));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      setError("That file isn't an image we can read.");
    };
    img.src = url;
  };

  const ink = dark ? '#e8e6e1' : '#1a1a1a';
  const paper = dark ? '#000805' : '#f3f2ed';
  return (
    <div
      role="dialog"
      aria-label="Take a photo"
      style={{ ...BACKDROP, background: dark ? 'rgba(0, 8, 5, 0.72)' : 'rgba(243, 242, 237, 0.72)' }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') onCancel();
      }}
    >
      <div style={{ ...PANEL, background: paper, color: ink, borderColor: ink }}>
        <div style={FRAME}>
          <video ref={video} playsInline muted style={{ ...VIDEO, opacity: live ? 1 : 0 }} />
          {!live && <div style={NOTE}>{error ?? 'Starting the camera…'}</div>}
        </div>
        <div style={ROW}>
          <label className="pill" style={{ ...PILL, marginRight: 'auto', '--ink': ink, '--paper': paper } as React.CSSProperties}>
            Upload a photo
            <input type="file" accept="image/*" hidden onChange={(e) => upload(e.target.files?.[0])} />
          </label>
          <button type="button" className="pill" style={{ ...PILL, '--ink': ink, '--paper': paper } as React.CSSProperties} onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="pill primary"
            style={{ ...PILL, '--ink': ink, '--paper': paper } as React.CSSProperties}
            disabled={!live}
            onClick={take}
            autoFocus
          >
            Take photo
          </button>
        </div>
      </div>
    </div>
  );
}

const MONO = "'Geist Mono', ui-monospace, monospace";
const BACKDROP: React.CSSProperties = { position: 'fixed', inset: 0, zIndex: 30, display: 'grid', placeItems: 'center', backdropFilter: 'blur(6px)' };
const PANEL: React.CSSProperties = { display: 'grid', gap: 14, padding: 16, border: '1px solid', borderRadius: 12, width: 'min(420px, 90vw)' };
const FRAME: React.CSSProperties = { position: 'relative', aspectRatio: '1', overflow: 'hidden', borderRadius: 6, background: '#000' };
// mirrored, as people expect to see themselves
const VIDEO: React.CSSProperties = { width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)', transition: 'opacity 0.3s' };
const NOTE: React.CSSProperties = { position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', padding: 24, textAlign: 'center', font: `12px/1.5 ${MONO}`, color: '#e8e6e1' };
const ROW: React.CSSProperties = { display: 'flex', justifyContent: 'flex-end', gap: 8 };
const PILL: React.CSSProperties = {
  padding: '9px 16px',
  border: '1px solid var(--ink)',
  borderRadius: 999,
  font: `11px/1 ${MONO}`,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  cursor: 'pointer',
};
