/**
 * HEADED engine capture tool. Renders each picked shape on both surfaces (dark field
 * #08090d, light #faf7f0) at 160 px and 480 px with the deterministic stepping hook
 * (__step, seeded RNG) and writes PNG stills to harness/_captures/ (gitignored):
 *   capture_<shape>_<dark|light>_<size>.png
 * Each still carries a 16 px band below the stage reading "ENGINE CAPTURE": these are frames
 * from the engine's own shader, not Blender renders. An index.json records the build.
 * Usage: node harness/capture.mjs [--shapes hexgem,split] [--headless]
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
const SHAPES = arg('--shapes', 'hexgem,twisted,trio,cluster,split,rosette').split(',');
const SURFACES = { dark: '#08090d', light: '#faf7f0' };
const SIZES = [160, 480];
const OUT = path.join(ROOT, 'harness', '_captures');
const FRAMES = 90; // 1.5 s at 60 Hz after mount: past any settle, same frame every run

const server = await startServer();
const browser = await chromium.launch({
    executablePath: chromePath(),
    headless: process.argv.includes('--headless'),
    args: ['--use-angle=d3d11', '--ignore-gpu-blocklist'],
});
const files = [];
try {
    await mkdir(OUT, { recursive: true });
    const page = await browser.newPage({ viewport: { width: 900, height: 700 }, deviceScaleFactor: 1 });
    await page.goto(`${server.url}/harness/agent.html`);
    await page.waitForFunction(() => window.__ready === true);
    for (const shape of SHAPES) {
        for (const [surface, field] of Object.entries(SURFACES)) {
            for (const size of SIZES) {
                const dataUrl = await page.evaluate(
                    async ({ shape, surface, field, size, FRAMES }) => {
                        await H.mount({ size, surface, shape, debugStep: true, field });
                        H.mascot.__seed(2026);
                        const c = await H.stepFrames({ dtMs: 1000 / 60, frames: FRAMES, field });
                        const out = document.createElement('canvas');
                        out.width = c.width;
                        out.height = c.height + 16;
                        const g = out.getContext('2d');
                        g.drawImage(c, 0, 0);
                        g.fillStyle = surface === 'dark' ? '#14161d' : '#ece6d8';
                        g.fillRect(0, c.height, out.width, 16);
                        g.fillStyle = surface === 'dark' ? '#9aa3b5' : '#4a4f5c';
                        g.font = '10px monospace';
                        g.textBaseline = 'middle';
                        g.fillText(`ENGINE CAPTURE ${shape} ${surface} ${size}`, 4, c.height + 8);
                        await H.close();
                        return out.toDataURL('image/png');
                    },
                    { shape, surface, field, size, FRAMES }
                );
                const name = `capture_${shape}_${surface}_${size}.png`;
                await writeFile(path.join(OUT, name), Buffer.from(dataUrl.split(',')[1], 'base64'));
                files.push(name);
            }
        }
    }
    let commit = 'unknown';
    try {
        commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT }).toString().trim();
    } catch {}
    await writeFile(
        path.join(OUT, 'index.json'),
        JSON.stringify({ label: 'ENGINE CAPTURES (emotive-hex-agent shader), not Blender renders', commit, frames: FRAMES, dt: '1/60 s', seed: 2026, files }, null, 2) + '\n'
    );
    console.log(JSON.stringify({ out: OUT, count: files.length, files }));
} finally {
    await browser.close();
    await server.close();
}
