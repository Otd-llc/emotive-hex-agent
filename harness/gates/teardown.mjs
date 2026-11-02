/**
 * Teardown gate. 50 open/close cycles, each firing shock just before close (so a shader
 * link is usually in flight at close); then one 25 s quiet window after cycle 50.
 * PASS iff: no uncaught errors / console errors / WebGL warnings; every agent context lost
 * (forceContextLoss) once its teardown resolved; zero getProgramParameter calls on an agent
 * context after its teardown resolved; zero engine timers and rAFs pending at the end.
 * Usage: node harness/gates/teardown.mjs [--plant-no-context-loss | --plant-early-dispose]
 */
import { runGate, parsePlant, GL_LINE } from './lib.mjs';

const plant = parsePlant();
const CYCLES = Number(process.env.CYCLES || 50);
const QUIET_MS = 25000;
const SETTLE_CAP_MS = 60000; // every teardown must resolve within this after the last close

await runGate('teardown', { plant }, async ({ open }) => {
    const { page, consoleLines, pageErrors } = await open({ width: 1440, height: 900 });
    const run = await page.evaluate(
        async ({ CYCLES, SETTLE_CAP_MS }) => {
            const pendingClose = [];
            let inFlightCloses = 0;
            const t0 = performance.now();
            for (let i = 0; i < CYCLES; i++) {
                await H.mount({ size: 225 });
                await H.sleep(150 + (i % 5) * 40);
                H.fire('shock');
                if (i % 5 === 0) {
                    // Every 5th cycle closes while the electric pool's shader link is in flight.
                    const t = performance.now();
                    while (H.pendingCompiles() === 0 && performance.now() - t < 3000) await H.sleep(2);
                } else {
                    await H.sleep(30);
                }
                if (H.pendingCompiles() > 0) inFlightCloses++;
                pendingClose.push(H.close());
            }
            const closedAt = performance.now();
            let settled = true;
            await Promise.race([
                Promise.all(pendingClose),
                H.sleep(SETTLE_CAP_MS).then(() => (settled = false)),
            ]);
            return { cyclesMs: Math.round(closedAt - t0), settleMs: Math.round(performance.now() - closedAt), settled, inFlightCloses };
        },
        { CYCLES, SETTLE_CAP_MS }
    );
    await page.evaluate(ms => H.sleep(ms), QUIET_MS);
    const end = await page.evaluate(() => {
        const ctx = H.probe.contexts;
        return {
            contexts: ctx.length,
            notLost: ctx.filter(c => !c.gl.isContextLost()).length,
            notClosed: ctx.filter(c => !c.closed).length,
            programParamAfterClose: ctx.reduce((s, c) => s + c.callsAfterClose, 0),
            pending: H.pending(),
            pageErrors: H.probe.errors.slice(0, 5),
            lateStacks: H.probe.lateStacks,
        };
    });
    const errors = consoleLines.filter(l => l.type === 'error').map(l => l.text);
    const glWarnings = consoleLines.filter(l => GL_LINE.test(l.text) || /WebGL/.test(l.text)).map(l => l.text);
    const checks = {
        allTeardownsSettled: run.settled,
        closedWithLinkInFlight: run.inFlightCloses > 0, // the deferral was actually exercised
        contextsCreated: end.contexts === CYCLES,
        allContextsLost: end.notLost === 0,
        noProgramParamAfterClose: end.programParamAfterClose === 0,
        noEngineTimers: end.pending.timers.length === 0,
        noEngineRafs: end.pending.rafs === 0,
        noUncaughtErrors: pageErrors.length === 0 && end.pageErrors.length === 0,
        noConsoleErrors: errors.length === 0,
        noWebGLWarnings: glWarnings.length === 0,
    };
    await page.close();
    return {
        ok: Object.values(checks).every(Boolean),
        report: {
            cycles: CYCLES,
            quietMs: QUIET_MS,
            ...run,
            checks,
            contexts: end.contexts,
            contextsNotLost: end.notLost,
            programParamAfterClose: end.programParamAfterClose,
            programParamAfterCloseStacks: end.lateStacks,
            pendingTimers: end.pending.timers.slice(0, 3),
            pendingRafs: end.pending.rafs,
            uncaught: [...pageErrors, ...end.pageErrors].slice(0, 3).map(s => s.slice(0, 300)),
            consoleErrors: errors.slice(0, 3).map(s => s.slice(0, 300)),
            webglWarnings: glWarnings.slice(0, 3),
        },
    };
});
