// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { fetchFixture } from '../../helpers/fixtureFetch.js';
import { linkCore } from '../../helpers/linkCore.js';

// The look round: three looks (sapphire, quartz, ruby-violet) selectable at runtime with
// setLook(name, ms); the refusal's slow ruby works from every look and returns to that look.
vi.mock('three', async importOriginal => {
    const THREE = await importOriginal();
    const { makeFakeRendererClass } = await import('../../helpers/fakeWebGLRenderer.js');
    return { ...THREE, WebGLRenderer: makeFakeRendererClass(THREE) };
});

const { Core3DManager } = await import('../../../src/3d/Core3DManager.js');
const { EmotiveMascot3D } = await import('../../../src/3d/index.js');
const { SSSPresets, BASE_GEM, GEM_SHIFT_MIN_MS } = await import('../../../src/3d/presets/SSSPresets.js');
const { LOOKS, BASE_LOOK, LOOK_SCALARS } = await import('../../../src/3d/presets/looks.js');
const { getCrystalShaders } = await import('../../../src/3d/shaders/crystalWithSoul.js');
const { DEFAULT_CAMERA_DISTANCE } = await import('../../../src/3d/ThreeRenderer.js');

const canvas = () => Object.assign(document.createElement('canvas'), { width: 300, height: 200 });
beforeAll(() => {
    globalThis.fetch = fetchFixture;
});

async function mascot(config = {}) {
    const m = new EmotiveMascot3D({ assetBasePath: '/agent', ...config });
    m.core3D = new Core3DManager(canvas(), { geometry: 'hexgem', assetBasePath: '/agent', preloadElements: [] });
    m._wireCore();
    await linkCore(m.core3D);
    return m;
}
const step = (m, ms, dt = 10) => {
    for (let t = 0; t < ms; t += dt) m.core3D.render(dt);
};
const expectLook = (u, look) => {
    for (const k of LOOK_SCALARS) expect(u[k].value).toBeCloseTo(look[k], 5);
    expect(u.uCore.value.x).toBeCloseTo(look.uCore[0], 5);
    expect(u.uCore.value.z).toBeCloseTo(look.uCore[2], 5);
    expect(u.uRimInk.value.r).toBeCloseTo(look.uRimInk[0], 5);
};
const expectGem = (u, p) => {
    expect(u.sssStrength.value).toBeCloseTo(p.sssStrength, 5);
    expect(u.sssAbsorption.value.x).toBeCloseTo(p.sssAbsorption[0], 5);
    expect(u.sssAbsorption.value.z).toBeCloseTo(p.sssAbsorption[2], 5);
    expect(u.innerGlowStrength.value).toBeCloseTo(p.innerGlowStrength, 5);
};

describe('LOOKS', () => {
    it('has the three picked looks, each on a registered gem preset', () => {
        expect(Object.keys(LOOKS)).toEqual(['sapphire', 'quartz', 'ruby-violet']);
        for (const look of Object.values(LOOKS)) expect(SSSPresets[look.gem]).toBeTruthy();
    });

    it('the base look sits on the base gem', () => {
        expect(LOOKS[BASE_LOOK].gem).toBe(BASE_GEM);
    });

    it('a fresh crystal starts on the base look with no host call', async () => {
        const m = await mascot();
        expect(m.getLook()).toBe(BASE_LOOK);
        expectLook(m.core3D.customMaterial.uniforms, LOOKS[BASE_LOOK]);
        await m.destroy();
    });

    it('config.look starts the crystal on that look', async () => {
        const m = await mascot({ look: 'quartz' });
        await new Promise(r => setTimeout(r, 0));
        expect(m.getLook()).toBe('quartz');
        expectLook(m.core3D.customMaterial.uniforms, LOOKS.quartz);
        expectGem(m.core3D.customMaterial.uniforms, SSSPresets.quartz);
        await m.destroy();
    });
});

describe('setLook(name, ms)', () => {
    it('ramps the look and its gem over ms, lands exactly, emits look:change', async () => {
        const m = await mascot();
        const ev = [];
        m.eventManager.on('look:change', d => ev.push(d));
        const u = m.core3D.customMaterial.uniforms;
        expect(m.setLook('quartz', 800)).toBe(true);
        step(m, 200);
        expect(u.uClarity.value).toBeGreaterThan(0);
        expect(u.uClarity.value).toBeLessThan(LOOKS.quartz.uClarity);
        step(m, 700);
        expectLook(u, LOOKS.quartz);
        expectGem(u, SSSPresets.quartz);
        expect(m.getGemColor()).toBe('quartz');
        expect(ev.at(-1)).toEqual({ look: 'quartz', durationMs: 800 });
        await m.destroy();
    });

    it(`never switches faster than GEM_SHIFT_MIN_MS (flash safety)`, async () => {
        const m = await mascot();
        const u = m.core3D.customMaterial.uniforms;
        m.setLook('ruby-violet', 0);
        step(m, GEM_SHIFT_MIN_MS * 0.4);
        expect(u.uRimInk.value.r).toBeLessThan(LOOKS['ruby-violet'].uRimInk[0] - 0.01);
        step(m, GEM_SHIFT_MIN_MS * 0.7);
        expectLook(u, LOOKS['ruby-violet']);
        await m.destroy();
    });

    it('an unknown look is refused and changes nothing', async () => {
        const m = await mascot();
        expect(m.setLook('opal', 500)).toBe(false);
        step(m, 600);
        expect(m.getLook()).toBe(BASE_LOOK);
        expectLook(m.core3D.customMaterial.uniforms, LOOKS[BASE_LOOK]);
        await m.destroy();
    });

    it('survives a morph (the new material carries the current look)', async () => {
        const m = await mascot();
        m.setLook('ruby-violet', 500);
        step(m, 600);
        m.morphTo('split', { duration: 100 });
        for (let i = 0; i < 200 && (m.core3D.isMorphing() || m.core3D._targetGeometryType); i++) {
            m.core3D.render(16);
            await new Promise(r => setTimeout(r, 0));
        }
        expect(m.core3D.geometryType).toBe('split');
        expectLook(m.core3D.customMaterial.uniforms, LOOKS['ruby-violet']);
        expectGem(m.core3D.customMaterial.uniforms, SSSPresets['ruby-violet']);
        await m.destroy();
    });

    for (const name of Object.keys(LOOKS)) {
        it(`refusal from ${name}: slow ruby (core follows the gem), then back to ${name}`, async () => {
            const m = await mascot();
            const u = m.core3D.customMaterial.uniforms;
            m.setLook(name, 500);
            step(m, 600);
            m.setGemColor('ruby', 700);
            step(m, 300);
            expect(u.sssAbsorption.value.x).toBeLessThan(SSSPresets.ruby.sssAbsorption[0]);
            step(m, 500);
            expectGem(u, SSSPresets.ruby);
            expect(u.uCoreMix.value).toBeCloseTo(0, 5);
            m.setGemColor(null, 700);
            step(m, 800);
            expect(m.getGemColor()).toBe(LOOKS[name].gem);
            expectGem(u, SSSPresets[LOOKS[name].gem]);
            expectLook(u, LOOKS[name]);
            await m.destroy();
        });
    }
});

describe('crystal shader look model', () => {
    const fs = getCrystalShaders().fragmentShader;
    it('declares the look uniforms', () => {
        for (const k of ['uEnv', 'uBody', 'uDepth', 'uCoreMix', 'uClarity']) expect(fs).toMatch(new RegExp(`uniform float ${k};`));
        expect(fs).toMatch(/uniform vec3 uCore;/);
    });
    it('never adds the detail map as colour (its channels drive normals, path and edges)', () => {
        expect(fs).not.toMatch(/texColor/);
        expect(fs).not.toMatch(/det\.rgb/);
        expect(fs).toMatch(/det\.r\b/);
        expect(fs).toMatch(/det\.g\b/);
        expect(fs).toMatch(/det\.b\b/);
    });
    it('frames the gem at about half the stage height by default', () => {
        // shellScale 2 x base 0.16 x max dim 1.6 over the visible height at fov 45
        const h = 2 * DEFAULT_CAMERA_DISTANCE * Math.tan((45 / 2) * (Math.PI / 180));
        const frac = (1.6 * 0.16 * 2) / h;
        expect(frac).toBeGreaterThan(0.45);
        expect(frac).toBeLessThan(0.55);
    });
});
