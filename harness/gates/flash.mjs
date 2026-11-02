/**
 * Flash gate (WCAG 2.3.1, metric in harness/flash-metric.mjs). The REFUSED composite (shock +
 * ruby shift >= 500 ms + shift back, the D3 table timing) is rendered with the test-only
 * stepping hook (__step, seeded RNG) at dt = 1/120, 1/60 and 1/30 s on the dark field, and at
 * 1/60 on the light field, on a 480 px stage, measured over its central 341 x 256 px window. Every leg
 * must pass; the ruby shift alone must pass too. The EMOTION leg swaps the core between the
 * most different emotion colours every 250 ms (faster than any agent state changes) and must
 * pass as well: the core's colour shift is eased over >= CORE_SHIFT_MIN_MS.
 * The DONE legs fire electricflourish (the other electric moment) on both fields.
 * --electric-set=<current|filament|corona|halo> runs every leg with that set's meshes and tune
 * (default current); run it once per set.
 * Planted fault: --plant-stock-flicker switches the flash-safety caps off (stock flicker
 * rates, up to 30 Hz) and must FAIL.
 * Usage: node harness/gates/flash.mjs [--electric-set=<name>] [--plant-stock-flicker]
 */
import { runGate, parsePlant } from './lib.mjs';

const pagePlant = parsePlant();
const SETS = ['current', 'filament', 'corona', 'halo'];
const electricSet = (process.argv.find(a => a.startsWith('--electric-set=')) ?? '--electric-set=current').slice(15);
if (!SETS.includes(electricSet)) throw new Error(`unknown electric set ${electricSet}`);
if (pagePlant && pagePlant !== 'stock-flicker') throw new Error(`unknown plant ${pagePlant}`);
// Worst case for the area rule: the gem drawn LARGE (480 px stage, camera pulled in so the gem
// itself fills most of the window, far bigger than the product placement), measured over the central
// 341 x 256 px window. At product size the gem is too small to reach the 25 % area at all.
const STAGE = 480;
const CAMERA_DISTANCE = 0.9;
const WIN = { w: 341, h: 256 };
const SECONDS = 3;
const FIELDS = { dark: '#08090d', light: '#faf7f0' };
const LEGS = [
    { name: 'refused dt=1/120 dark', dt: 1000 / 120, field: 'dark', composite: true },
    { name: 'refused dt=1/60 dark', dt: 1000 / 60, field: 'dark', composite: true },
    { name: 'refused dt=1/30 dark', dt: 1000 / 30, field: 'dark', composite: true },
    { name: 'refused dt=1/60 light', dt: 1000 / 60, field: 'light', composite: true },
    { name: 'ruby shift alone dt=1/60 dark', dt: 1000 / 60, field: 'dark', composite: false },
    { name: 'emotion swaps every 250 ms dt=1/60 dark', dt: 1000 / 60, field: 'dark', composite: false, emotions: true },
    { name: 'emotion swaps every 250 ms dt=1/60 light', dt: 1000 / 60, field: 'light', composite: false, emotions: true },
    { name: 'done (electricflourish) dt=1/60 dark', dt: 1000 / 60, field: 'dark', composite: false, flourish: true },
    { name: 'done (electricflourish) dt=1/60 light', dt: 1000 / 60, field: 'light', composite: false, flourish: true },
];
const SWAP = ['joy', 'suspicion', 'love', 'focused', 'anger', 'calm', 'surprise', 'fear', 'euphoria', 'sadness', 'excited', 'resting'];

await runGate('flash', { pagePlant }, async ({ open }) => {
    const legs = [];
    const { page, pageErrors } = await open({ width: 900, height: 700 });
    for (const leg of LEGS) {
        const surface = leg.field;
        const r = await page.evaluate(
            async ({ leg, STAGE, WIN, CAMERA_DISTANCE, SECONDS, SWAP, field, surface, plant, electricSet }) => {
                const { FlashMeter } = await import('/harness/flash-metric.mjs');
                await H.mount({ size: STAGE, surface, debugStep: true, field, cameraDistance: CAMERA_DISTANCE, electricSet });
                await H.electricReady();
                const m = H.mascot;
                m.__seed(1234);
                if (plant) m.__flashSafety(false);
                const meter = new FlashMeter(WIN.w * WIN.h);
                const crop = { x: (STAGE - WIN.w) >> 1, y: (STAGE - WIN.h) >> 1, w: WIN.w, h: WIN.h };
                const actions = leg.emotions
                    ? SWAP.map((e, i) => [i * 250, () => m.setEmotion(e)])
                    : leg.flourish
                      ? [[0, () => m.setEmotion('euphoria')], [0, () => m.express('electricflourish')]]
                      : [[0, () => m.setGemColor('ruby', 500)], [1500, () => m.setGemColor(null, 600)]];
                if (leg.composite) actions.push([0, () => m.express('shock')]);
                let maxArcs = 0;
                await H.stepFrames({
                    dtMs: leg.dt,
                    frames: Math.round((SECONDS * 1000) / leg.dt),
                    actions,
                    field,
                    crop,
                    onFrame: (rgba, t) => {
                        meter.push(rgba, t);
                        maxArcs = Math.max(maxArcs, H.arcs());
                    },
                });
                const res = meter.result();
                await H.close();
                return { ...res, maxArcs };
            },
            { leg, STAGE, WIN, CAMERA_DISTANCE, SECONDS, SWAP, field: FIELDS[leg.field], surface, plant: pagePlant === 'stock-flicker', electricSet }
        );
        legs.push({ leg: leg.name, ...r, ok: r.pass && (!(leg.composite || leg.flourish) || r.maxArcs > 0) });
    }
    await page.close();
    return { ok: legs.every(l => l.ok) && pageErrors.length === 0, report: { electricSet, stagePx: STAGE, cameraDistance: CAMERA_DISTANCE, window: WIN, seconds: SECONDS, pageErrors: pageErrors.slice(0, 3), legs } };
});
