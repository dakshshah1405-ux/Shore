// Copies MapLibre's web-worker files into public/maplibre/ so the browser can load them.
//
// MapLibre 6 looks for its worker next to its own module file (new URL(..., import.meta.url)),
// but Next bundles that module into a renamed chunk, so the lookup 404s and the map never draws.
// ZoneMap points MapLibre at these copies with setWorkerUrl(). Runs before `dev` and `build`,
// so the copies always match the installed MapLibre version.

import fs from 'node:fs';
import path from 'node:path';

const src = path.join('node_modules', 'maplibre-gl', 'dist');
const dest = path.join('public', 'maplibre');
const files = ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs'];   // the worker imports ./maplibre-gl-shared.mjs

fs.mkdirSync(dest, { recursive: true });
for (const f of files) fs.copyFileSync(path.join(src, f), path.join(dest, f));
console.log(`copied ${files.length} MapLibre worker files to ${dest}`);
