// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { fetchFixture } from '../../helpers/fixtureFetch.js';
import { linkCore } from '../../helpers/linkCore.js';

// Round 2: the emotion drives the CORE colour (and the particles) on top of the look's glass;
// the core's glow does not step with the emotion; the refusal ruby takes the core off the
// emotion and gives it back.
vi.mock('three', async importOriginal => {
    const THREE = await importOriginal();
    const { makeFakeRendererClass } = await import('../../helpers/fakeWebGLRenderer.js');
    return { ...THREE, WebGLRenderer: makeFakeRendererClass(THREE) };
});

await import('../../../src/3d/index-hex-agent.js');
const { Core3DManager, CORE_SHIFT_MIN_MS, CORE_REST_GLOW } = await import('../../../src/3d/Core3DManager.js');
const { EmotiveMascot3D } = await import('../../../src/3d/index.js');
const { LOOKS, BASE_LOOK } = await import('../../../src/3d/presets/looks.js');
const { getCrystalShaders } = await import('../../../src/3d/shaders/crystalWithSoul.js');
const { listEmotions } = await import('../../../src/core/emotions/index.js');

const canvas = () => Object.assign(document.createElement('canvas'), { width: 300, height: 200 });
beforeAll(() => {
    globalThis.fetch = fetchFixture;
});
afterEach(() => vi.restoreAllMocks());

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
const rgb = u => [u.emotionColor.value.r, u.emotionColor.value.g, u.emotionColor.value.b];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe('emotion drives the core', () => {
    it('every look lets the emotion drive the core (uEmotion = 1)', () => {
        for (const look of Object.values(LOOKS)) expect(look.uEmotion).toBe(1);
    });

    it('the shader mixes the core toward the emotion colour, lifting dark hues', () => {
        const fs = getCrystalShaders().fragmentShader;
        expect(fs).toMatch(/uniform float uEmotion;/);
        expect(fs).toMatch(/mix\(mix\(hue, uCore, uCoreMix\), emo, uEmotion\)/);
        expect(fs).toMatch(/clamp\(0\.62 \/ max\(dot\(emo, LUM\)/);
    });

    it('the fork keeps all fifteen emotions, each with its own colour', () => {
        expect(listEmotions().length).toBe(15);
        const m = new EmotiveMascot3D({ assetBasePath: '/agent' });
        expect(m.getAvailableEmotions()).toEqual(listEmotions());
        for (const e of listEmotions()) expect(m.getEmotionColor(e)).toMatch(/^#[0-9A-F]{6}$/i);
        expect(m.getEmotionColor('nope')).toBe(null);
    });

    it('the emotion colour shifts smoothly, never faster than CORE_SHIFT_MIN_MS', async () => {
        const m = await mascot();
        const u = m.core3D.customMaterial.uniforms;
        m.setEmotion('neutral');
        step(m, 1000);
        const from = rgb(u);
        m.setEmotion('love');
        step(m, CORE_SHIFT_MIN_MS * 0.3);
        const mid = rgb(u);
        step(m, CORE_SHIFT_MIN_MS * 0.9);
        const to = rgb(u);
        expect(dist(from, to)).toBeGreaterThan(0.1);
        expect(dist(mid, from)).toBeGreaterThan(0.005);
        expect(dist(mid, to)).toBeGreaterThan(0.005);
        step(m, 200);
        expect(dist(rgb(u), to)).toBeLessThan(1e-6);
        await m.destroy();
    });

    it('the core glow does not step with the emotion (no stock per-colour boost)', async () => {
        const m = await mascot();
        const u = m.core3D.customMaterial.uniforms;
        const seen = [];
        for (const e of ['joy', 'fear', 'suspicion', 'surprise', 'neutral']) {
            m.setEmotion(e);
            step(m, 50);
            seen.push(u.glowIntensity.value);
        }
        // The emotion's own animation still breathes the glow a little; the stock boost would
        // spread these 0.62 (joy) to 4.4 (suspicion), a 7x step.
        for (const v of seen) {
            expect(v).toBeGreaterThan(CORE_REST_GLOW * 0.7);
            expect(v).toBeLessThan(CORE_REST_GLOW * 1.6);
        }
        expect(Math.max(...seen) / Math.min(...seen)).toBeLessThan(1.4);
        await m.destroy();
    });

    it('the refusal ruby takes the core off the emotion, and gives it back', async () => {
        const m = await mascot();
        const u = m.core3D.customMaterial.uniforms;
        m.setGemColor('ruby', 600);
        step(m, 700);
        expect(u.uEmotion.value).toBeCloseTo(0, 5);
        m.setGemColor(null, 600);
        step(m, 700);
        expect(u.uEmotion.value).toBeCloseTo(LOOKS[BASE_LOOK].uEmotion, 5);
        await m.destroy();
    });
});
