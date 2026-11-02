// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { fetchFixture } from '../../helpers/fixtureFetch.js';

// P2a item 3: a `hexgem` base preset applied at mount (no host call needed), and
// setGemColor(preset, ms): a timed shift (>= 500 ms, the flash-safety floor) and back to base.
vi.mock('three', async importOriginal => {
    const THREE = await importOriginal();
    const { makeFakeRendererClass } = await import('../../helpers/fakeWebGLRenderer.js');
    return { ...THREE, WebGLRenderer: makeFakeRendererClass(THREE) };
});

const { Core3DManager } = await import('../../../src/3d/Core3DManager.js');
const { EmotiveMascot3D } = await import('../../../src/3d/index.js');
const { SSSPresets, BASE_GEM, GEM_SHIFT_MIN_MS } = await import('../../../src/3d/presets/SSSPresets.js');

const canvas = () => Object.assign(document.createElement('canvas'), { width: 300, height: 200 });
beforeAll(() => {
    globalThis.fetch = fetchFixture;
});

const KEYS = Object.keys(SSSPresets.sapphire);
const read = u => ({
    sssStrength: u.sssStrength.value,
    absR: u.sssAbsorption.value.x,
    absG: u.sssAbsorption.value.y,
    absB: u.sssAbsorption.value.z,
    emotionColorBleed: u.emotionColorBleed.value,
    frostiness: u.frostiness.value,
});
const expectPreset = (u, p) => {
    expect(u.sssStrength.value).toBeCloseTo(p.sssStrength, 5);
    expect(u.sssAbsorption.value.x).toBeCloseTo(p.sssAbsorption[0], 5);
    expect(u.sssAbsorption.value.y).toBeCloseTo(p.sssAbsorption[1], 5);
    expect(u.sssAbsorption.value.z).toBeCloseTo(p.sssAbsorption[2], 5);
    expect(u.frostiness.value).toBeCloseTo(p.frostiness, 5);
    expect(u.emotionColorBleed.value).toBeCloseTo(p.emotionColorBleed, 5);
};

async function mascot() {
    const m = new EmotiveMascot3D({ assetBasePath: '/agent' });
    // jsdom has no WebGL 2, so init() bails; wire a core directly (as init would).
    m.core3D = new Core3DManager(canvas(), { geometry: 'hexgem', assetBasePath: '/agent' });
    m._wireCore();
    await m.core3D.waitUntilReady();
    return m;
}
const step = (m, ms, dt = 10) => {
    for (let t = 0; t < ms; t += dt) m.core3D.render(dt);
};

describe('hexgem base preset', () => {
    it('is registered with every key sapphire has (sapphire values to start)', () => {
        expect(BASE_GEM).toBe('hexgem');
        expect(Object.keys(SSSPresets.hexgem).sort()).toEqual(KEYS.sort());
    });

    it('is on the crystal from the first frame, with no host call', async () => {
        const c = new Core3DManager(canvas(), { geometry: 'hexgem', assetBasePath: '/agent' });
        await c.waitUntilReady();
        expectPreset(c.customMaterial.uniforms, SSSPresets.hexgem);
        await c.destroy();
    });

    it('survives a morph (the new material starts on the base preset too)', async () => {
        const m = await mascot();
        m.morphTo('split', { duration: 100 });
        for (let i = 0; i < 200 && (m.core3D.isMorphing() || m.core3D._targetGeometryType); i++) {
            m.core3D.render(16);
            await new Promise(r => setTimeout(r, 0));
        }
        expect(m.core3D.geometryType).toBe('split');
        expectPreset(m.core3D.customMaterial.uniforms, SSSPresets.hexgem);
        await m.destroy();
    });
});

describe('setGemColor(preset, ms)', () => {
    it('shifts over the given duration (not instantly), lands exactly, emits', async () => {
        const m = await mascot();
        const ev = [];
        m.eventManager.on('sss:presetChanged', d => ev.push(d));
        const u = m.core3D.customMaterial.uniforms;
        const before = read(u);
        expect(m.setGemColor('ruby', 800)).toBe(true);
        step(m, 100);
        const early = read(u);
        expect(early.absR).toBeGreaterThan(before.absR);
        expect(early.absR).toBeLessThan(SSSPresets.ruby.sssAbsorption[0] - 0.5);
        step(m, 800);
        expectPreset(u, SSSPresets.ruby);
        expect(ev.at(-1)).toMatchObject({ preset: 'ruby', durationMs: 800 });
        await m.destroy();
    });

    it(`never shifts faster than ${'GEM_SHIFT_MIN_MS'} (flash safety): 0 and 100 ms become the floor`, async () => {
        expect(GEM_SHIFT_MIN_MS).toBeGreaterThanOrEqual(500);
        for (const ms of [0, 100]) {
            const m = await mascot();
            const u = m.core3D.customMaterial.uniforms;
            m.setGemColor('ruby', ms);
            step(m, GEM_SHIFT_MIN_MS * 0.5);
            expect(u.sssAbsorption.value.x).toBeLessThan(SSSPresets.ruby.sssAbsorption[0] - 0.3);
            step(m, GEM_SHIFT_MIN_MS * 0.6);
            expectPreset(u, SSSPresets.ruby);
            await m.destroy();
        }
    });

    it('returns to the base gem with setGemColor(null, ms)', async () => {
        const m = await mascot();
        const u = m.core3D.customMaterial.uniforms;
        m.setGemColor('ruby', 500);
        step(m, 600);
        m.setGemColor(null, 600);
        step(m, 300);
        expect(u.sssAbsorption.value.x).toBeGreaterThan(SSSPresets.hexgem.sssAbsorption[0]);
        step(m, 400);
        expectPreset(u, SSSPresets.hexgem);
        await m.destroy();
    });

    it('an unknown preset is refused and changes nothing', async () => {
        const m = await mascot();
        const u = m.core3D.customMaterial.uniforms;
        const before = read(u);
        expect(m.setGemColor('nope', 500)).toBe(false);
        step(m, 600);
        expect(read(u)).toEqual(before);
        await m.destroy();
    });
});
