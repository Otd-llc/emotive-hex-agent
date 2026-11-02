// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Fix (b): a real FPS limiter (30 idle / 60 during gestures; time still advances by the
// full elapsed delta) and stop()/start() on document visibility.
const { EmotiveMascot3D } = await import('../../../src/3d/index.js');

function fakeCore({ active = () => false } = {}) {
    return {
        render: vi.fn(),
        waitUntilReady: async () => {},
        isMorphing: () => false,
        animationManager: { hasActiveAnimations: active },
        destroy: () => Promise.resolve(),
    };
}

let rafQueue;
beforeEach(() => {
    rafQueue = [];
    vi.stubGlobal('requestAnimationFrame', cb => (rafQueue.push(cb), rafQueue.length));
    vi.stubGlobal('cancelAnimationFrame', () => {});
});
afterEach(() => vi.unstubAllGlobals());

/** Drive the loop at `hz` for `ms` of display time. */
function run(m, hz, ms, t0 = 1000) {
    const step = 1000 / hz;
    for (let t = t0; t <= t0 + ms + 1e-6; t += step) {
        const cb = rafQueue.shift();
        if (!cb) break;
        cb(t);
    }
}

async function started(core) {
    const m = new EmotiveMascot3D({});
    m.core3D = core;
    m.container = document.createElement('div');
    m.webglCanvas = document.createElement('canvas');
    await m.start();
    return m;
}

describe('frame limiter (fix b)', () => {
    it('renders ~30 fps when idle on a 120 Hz display', async () => {
        const core = fakeCore();
        const m = await started(core);
        run(m, 120, 1000);
        expect(core.render.mock.calls.length).toBeGreaterThanOrEqual(28);
        expect(core.render.mock.calls.length).toBeLessThanOrEqual(31);
    });

    it('renders ~60 fps while a gesture is active on a 120 Hz display', async () => {
        const core = fakeCore({ active: () => true });
        const m = await started(core);
        run(m, 120, 1000);
        expect(core.render.mock.calls.length).toBeGreaterThanOrEqual(58);
        expect(core.render.mock.calls.length).toBeLessThanOrEqual(61);
    });

    it('advances animation time by the whole elapsed time, not per rendered frame', async () => {
        const core = fakeCore();
        const m = await started(core);
        run(m, 120, 1000);
        const total = core.render.mock.calls.reduce((s, c) => s + c[0], 0);
        expect(total).toBeGreaterThan(950);
        expect(total).toBeLessThan(1010);
    });
});

describe('visibility pause (fix b)', () => {
    const setHidden = hidden => {
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
        document.dispatchEvent(new Event('visibilitychange'));
    };
    afterEach(() => setHidden(false));

    it('stops when the page is hidden and resumes when shown', async () => {
        const core = fakeCore();
        const m = await started(core);
        expect(m.isRunning).toBe(true);
        setHidden(true);
        expect(m.isRunning).toBe(false);
        setHidden(false);
        await Promise.resolve();
        await Promise.resolve();
        expect(m.isRunning).toBe(true);
    });

    it('does not resume a mascot the host stopped', async () => {
        const m = await started(fakeCore());
        m.stop();
        setHidden(true);
        setHidden(false);
        await Promise.resolve();
        expect(m.isRunning).toBe(false);
    });
});
