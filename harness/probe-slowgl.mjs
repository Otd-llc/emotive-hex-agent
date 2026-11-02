/**
 * Probe: which GL calls block the main thread on a cold mount (fresh profile), and for which
 * program. Prints JSON. Not a gate.
 */
import { chromium } from 'playwright-core';
import { startServer, chromePath } from './serve.mjs';

const server = await startServer();
const browser = await chromium.launch({ executablePath: chromePath(), headless: true, args: ['--use-angle=d3d11', '--ignore-gpu-blocklist'] });
try {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    await page.addInitScript(() => {
        window.__slow = [];
        const P = WebGL2RenderingContext.prototype;
        const progName = new WeakMap();
        const oShaderSource = P.shaderSource;
        const shaderName = new WeakMap();
        P.shaderSource = function (sh, src) {
            const m = src.match(/#define SHADER_NAME (.*)/);
            const u = (src.match(/uniform \w+ (\w+);/g) || []).slice(0, 4).join(' ');
            shaderName.set(sh, (m ? m[1] : '') + ' | ' + u.slice(0, 120) + ' | len ' + src.length);
            return oShaderSource.call(this, sh, src);
        };
        const oAttach = P.attachShader;
        P.attachShader = function (pr, sh) {
            const n = shaderName.get(sh);
            if (n && n.includes('fragment') === false) progName.set(pr, (progName.get(pr) || '') + ' {' + n + '}');
            return oAttach.call(this, pr, sh);
        };
        for (const k of Object.getOwnPropertyNames(P)) {
            const d = Object.getOwnPropertyDescriptor(P, k);
            if (typeof d.value !== 'function' || k === 'shaderSource' || k === 'attachShader') continue;
            const f = d.value;
            P[k] = function (...a) {
                const t = performance.now();
                const r = f.apply(this, a);
                const dt = performance.now() - t;
                if (dt > 50) {
                    const pr = a.find(x => x instanceof WebGLProgram);
                    window.__slow.push({ fn: k, ms: Math.round(dt), prog: pr ? progName.get(pr) : null });
                }
                return r;
            };
        }
    });
    await page.goto(`${server.url}/harness/agent.html`);
    await page.waitForFunction(() => window.__ready === true);
    const out = await page.evaluate(async () => {
        await H.mount({ size: 225 });
        await H.electricReady(60000);
        H.fire('shock');
        await H.sleep(1500);
        return window.__slow;
    });
    console.log(JSON.stringify(out, null, 1));
} finally {
    await browser.close();
    await server.close();
}
