# Share cards (OG / X)

Mockups only. Nothing here is wired into the site yet.

- `site-card.html`: the site's card. It's a still of the Rolodex captured from the page itself (`/?clean`, 1200×630 at 2x, see `captures/`) with Geist Mono labels in three corners. The bottom-left corner is left clear because X puts the domain there.
- `ticket-card.html`: a shared ticket's card. It's one SVG that takes the stored linework (`tickets/*.webp`, copied from the bucket), etches it over green metal, adds the margin marks, and die-cuts the owner through the card in Geist Pixel Line (same layout as `ownerPage`). LW sits over the card's left edge and 16 tucks under its right.
- `x-preview.html`: either card in an X post at feed width.
- `render.sh`: renders everything to `out/` with Playwright's headless Chromium.

To recapture the Rolodex, open `/?clean&cam=5.946,1.216,-4.032&target=-0.054,-0.034,-0.296` (add `&theme=Dark` for dark) at a 1200×630 viewport and DPR 2. Then read the canvas back after a frame.

## Per-ticket images: the proposal

Crawlers don't run JS, so a ticket link needs its own server-rendered `<head>`.

1. **Share URL**: `/t/<username>`. A `vercel.json` rewrite sends it to `api/t.ts`, a Vercel Function. The function reads the ticket row over REST with the publishable key and returns the built `index.html` with the `og:*` / `twitter:*` tags swapped in (title "@user's Launch Week 16 ticket #0013"). The SPA still boots, so people land on the site. Opening that ticket from the path would be an `App.tsx` change, which is a follow-up.
2. **Image**: `og:image` is `/api/og/<username>?v=<image_path's version>`. The function builds the same SVG as `ticket-card.html` and rasterises it with `@resvg/resvg-js` (Node runtime). resvg handles the mask (the die-cut), `feColorMatrix` (the etch colour) and `feTurbulence` (grain). It needs:
   - **Fonts as TTF/OTF**: resvg and Satori can't read woff2, and `geist` only ships Geist Pixel as woff2. Decompress Pixel Line and Pixel Square once (`woff2_decompress` or fonttools) and commit the `.ttf` files under `api/fonts/`. Geist Mono already ships as a TTF. "Petabyte"/"Prototype" need a font file too: either bundle one or turn them into paths.
   - **The linework as PNG**: resvg doesn't decode WebP. `sharp` turns the bucket's webp into a PNG buffer, and that goes into the SVG as a data URL.
3. **Caching**: a remix writes a new `image_path`, so put its version in the image URL and answer with `Cache-Control: public, max-age=31536000, immutable`. The HTML gets a short `s-maxage`. X caches a card per URL for about a week, so the version in the URL is what makes a remix show up.

Alternatives considered:
- **Satori / `@vercel/og`**: same font and WebP limits as resvg, and no SVG masks in its JSX. You'd end up embedding the SVG anyway.
- **Snapshot at save time from the WebGL card in the browser**: the most faithful look, but it needs a new bucket mime type, gives nothing for existing tickets, and the image can be tampered with on the client.
- **Supabase Edge Function (Deno + resvg-wasm)**: works too, but the image would come from a different domain, and Vercel already serves the HTML.
