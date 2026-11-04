/**
 * README capture: the gem on the deep-space field (#08090d) at README size, driven by the
 * deterministic stepping hook, so the same frames come out of every run. Writes PNG frames to
 * harness/_captures/readme/<name>/frame-NNNN.png (gitignored) plus a frames.json that records
 * the build, the size, the camera distance and the action list, and prints the gem's bounding
 * box on the first and the peak frame so the subject size can be checked before encoding.
 *
 *   node harness/capture-readme.mjs --name loop --size 1350 --dist 2.2 --fps 15 --seconds 12
 *   node harness/capture-readme.mjs --probe 1.6,2,2.4,3      (one frame per distance, bbox only)
 *
 * The frames are encoded outside this script (ffmpeg, see the README round notes).
 */
import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { startServer, chromePath, ROOT } from './serve.mjs';

const arg = (k, d) => {
    const i = process.argv.indexOf(k);
    return i > 0 ? process.argv[i + 1] : d;
};
const NAME = arg('--name', 'loop');
const SIZE = Number(arg('--size', '1350'));
const DIST = Number(arg('--dist', '2.2'));
const FPS = Number(arg('--fps', '15'));
const SECONDS = Number(arg('--seconds', '12'));
const PROBE = arg('--probe', null);
const FIELD = '#08090d';
const OUT = path.join(ROOT, 'harness', '_captures', 'readme', NAME);

// The story in one loop, times in ms of virtual time: rest, listen, be refused (shock, split),
// recover (hexgem), finish (electricflourish, star-cross), rest again so the seam is quiet.
const ACTIONS = [
    [0, ['emotion', 'calm']],
    [400, ['fire', 'breathe']],
    [1800, ['emotion', 'focused', 'confident']],
    [2000, ['fire', 'sway']],
    [3600, ['emotion', 'surprise', 'confident']],
    [3600, ['fire', 'shock']],
    [4200, ['morph', 'split', 600]],
    [6000, ['morph', 'hexgem', 600]],
    [6400, ['emotion', 'joy']],
    [7400, ['fire', 'electricflourish']],
    [7800, ['morph', 'star-cross', 700]],
    [10200, ['morph', 'hexgem', 600]],
    [10600, ['emotion', 'calm']],
];

const server = await startServer();
const browser = await chromium.launch({
    executablePath: chromePath(),
    headless: true,
    args: ['--use-angle=d3d11', '--ignore-gpu-blocklist'],
});
try {
    const page = await browser.newPage({ viewport: { width: SIZE + 100, height: SIZE + 100 }, deviceScaleFactor: 1 });
    page.on('pageerror', e => console.error('pageerror', e.message));
    await page.goto(`${server.url}/harness/agent.html`);
    await page.waitForFunction(() => window.__ready === true);

    const bbox = async () =>
        page.evaluate(() => {
            const c = H._cap;
            const g = c.getContext('2d', { willReadFrequently: true });
            const d = g.getImageData(0, 0, c.width, c.height).data;
            let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
            for (let y = 0; y < c.height; y++)
                for (let x = 0; x < c.width; x++) {
                    const i = (y * c.width + x) * 4;
                    // anything 24 levels above the field on any channel is subject
                    if (d[i] > 32 || d[i + 1] > 33 || d[i + 2] > 37) {
                        if (x < x0) x0 = x;
                        if (x > x1) x1 = x;
                        if (y < y0) y0 = y;
                        if (y > y1) y1 = y;
                    }
                }
            return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1, frac: (y1 - y0 + 1) / c.height };
        });

    const mount = async dist => {
        await page.evaluate(
            async ({ SIZE, dist, FIELD }) => {
                await H.mount({ size: SIZE, surface: 'dark', shape: 'hexgem', debugStep: true, field: FIELD, cameraDistance: dist });
                H.mascot.__seed(2026);
                await H.electricReady();
            },
            { SIZE, dist, FIELD },
        );
    };
    const step = async (n = 1) =>
        page.evaluate(({ n, FPS, FIELD }) => H.stepFrames({ dtMs: 1000 / FPS, frames: n, field: FIELD }).then(() => true), { n, FPS, FIELD });
    const grab = async () => page.evaluate(() => H._cap.toDataURL('image/png'));

    if (PROBE) {
        for (const d of PROBE.split(',').map(Number)) {
            await mount(d);
            await step(30);
            const b = await bbox();
            console.log(`dist ${d}: gem bbox`, b);
            await mkdir(OUT, { recursive: true });
            await writeFile(path.join(OUT, `probe-${d}.png`), Buffer.from((await grab()).split(',')[1], 'base64'));
            await page.evaluate(() => H.close());
        }
    } else {
        await mkdir(OUT, { recursive: true });
        await mount(DIST);
        const total = Math.round(SECONDS * FPS);
        const dt = 1000 / FPS;
        const todo = [...ACTIONS].sort((a, b) => a[0] - b[0]);
        const log = [];
        for (let k = 0; k < total; k++) {
            const t = k * dt;
            while (todo.length && todo[0][0] <= t) {
                const [, a] = todo.shift();
                await page.evaluate(a => {
                    const m = H.mascot;
                    if (a[0] === 'emotion') m.setEmotion(a[1], a[2]);
                    else if (a[0] === 'fire') m.express(a[1]);
                    else if (a[0] === 'morph') m.morphTo(a[1], { duration: a[2] });
                }, a);
                log.push({ k, t: Math.round(t), action: a });
            }
            await step(1);
            const png = Buffer.from((await grab()).split(',')[1], 'base64');
            await writeFile(path.join(OUT, `frame-${String(k).padStart(4, '0')}.png`), png);
            if (k === 0 || k === Math.round(8.4 * FPS)) console.log(`frame ${k} bbox`, await bbox());
        }
        const build = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT }).toString().trim();
        await writeFile(path.join(OUT, 'frames.json'), JSON.stringify({ build, size: SIZE, dist: DIST, fps: FPS, seconds: SECONDS, field: FIELD, actions: log }, null, 2) + '\n');
        console.log(`wrote ${total} frames to ${OUT} (build ${build})`);
        await page.evaluate(() => H.close());
    }
} finally {
    await browser.close();
    server.close();
}
