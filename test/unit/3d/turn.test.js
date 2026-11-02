// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { fetchFixture } from '../../helpers/fixtureFetch.js';
import { linkCore } from '../../helpers/linkCore.js';

// turn(rad, ms): a calm, eased yaw about the gem's own vertical axis that adds to the ambient
// spin and stays (the hex agent's "deciding" option C). It never flicks: at least TURN_MIN_MS.
vi.mock('three', async importOriginal => {
    const THREE = await importOriginal();
    const { makeFakeRendererClass } = await import('../../helpers/fakeWebGLRenderer.js');
    return { ...THREE, WebGLRenderer: makeFakeRendererClass(THREE) };
});

const { Core3DManager } = await import('../../../src/3d/Core3DManager.js');
const { EmotiveMascot3D, TURN_MIN_MS } = await import('../../../src/3d/index.js');

const canvas = () => Object.assign(document.createElement('canvas'), { width: 300, height: 200 });
beforeAll(() => {
    globalThis.fetch = fetchFixture;
});

async function mascot() {
    const m = new EmotiveMascot3D({ assetBasePath: '/agent', autoRotate: false });
    m.core3D = new Core3DManager(canvas(), { geometry: 'hexgem', assetBasePath: '/agent', preloadElements: [], autoRotate: false });
    m._wireCore();
    await linkCore(m.core3D);
    m.disableAutoRotate();
    return m;
}
const step = (m, ms, dt = 10) => {
    for (let t = 0; t < ms; t += dt) m.core3D.render(dt);
};
const yaw = m => m.core3D.baseEuler[1];

describe('turn(rad, ms)', () => {
    it('adds rad to the yaw over ms, eased, and keeps it', async () => {
        const m = await mascot();
        step(m, 50);
        const y0 = yaw(m);
        m.turn(Math.PI / 2, 1000);
        step(m, 100);
        const early = yaw(m) - y0;
        expect(early).toBeGreaterThan(0);
        expect(early).toBeLessThan((Math.PI / 2) * 0.1); // eased in: slow at the start
        step(m, 400);
        const mid = yaw(m) - y0;
        expect(mid).toBeGreaterThan((Math.PI / 2) * 0.35);
        expect(mid).toBeLessThan((Math.PI / 2) * 0.65);
        step(m, 520);
        expect(yaw(m) - y0).toBeCloseTo(Math.PI / 2, 5);
        step(m, 500);
        expect(yaw(m) - y0).toBeCloseTo(Math.PI / 2, 5); // stays: no spring back
        await m.destroy();
    });

    it('moves only the yaw (no pitch, no roll: nothing side to side)', async () => {
        const m = await mascot();
        step(m, 50);
        const [p0, , r0] = m.core3D.baseEuler;
        m.turn(Math.PI / 2, 800);
        for (let i = 0; i < 90; i++) {
            step(m, 10);
            expect(m.core3D.baseEuler[0]).toBeCloseTo(p0, 6);
            expect(m.core3D.baseEuler[2]).toBeCloseTo(r0, 6);
        }
        await m.destroy();
    });

    it(`never completes faster than TURN_MIN_MS`, async () => {
        expect(TURN_MIN_MS).toBeGreaterThanOrEqual(400);
        const m = await mascot();
        step(m, 50);
        const y0 = yaw(m);
        m.turn(Math.PI / 2, 0);
        step(m, TURN_MIN_MS / 2);
        expect(yaw(m) - y0).toBeLessThan((Math.PI / 2) * 0.75);
        step(m, TURN_MIN_MS / 2 + 20);
        expect(yaw(m) - y0).toBeCloseTo(Math.PI / 2, 5);
        await m.destroy();
    });

    it('ignores a non-finite angle', async () => {
        const m = await mascot();
        step(m, 50);
        const y0 = yaw(m);
        m.turn(NaN, 500);
        step(m, 600);
        expect(yaw(m)).toBeCloseTo(y0, 6);
        await m.destroy();
    });
});
