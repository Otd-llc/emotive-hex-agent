/**
 * Shared gate plumbing: exit codes, server + system Chrome, console capture, pixel stats.
 * Exit codes: 0 pass, 1 fail, 2 infra.
 */
import { chromium } from 'playwright-core';
import { startServer, chromePath } from '../serve.mjs';

export const PASS = 0;
export const FAIL = 1;
export const INFRA = 2;

/** Parse --plant-<name> (at most one). */
export function parsePlant(argv = process.argv.slice(2)) {
    const p = argv.filter(a => a.startsWith('--plant-')).map(a => a.slice('--plant-'.length));
    if (p.length > 1) throw new Error('one --plant-<fault> at a time');
    return p[0] ?? null;
}

/** Lines that the GL gate counts, unfiltered. */
export const GL_LINE = /\[\.WebGL-|GL_INVALID|WebGL: [A-Z_]+|too many errors/i;

/**
 * Run `body` with a served harness + system Chrome. Infra failures exit 2.
 * @param {string} name - gate name (for logs)
 * @param {{ plant?: string|null, pagePlant?: string|null }} opts
 * @param {(ctx: {browser, server, open: Function}) => Promise<{ok: boolean, report: object}>} body
 */
export async function runGate(name, opts, body) {
    const t0 = Date.now();
    let server, browser;
    try {
        server = await startServer({ plant: opts.plant ?? null });
        const exe = chromePath();
        if (!exe) throw new Error('system Chrome not found (set CHROME_PATH)');
        browser = await chromium.launch({
            executablePath: exe,
            headless: true,
            args: ['--use-angle=d3d11', '--enable-unsafe-swiftshader=false', '--ignore-gpu-blocklist'],
        });
    } catch (e) {
        console.error(`[${name}] INFRA: ${e.message}`);
        await server?.close();
        process.exit(INFRA);
    }
    const open = async ({ width = 1440, height = 900, query = '' } = {}) => {
        const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
        const consoleLines = [];
        const pageErrors = [];
        page.on('console', m => consoleLines.push({ type: m.type(), text: m.text() }));
        page.on('pageerror', e => pageErrors.push(String(e.stack || e.message)));
        await page.goto(`${server.url}/harness/agent.html${query}`);
        await page.waitForFunction(() => window.__ready === true, null, { timeout: 30000 });
        return { page, consoleLines, pageErrors };
    };
    let code = INFRA;
    try {
        const gpu = await (async () => {
            const p = await browser.newPage();
            const r = await p.evaluate(() => {
                const gl = document.createElement('canvas').getContext('webgl2');
                if (!gl) return null;
                const ext = gl.getExtension('WEBGL_debug_renderer_info');
                const out = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
                gl.getExtension('WEBGL_lose_context')?.loseContext();
                return out;
            });
            await p.close();
            return r;
        })();
        if (!gpu) throw Object.assign(new Error('no WebGL 2 in this Chrome'), { infra: true });
        const { ok, report } = await body({ browser, server, open });
        code = ok ? PASS : FAIL;
        console.log(JSON.stringify({ gate: name, plant: opts.plant ?? opts.pagePlant ?? null, result: ok ? 'PASS' : 'FAIL', gpu, seconds: Math.round((Date.now() - t0) / 1000), ...report }, null, 2));
    } catch (e) {
        console.error(`[${name}] ${e.infra ? 'INFRA' : 'INFRA (unexpected)'}: ${e.stack || e.message}`);
        code = INFRA;
    } finally {
        await browser.close().catch(() => {});
        await server.close().catch(() => {});
    }
    process.exit(code);
}

/**
 * Screenshot a page-space rectangle and compute stats against a field colour, in the page.
 * @returns {Promise<{meanAbsDL: number, centre: number[], field: number[], centreDL: number, coverage: number}>}
 */
export async function pixelStats(page, rect, field) {
    const png = await page.screenshot({ clip: rect });
    const b64 = png.toString('base64');
    return page.evaluate(
        async ({ b64, field }) => {
            const img = new Image();
            img.src = 'data:image/png;base64,' + b64;
            await img.decode();
            const c = document.createElement('canvas');
            c.width = img.width;
            c.height = img.height;
            const g = c.getContext('2d');
            g.drawImage(img, 0, 0);
            const d = g.getImageData(0, 0, c.width, c.height).data;
            const lin = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
            const L = (r, gg, b) => 0.2126 * lin(r) + 0.7152 * lin(gg) + 0.0722 * lin(b);
            const Lf = L(...field);
            let sum = 0, covered = 0;
            const n = d.length / 4;
            for (let i = 0; i < d.length; i += 4) {
                const dl = Math.abs(L(d[i], d[i + 1], d[i + 2]) - Lf);
                sum += dl;
                if (dl > 0.02) covered++;
            }
            const ci = ((c.height >> 1) * c.width + (c.width >> 1)) * 4;
            const centre = [d[ci], d[ci + 1], d[ci + 2]];
            // Max delta over a small centre patch (1/15 of the box): the gem's centre, robust
            // to a facet edge landing exactly on the centre pixel.
            const half = Math.max(1, Math.round(c.width / 30));
            let centreMaxDL = 0;
            for (let y = (c.height >> 1) - half; y <= (c.height >> 1) + half; y++) {
                for (let x = (c.width >> 1) - half; x <= (c.width >> 1) + half; x++) {
                    const i = (y * c.width + x) * 4;
                    centreMaxDL = Math.max(centreMaxDL, Math.abs(L(d[i], d[i + 1], d[i + 2]) - Lf));
                }
            }
            return { meanAbsDL: sum / n, centre, field, centreDL: Math.abs(L(...centre) - Lf), centreMaxDL, coverage: covered / n };
        },
        { b64, field }
    );
}

export const FIELD_DARK = [0x0b, 0x10, 0x20];
export const FIELD_LIGHT = [0xf3, 0xee, 0xe2];
