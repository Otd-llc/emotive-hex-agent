/**
 * GL gate. Unfiltered count of `[.WebGL-` / GL_INVALID / "too many errors" console lines
 * must be 0 at 1440x900 AND 390x844, with debugShaders on, while the gem idles and fires
 * shock + electricflourish; no page errors; the centre pixel of the gem must differ from
 * the field (visibility). The electric pool links at mount in the background: the FIRST shock
 * (no earlier electric gesture) must show arcs; electricLinkMs is measured from mount.
 * Usage: node harness/gates/gl.mjs [--plant-shader-error | --plant-sync-link]
 */
import { runGate, parsePlant, GL_LINE, pixelStats, FIELD_DARK } from './lib.mjs';

const plant = parsePlant();
const VIEWPORTS = [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
];
const CENTRE_DL_MIN = 0.05;
// No main-thread task longer than this from mount through both gestures: every shader links
// off the main thread (a cold synchronous link froze the page for 4-13 s before P2a).
const LONG_TASK_MAX_MS = 250; // max relative-luminance delta vs the field in the centre patch

await runGate('gl', { plant }, async ({ open }) => {
    const legs = [];
    for (const vp of VIEWPORTS) {
        const { page, consoleLines, pageErrors } = await open({ ...vp, query: '?debugShaders=1' });
        const t0 = await page.evaluate(() => performance.now());
        await page.evaluate(() => H.mount({ size: 225, debugShaders: true }));
        // The electric pool links at mount in the background; the FIRST shock after it is
        // ready must show arcs (no earlier electric gesture warms anything up).
        const linkMs = await page.evaluate(() => H.electricReady());
        const shockArcs = await page.evaluate(() => H.fireAndWatch('shock', 1400));
        const flourishArcs = await page.evaluate(() => H.fireAndWatch('electricflourish', 1400));
        const longestTaskMs = await page.evaluate(t0 => H.longestTask(t0), t0);
        const rect = await page.evaluate(() => H.stageRect());
        const px = await pixelStats(page, { x: rect.x, y: rect.y, width: rect.w, height: rect.h }, FIELD_DARK);
        await page.evaluate(() => H.close());
        const glLines = consoleLines.filter(l => GL_LINE.test(l.text)).map(l => l.text);
        const errors = consoleLines.filter(l => l.type === 'error').map(l => l.text);
        legs.push({
            viewport: `${vp.width}x${vp.height}`,
            glLines: glLines.length,
            glSample: glLines.slice(0, 3),
            consoleErrors: errors.length,
            errorSample: errors.slice(0, 3),
            pageErrors: pageErrors.slice(0, 3),
            centreDL: +px.centreDL.toFixed(4),
            centreMaxDL: +px.centreMaxDL.toFixed(4),
            electricLinkMs: linkMs,
            longestTaskMs,
            arcs: { firstShock: shockArcs, flourish: flourishArcs },
            ok:
                glLines.length === 0 &&
                errors.length === 0 &&
                pageErrors.length === 0 &&
                px.centreMaxDL >= CENTRE_DL_MIN &&
                (longestTaskMs === null || longestTaskMs <= LONG_TASK_MAX_MS) &&
                shockArcs > 0 &&
                flourishArcs > 0,
        });
        await page.close();
    }
    return { ok: legs.every(l => l.ok), report: { centreDLMin: CENTRE_DL_MIN, legs } };
});
