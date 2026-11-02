/**
 * Static server for the browser harness. Serves the repo root read-only, plus:
 *   /three.module.js        -> node_modules/three/build/three.module.js (import map target)
 *   /dist/emotive-hex-agent.js, optionally rewritten by PLANTS (planted faults for gate
 *                             demos; each plant must match exactly once or startServer throws)
 * Also exports chromePath(): the SYSTEM Chrome (CHROME_PATH overrides).
 */
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json',
    '.obj': 'text/plain',
    '.glb': 'model/gltf-binary',
    '.webp': 'image/webp',
    '.png': 'image/png',
    '.map': 'application/json',
};

/** The system Chrome, as bs-premades/tools/serve.mjs finds it (system install preferred). */
export function chromePath() {
    const env = process.env.CHROME_PATH;
    if (env && existsSync(env)) return env;
    return [
        'C:/Program Files/Google/Chrome/Application/chrome.exe',
        'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
        `C:/Users/${process.env.USERNAME}/AppData/Local/Google/Chrome/Application/chrome.exe`,
        '/usr/bin/google-chrome',
        '/usr/bin/chromium',
    ].find(p => existsSync(p));
}

/**
 * Planted faults: string rewrites of the built engine. Each must match exactly once.
 * @type {Record<string, Array<[string|RegExp, string]>>}
 */
export const PLANTS = {
    // GL gate: a shader that cannot compile -> GL errors on every draw.
    'shader-error': [['gl_FragColor = vec4(finalColor, finalAlpha);', '#error planted fault\ngl_FragColor = vec4(finalColor, finalAlpha);']],
    // States gate: the shock gesture renamed in the build.
    'rename-shock': [['name:"shock"', 'name:"shockX"']],
    // States gate: a gem that still renders and moves, but dark.
    'dark-gem': [['gl_FragColor = vec4(finalColor, finalAlpha);', 'gl_FragColor = vec4(finalColor * 0.02, finalAlpha);']],
    // Teardown gate: the context is never released.
    'no-context-loss': [['.forceContextLoss()', '.getContext()']],
    // GL gate: the core links synchronously on the first draw (the page freezes on a cold cache).
    'sync-link': [['async _prelinkCore(){', 'async _prelinkCore(){this._linked=!0,this._resolveVisible(),this._startElementPreloading();return;']],
};

function applyPlant(src, name) {
    const edits = PLANTS[name];
    if (!edits) throw new Error(`unknown plant "${name}"`);
    for (const [from, to] of edits) {
        const count = typeof from === 'string' ? src.split(from).length - 1 : (src.match(new RegExp(from.source, 'g')) || []).length;
        if (count !== 1) throw new Error(`plant "${name}": pattern ${from} matched ${count} times (want 1)`);
        src = src.replace(from, to);
    }
    return src;
}

/**
 * @param {{ plant?: string|null, port?: number }} [opts]
 * @returns {Promise<{ url: string, close: () => Promise<void> }>}
 */
export async function startServer({ plant = null, port = 0 } = {}) {
    const distPath = path.join(ROOT, 'dist', 'emotive-hex-agent.js');
    if (!existsSync(distPath)) throw new Error('dist/emotive-hex-agent.js missing: run npm run build');
    let dist = await readFile(distPath, 'utf8');
    if (plant) dist = applyPlant(dist, plant);

    const server = http.createServer(async (req, res) => {
        try {
            const url = new URL(req.url, 'http://x');
            let p = decodeURIComponent(url.pathname);
            if (p === '/dist/emotive-hex-agent.js') {
                res.writeHead(200, { 'content-type': TYPES['.js'], 'cache-control': 'no-store' });
                return res.end(dist);
            }
            if (p === '/three.module.js') p = '/node_modules/three/build/three.module.js';
            if (p.endsWith('/')) p += 'index.html';
            const file = path.join(ROOT, p);
            if (!file.startsWith(ROOT) || /[\/]\.env/.test(file)) throw Object.assign(new Error('forbidden'), { code: 403 });
            await stat(file);
            res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
            res.end(await readFile(file));
        } catch (e) {
            res.writeHead(e.code === 403 ? 403 : 404);
            res.end();
        }
    });
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', resolve);
    });
    const { port: actual } = server.address();
    return {
        url: `http://127.0.0.1:${actual}`,
        close: () => new Promise(r => server.close(() => r())),
    };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
    const port = Number(process.env.PORT || 5399);
    const s = await startServer({ port, plant: process.env.PLANT || null });
    console.log(`harness: ${s.url}/harness/agent.html`);
}
