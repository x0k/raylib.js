import { makeWorkerMessagesHandler } from './raylib_worker.js'

const font = new FontFace(
  "grixel",
  "url(fonts/acme_7_wide_xtnd.woff)",
)

self.fonts.add(font);

font.load().catch(console.error)

onmessage = makeWorkerMessagesHandler(self)
