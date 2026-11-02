/**
 * Probe: cold link time of the electric pool shader after mount (fresh browser profile each
 * run, so the GPU program cache is cold). Prints JSON. Not a gate.
 * Usage: node harness/probe-link.mjs [--debugShaders]
 */
import { chromium } from 'playwright-core';
import { startServer, chromePath } from './serve.mjs';

const debugShaders = process.argv.includes('--debugShaders');
const server = await startServer();
const browser = await chromium.launch({ executablePath: chromePath(), headless: true, args: ['--use-angle=d3d11', '--ignore-gpu-blocklist'] });
try {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    await page.goto(`${server.url}/harness/agent.html`);
    await page.waitForFunction(() => window.__ready === true);
    const out = await page.evaluate(async debugShaders => {
        // Long tasks on the main thread (a synchronous shader link shows up here).
        const longTasks = [];
        new PerformanceObserver(l => l.getEntries().forEach(e => longTasks.push([Math.round(e.startTime), Math.round(e.duration)]))).observe({ entryTypes: ['longtask'] });
        const t0 = performance.now();
        await H.mount({ size: 225, debugShaders });
        const mounted = performance.now() - t0;
        const linkSinceMount = await H.electricReady(60000);
        await H.sleep(200);
        const shock0 = performance.now();
        H.fire('shock');
        await H.sleep(1500);
        return { t0: Math.round(t0), mountedMs: Math.round(mounted), linkSinceMountMs: linkSinceMount, shockAt: Math.round(shock0), longTasks };
    }, debugShaders);
    console.log(JSON.stringify({ debugShaders, ...out }));
} finally {
    await browser.close();
    await server.close();
}
