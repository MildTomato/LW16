#!/bin/sh
# Render the OG mockups to og/out/ with headless Chromium (Playwright's build).
# usage: og/render.sh
set -e
cd "$(dirname "$0")"
CHROME=${CHROME:-$(find ~/Library/Caches/ms-playwright -name chrome-headless-shell -type f | sort | tail -1)}
shot() { # page query out
  "$CHROME" --headless --disable-gpu --hide-scrollbars --allow-file-access-from-files \
    --window-size=1200,630 --force-device-scale-factor=1 --virtual-time-budget=4000 \
    --screenshot="$PWD/out/$3.png" "file://$PWD/$1?$2" >/dev/null 2>&1
  echo "out/$3.png"
}
shot site-card.html "theme=light" site-light
shot site-card.html "theme=dark" site-dark
shot site-card.html "theme=light&labels=0" site-light-bare
shot ticket-card.html "u=dev_sam&n=13&theme=light" ticket-dev_sam-light
shot ticket-card.html "u=dev_sam&n=13&theme=dark" ticket-dev_sam-dark
shot ticket-card.html "u=linus&n=3&theme=light" ticket-linus-light
shot ticket-card.html "u=grace&n=2&theme=dark" ticket-grace-dark

# the cards in an X post, at feed width (2x)
post() { # query out
  "$CHROME" --headless --disable-gpu --hide-scrollbars --allow-file-access-from-files \
    --window-size=600,412 --force-device-scale-factor=2 --virtual-time-budget=4000 \
    --screenshot="$PWD/out/$2.png" "file://$PWD/x-preview.html?$1" >/dev/null 2>&1
  echo "out/$2.png"
}
post "img=out/site-light.png&ui=light" x-site-light
post "img=out/site-dark.png&ui=dark" x-site-dark
post "img=out/ticket-dev_sam-light.png&ui=light&name=Sam&handle=@dev_sam%20·%2012m&text=Got%20my%20Launch%20Week%2016%20ticket%20%F0%9F%8E%9F%EF%B8%8F" x-ticket-light
post "img=out/ticket-grace-dark.png&ui=dark&name=Grace&handle=@grace%20·%2012m&text=Ticket%20%230002%2C%20cut%20and%20numbered." x-ticket-dark
