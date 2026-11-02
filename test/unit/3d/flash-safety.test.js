// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';

// P2a items 4 + 8: time-based (not frame-based) flicker with a seeded RNG hook, flicker rates
// capped for WCAG 2.3.1, and the test-only stepping hook.
vi.mock('three', async importOriginal => {
    const THREE = await importOriginal();
    const { makeFakeRendererClass } = await import('../../helpers/fakeWebGLRenderer.js');
    return { ...THREE, WebGLRenderer: makeFakeRendererClass(THREE) };
});

const rng = await import('../../../src/3d/utils/rng.js');
const clock = await import('../../../src/3d/utils/clock.js');
const { FLASH_SAFETY, MAX_FLICKER_HZ, safeHz, safeFlashEvents } = await import('../../../src/3d/flashSafety.js');
const { AnimationConfig } = await import('../../../src/3d/effects/animation/AnimationConfig.js');
const { AnimationState } = await import('../../../src/3d/effects/animation/AnimationState.js');
await import('../../../src/3d/index-hex-agent.js');
const { GESTURE_REGISTRY } = await import('../../../src/core/gestures/index.js');
const { EmotiveMascot3D } = await import('../../../src/3d/index.js');

afterEach(() => {
    rng.seed(null);
    clock.exitStepMode();
    FLASH_SAFETY.enabled = true;
});

/** Opposing transitions of size >= frac x (max - min) in a sampled signal. */
function transitions(values, frac = 0.1) {
    const lo = Math.min(...values), hi = Math.max(...values);
    const th = (hi - lo) * frac;
    if (th === 0) return 0;
    let n = 0, dir = 0, ref = values[0];
    for (const v of values) {
        if (dir >= 0 && v > ref) ref = dir === 0 ? ref : v;
        if (dir <= 0 && v < ref) ref = dir === 0 ? ref : v;
        if (Math.abs(v - ref) >= th && Math.sign(v - ref) !== dir) {
            n++;
            dir = Math.sign(v - ref);
            ref = v;
        }
    }
    return n;
}

describe('seeded RNG hook', () => {
    it('same seed, same stream; null restores Math.random', () => {
        rng.seed(42);
        const a = [rng.random(), rng.random(), rng.random()];
        rng.seed(42);
        expect([rng.random(), rng.random(), rng.random()]).toEqual(a);
        rng.seed(null);
        const spy = vi.spyOn(Math, 'random');
        rng.random();
        expect(spy).toHaveBeenCalled();
        spy.mockRestore();
    });

    it('hash2 is a pure function of its inputs', () => {
        expect(rng.hash2(3, 7)).toBe(rng.hash2(3, 7));
        expect(rng.hash2(3, 7)).not.toBe(rng.hash2(3, 8));
    });
});

describe('arc flicker is time-based', () => {
    const flickerSeries = hz => {
        rng.seed(7);
        const cfg = new AnimationConfig({ flicker: { intensity: 0.5, rate: 30, pattern: 'random' } }, 1200);
        const st = new AnimationState(cfg, 0);
        const dt = 1 / hz;
        const out = [];
        for (let t = 0; t < 1; t += dt) {
            st._applyHoldAnimations(t, dt);
            out.push(st.flickerValue);
        }
        return out;
    };
    const changes = s => s.filter((v, i) => i > 0 && v !== s[i - 1]).length;

    it('same seed at 60 and 120 Hz gives the same transition count (+/- 1)', () => {
        FLASH_SAFETY.enabled = false; // the stock 30 Hz rate, to make the comparison meaningful
        const a = changes(flickerSeries(60));
        const b = changes(flickerSeries(120));
        expect(a).toBeGreaterThan(10);
        expect(Math.abs(a - b)).toBeLessThanOrEqual(1);
    });

    it('flash-safe: at most MAX_FLICKER_HZ value changes per second, at any frame rate', () => {
        for (const hz of [30, 60, 120]) expect(changes(flickerSeries(hz))).toBeLessThanOrEqual(MAX_FLICKER_HZ);
    });
});

describe('rate caps', () => {
    it('safeHz caps at MAX_FLICKER_HZ (<= 3 flashes/s), passes through when off', () => {
        expect(MAX_FLICKER_HZ).toBeLessThanOrEqual(3);
        expect(safeHz(25)).toBe(MAX_FLICKER_HZ);
        expect(safeHz(1)).toBe(1);
        FLASH_SAFETY.enabled = false;
        expect(safeHz(25)).toBe(25);
    });

    it('flash events closer than the minimum gap are merged (brightest kept)', () => {
        const ev = safeFlashEvents([{ at: 0.1, intensity: 1 }, { at: 0.2, intensity: 3 }, { at: 0.9, intensity: 2 }], 1200);
        expect(ev).toEqual([{ at: 0.1, intensity: 3 }, { at: 0.9, intensity: 2 }]);
    });

    it('the shock gesture glow has <= 3 flashes in its 1.2 s (vs many with the stock flicker)', () => {
        const shock = GESTURE_REGISTRY.shock;
        const sample = () => {
            const out = [];
            for (let i = 0; i <= 1200; i++) out.push(shock['3d'].evaluate(i / 1200, {}).glowIntensity);
            return transitions(out);
        };
        expect(sample() / 2).toBeLessThanOrEqual(3 * 1.2);
        FLASH_SAFETY.enabled = false;
        expect(sample() / 2).toBeGreaterThan(6);
    });
});

describe('__step(dtMs) test hook', () => {
    it('refuses without debugStep', () => {
        const m = new EmotiveMascot3D({ assetBasePath: '/x' });
        expect(() => m.__step(16)).toThrow(/debugStep/);
    });

    it('advances the virtual clock exactly and draws one frame per call', async () => {
        const { Core3DManager } = await import('../../../src/3d/Core3DManager.js');
        const m = new EmotiveMascot3D({ assetBasePath: '/x', debugStep: true });
        m.core3D = new Core3DManager(Object.assign(document.createElement('canvas'), { width: 64, height: 64 }), { geometry: 'sphere', assetBasePath: '/x' });
        const spy = vi.spyOn(m.core3D, 'render');
        m.__step(10);
        const t = clock.now();
        m.__step(8);
        expect(clock.now() - t).toBe(8);
        expect(spy.mock.calls.map(c => c[0])).toEqual([10, 8]);
        await m.destroy();
        expect(clock.isStepMode()).toBe(false);
    });
});
