import { describe, it, expect } from 'vitest';
import { FlashMeter, WINDOW_PX } from '../../harness/flash-metric.mjs';

// The flash gate's metric (WCAG 2.3.1), checked on synthetic frame sequences.
const N = Math.ceil(WINDOW_PX * 0.3); // 30 % of the window: above the 25 % area limit
const frame = (rgb, n = N) => {
    const a = new Uint8ClampedArray(n * 4);
    for (let i = 0; i < n; i++) a.set([...rgb, 255], i * 4);
    return a;
};
const run = (fn, { seconds = 2, fps = 60, n = N } = {}) => {
    const m = new FlashMeter(n);
    for (let k = 0; k < seconds * fps; k++) {
        const t = (k * 1000) / fps;
        m.push(frame(fn(t), n), t);
    }
    return m.result();
};
const BLACK = [0, 0, 0], WHITE = [255, 255, 255], GREY = [128, 128, 128], RED = [230, 10, 10];

describe('FlashMeter', () => {
    it('steady frames pass', () => {
        expect(run(() => GREY).pass).toBe(true);
    });

    it('5 Hz black/white over 30 % of the window fails (general flash)', () => {
        const r = run(t => (Math.floor(t / 100) % 2 ? WHITE : BLACK));
        expect(r.maxFlashesPerSAnyPixel).toBeGreaterThanOrEqual(5);
        expect(r.pass).toBe(false);
    });

    it('2 Hz black/white passes (<= 3 flashes per second)', () => {
        const r = run(t => (Math.floor(t / 250) % 2 ? WHITE : BLACK), { seconds: 3 });
        expect(r.maxFlashesPerSAnyPixel).toBeLessThanOrEqual(3);
        expect(r.pass).toBe(true);
    });

    it('5 Hz flashing over only 10 % of the window passes (area limit)', () => {
        const r = run(t => (Math.floor(t / 100) % 2 ? WHITE : BLACK), { n: Math.ceil(WINDOW_PX * 0.1) });
        expect(r.pass).toBe(true);
    });

    it('small luminance wobble (< 10 %) at any rate passes', () => {
        const r = run(t => (Math.floor(t / 33) % 2 ? [128, 128, 128] : [140, 140, 140]));
        expect(r.pass).toBe(true);
    });

    it('a saturated red flicker at 5 Hz fails as a red flash even at matched luminance', () => {
        // red vs a grey of similar luminance: no general transition, but red transitions
        const r = run(t => (Math.floor(t / 100) % 2 ? RED : [70, 70, 70]));
        expect(r.redFlashPx).toBeGreaterThan(0);
        expect(r.pass).toBe(false);
    });

    it('one slow shift to red and back (the ruby refusal) passes', () => {
        const r = run(t => (t < 500 ? BLACK : t < 1500 ? RED : BLACK), { seconds: 2 });
        expect(r.pass).toBe(true);
    });

    it('frame rate does not change the verdict (60 vs 120 vs 30 fps)', () => {
        for (const fps of [30, 60, 120]) {
            expect(run(t => (Math.floor(t / 100) % 2 ? WHITE : BLACK), { fps }).pass).toBe(false);
            expect(run(t => (Math.floor(t / 250) % 2 ? WHITE : BLACK), { fps, seconds: 3 }).pass).toBe(true);
        }
    });
});
