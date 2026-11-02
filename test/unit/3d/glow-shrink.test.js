// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { fetchFixture } from '../../helpers/fixtureFetch.js';
import { linkCore } from '../../helpers/linkCore.js';

// P2a items 6 + 7: in-shader glow the host drives (setGlow(level, ms)), a darker rim on the
// light surface, and shrinkOut(ms) mirroring growIn.
vi.mock('three', async importOriginal => {
    const THREE = await importOriginal();
    const { makeFakeRendererClass } = await import('../../helpers/fakeWebGLRenderer.js');
    return { ...THREE, WebGLRenderer: makeFakeRendererClass(THREE) };
});

const clock = await import('../../../src/3d/utils/clock.js');
const { GeometryMorpher } = await import('../../../src/3d/utils/GeometryMorpher.js');
const { getCrystalShaders } = await import('../../../src/3d/shaders/crystalWithSoul.js');
const { Core3DManager } = await import('../../../src/3d/Core3DManager.js');
const { EmotiveMascot3D } = await import('../../../src/3d/index.js');
const { GLOW_MIN_MS } = await import('../../../src/3d/index.js');

const canvas = () => Object.assign(document.createElement('canvas'), { width: 300, height: 200 });
beforeAll(() => {
    globalThis.fetch = fetchFixture;
});
afterEach(() => clock.exitStepMode());

async function mascot() {
    const m = new EmotiveMascot3D({ assetBasePath: '/agent' });
    m.core3D = new Core3DManager(canvas(), { geometry: 'hexgem', assetBasePath: '/agent', preloadElements: [] });
    m._wireCore();
    await linkCore(m.core3D);
    return m;
}
const step = (m, ms, dt = 10) => {
    for (let t = 0; t < ms; t += dt) m.core3D.render(dt);
};

describe('crystal shader glow + light rim', () => {
    const fs = getCrystalShaders().fragmentShader;
    it('declares host-driven glow and rim uniforms and uses them', () => {
        expect(fs).toMatch(/uniform float uGlow;/);
        expect(fs).toMatch(/uniform float uRim;/);
        expect(fs.split('uGlow').length).toBeGreaterThan(3);
        expect(fs.split('uRim').length).toBeGreaterThan(2);
    });
    it('darkens the rim on the light surface (ink rim weighted by fresnel)', () => {
        expect(fs).toMatch(/uRimInk/);
        expect(fs).toMatch(/fresnel[^;]*uSurface|uSurface[^;]*fresnel/);
    });
    it('has an optional matcap path only if a sampler exists (off by default)', () => {
        // not built in P2a: no matcap sampler is declared
        expect(fs).not.toMatch(/uniform sampler2D uMatcap/);
    });
});

describe('setGlow(level, ms)', () => {
    it('ramps uGlow to the level over ms', async () => {
        const m = await mascot();
        const u = m.core3D.customMaterial.uniforms;
        expect(u.uGlow.value).toBe(1);
        m.setGlow(2, 400);
        step(m, 200);
        expect(u.uGlow.value).toBeGreaterThan(1.2);
        expect(u.uGlow.value).toBeLessThan(1.95);
        step(m, 250);
        expect(u.uGlow.value).toBeCloseTo(2, 5);
        await m.destroy();
    });

    it(`never changes faster than GLOW_MIN_MS (flash safety)`, async () => {
        expect(GLOW_MIN_MS).toBeGreaterThanOrEqual(250);
        const m = await mascot();
        const u = m.core3D.customMaterial.uniforms;
        m.setGlow(0.2, 0);
        step(m, 20);
        expect(u.uGlow.value).toBeGreaterThan(0.5);
        step(m, GLOW_MIN_MS);
        expect(u.uGlow.value).toBeCloseTo(0.2, 5);
        await m.destroy();
    });

    it('survives a morph (same material, value kept)', async () => {
        const m = await mascot();
        m.setGlow(1.5, 300);
        step(m, 400);
        m.morphTo('rosette', { duration: 100 });
        for (let i = 0; i < 200 && (m.core3D.isMorphing() || m.core3D._targetGeometryType); i++) {
            m.core3D.render(16);
            await new Promise(r => setTimeout(r, 0));
        }
        expect(m.core3D.customMaterial.uniforms.uGlow.value).toBeCloseTo(1.5, 5);
        await m.destroy();
    });
});

describe('shrinkOut(ms) mirrors growIn', () => {
    const sample = (start, ms, p) => {
        clock.enterStepMode();
        const g = new GeometryMorpher();
        start(g, ms);
        clock.advance(ms * p);
        return g.update(0).scaleMultiplier;
    };
    it('scale(t) of shrinkOut equals scale(1 - t) of growIn', () => {
        for (const p of [0, 0.1, 0.3, 0.5, 0.7, 0.9]) {
            const s = sample((g, ms) => g.shrinkOut('hexgem', ms), 500, p);
            const gIn = sample((g, ms) => g.growIn('hexgem', ms), 500, 1 - p);
            expect(s).toBeCloseTo(gIn, 6);
        }
    });

    it('stays hidden (scale 0) after it ends, until growIn', () => {
        clock.enterStepMode();
        const g = new GeometryMorpher();
        g.shrinkOut('hexgem', 300);
        clock.advance(400);
        g.update(0);
        clock.advance(1000);
        expect(g.update(0).scaleMultiplier).toBe(0);
        g.growIn('hexgem', 300);
        clock.advance(400);
        g.update(0);
        expect(g.update(0).scaleMultiplier).toBe(1);
    });

    it('the mascot API emits animation:shrinkOut', async () => {
        const m = await mascot();
        const ev = [];
        m.eventManager.on('animation:shrinkOut', d => ev.push(d));
        m.shrinkOut(400);
        expect(ev).toEqual([{ duration: 400 }]);
        await m.destroy();
    });
});
