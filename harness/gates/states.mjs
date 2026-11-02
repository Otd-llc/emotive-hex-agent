/**
 * States gate (positive). With the gem mounted:
 *  - every curated gesture (incl. shock, electricflourish) is in getAvailableGestures();
 *  - every setEmotion call emits exactly one matching emotion:change, every express() call
 *    exactly one matching gesture:trigger;
 *  - no console warnings/errors and no page errors during the run;
 *  - the gem's mean luminance delta against the field (central gem window) is above a floor
 *    on BOTH surfaces, so a dark gem that still moves FAILS;
 *  - morphing to and from every picked shape keeps the crystal family (flag + crystal shader),
 *    the soul, and the luminance floor on both surfaces for each shape.
 * Usage: node harness/gates/states.mjs [--plant-rename-shock | --plant-dark-gem | --plant-unflag]
 */
import { runGate, parsePlant, pixelStats, FIELD_DARK, FIELD_LIGHT } from './lib.mjs';

const plant = parsePlant();
const KEEP = [
    'breathe', 'sway', 'float', 'lean', 'tilt', 'nod', 'shake', 'bounce', 'pulse', 'expand',
    'contract', 'wave', 'peek', 'point', 'pointUp', 'pointDown', 'pointLeft', 'pointRight',
    'spin', 'orbit', 'sparkle', 'shimmer', 'flash', 'glow', 'shock', 'electricflourish',
];
// The picked morph set (D7), base first.
const SHAPES = ['hexgem', 'twisted', 'trio', 'cluster', 'split', 'rosette'];
// Per-shape floors (mean |delta L*| in the central gem window). split has a gap down its
// centre, so its window holds less gem: measured 2.7 dark at P2a; floor 2.0 on dark.
const SHAPE_FLOOR = { split: { dark: 2.0 } };
const floorFor = (shape, surface) => SHAPE_FLOOR[shape]?.[surface] ?? FLOOR[surface];
const EMOTIONS = [
    ['neutral'], ['joy'], ['focused', 'confident'], ['surprise', 'confident'], ['euphoria'],
    ['resting'], ['focused', 'intense'], ['sadness'], ['anger'], ['calm'],
];
// Gem window: the central GEM_FRAC of the stage box (the gem sits there at rest).
const GEM_FRAC = 0.3;
// Floor on the mean |delta L*| (CIE lightness, 0-100) between the gem window and the field.
const FLOOR = { dark: Number(process.env.FLOOR_DARK ?? 3), light: Number(process.env.FLOOR_LIGHT ?? 3) };

await runGate('states', { plant }, async ({ open }) => {
    const { page, consoleLines, pageErrors } = await open({ width: 1440, height: 900 });
    await page.evaluate(() => H.mount({ size: 225 }));
    await page.evaluate(() => H.sleep(500));

    const available = await page.evaluate(() => H.gestures());
    const missing = KEEP.filter(g => !available.includes(g));

    const calls = await page.evaluate(
        async ({ EMOTIONS, KEEP }) => {
            const out = [];
            for (const [e, u] of EMOTIONS) {
                const before = H.events.length;
                H.emotion(e, u);
                const got = H.events.slice(before).filter(x => x.ev === 'emotion:change');
                out.push({ call: `setEmotion(${e}${u ? ',' + u : ''})`, ok: got.length === 1 && got[0].data.emotion === e && (u ? got[0].data.undertone === u : true) });
                await H.sleep(60);
            }
            H.emotion('neutral', null);
            for (const g of KEEP) {
                const before = H.events.length;
                H.fire(g);
                const got = H.events.slice(before).filter(x => x.ev === 'gesture:trigger');
                out.push({ call: `express(${g})`, ok: got.length === 1 && got[0].data.gesture === g });
                await H.sleep(120);
            }
            return out;
        },
        { EMOTIONS, KEEP }
    );
    const badCalls = calls.filter(c => !c.ok).map(c => c.call);

    // Let gestures finish, then measure the resting gem on both surfaces.
    await page.evaluate(() => H.sleep(2500));
    const measure = async field => {
        const r = await page.evaluate(() => H.stageRect());
        const w = r.w * GEM_FRAC;
        return pixelStats(page, { x: r.x + (r.w - w) / 2, y: r.y + (r.h - w) / 2, width: w, height: w }, field);
    };
    const dark = await measure(FIELD_DARK);
    await page.evaluate(() => H.surface('light'));
    await page.evaluate(() => H.sleep(600));
    const light = await measure(FIELD_LIGHT);

    // Morph to and from every picked shape: crystal family kept, soul present, and the gem
    // above the luminance floor on both surfaces for every shape.
    const morphs = [];
    const visit = async shape => {
        await page.evaluate(s => H.morph(s), shape);
        const st = await page.evaluate(() => H.crystalState());
        await page.evaluate(() => H.surface('dark'));
        await page.evaluate(() => H.sleep(300));
        const d = await measure(FIELD_DARK);
        await page.evaluate(() => H.surface('light'));
        await page.evaluate(() => H.sleep(300));
        const l = await measure(FIELD_LIGHT);
        morphs.push({
            ...st,
            target: shape,
            darkLstar: +d.meanAbsDLstar.toFixed(2),
            lightLstar: +l.meanAbsDLstar.toFixed(2),
            ok: st.shape === shape && st.crystalFamily && st.material === 'crystal' && st.soul && d.meanAbsDLstar >= floorFor(shape, 'dark') && l.meanAbsDLstar >= floorFor(shape, 'light'),
        });
    };
    for (const shape of SHAPES.slice(1)) {
        await visit(shape); // hexgem -> shape
        await visit(SHAPES[0]); // shape -> hexgem
    }
    await page.evaluate(() => H.close());

    const warnings = consoleLines.filter(l => l.type === 'warning' || l.type === 'error').map(l => l.text);
    const checks = {
        allGesturesAvailable: missing.length === 0,
        allCallsEmitted: badCalls.length === 0,
        noWarningsOrErrors: warnings.length === 0 && pageErrors.length === 0,
        darkSurfaceVisible: dark.meanAbsDLstar >= FLOOR.dark,
        lightSurfaceVisible: light.meanAbsDLstar >= FLOOR.light,
        morphsToAndFromEveryShape: morphs.length === 2 * (SHAPES.length - 1) && morphs.every(m => m.ok),
    };
    await page.close();
    return {
        ok: Object.values(checks).every(Boolean),
        report: {
            checks,
            missingGestures: missing,
            failedCalls: badCalls,
            calls: calls.length,
            warnings: warnings.slice(0, 5).map(s => s.slice(0, 200)),
            pageErrors: pageErrors.slice(0, 3),
            gemWindow: GEM_FRAC,
            morphs,
            floors: FLOOR,
            dark: { meanAbsDLstar: +dark.meanAbsDLstar.toFixed(2), meanAbsDL: +dark.meanAbsDL.toFixed(4), coverage: +dark.coverage.toFixed(3), centreMaxDL: +dark.centreMaxDL.toFixed(4) },
            light: { meanAbsDLstar: +light.meanAbsDLstar.toFixed(2), meanAbsDL: +light.meanAbsDL.toFixed(4), coverage: +light.coverage.toFixed(3), centreMaxDL: +light.centreMaxDL.toFixed(4) },
        },
    };
});
