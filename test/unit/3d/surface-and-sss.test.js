// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';

// Fix (d): setSurface() works live (no remount) incl. a uSurface uniform on the crystal
// shader; the SSS preset is re-applied synchronously on material swap (no 50 ms timeout).
const { setSurface, getSurface } = await import('../../../src/3d/materials/surface.js');
const { createCustomMaterial } = await import('../../../src/3d/utils/MaterialFactory.js');
const { THREE_GEOMETRIES } = await import('../../../src/3d/geometries/ThreeGeometries.js');
const { getCrystalShaders } = await import('../../../src/3d/shaders/crystalWithSoul.js');
const { SSSPresets } = await import('../../../src/3d/presets/SSSPresets.js');
const { EmotiveMascot3D } = await import('../../../src/3d/index.js');

const crystal = () =>
    createCustomMaterial('hexgem', THREE_GEOMETRIES.hexgem, { assetBasePath: '/x' }).material;

afterEach(() => setSurface('dark'));

describe('uSurface on the crystal (fix d)', () => {
    it('the crystal fragment shader declares and uses uSurface', () => {
        const fs = getCrystalShaders().fragmentShader;
        expect(fs).toMatch(/uniform float uSurface;/);
        expect(fs.split('uSurface').length).toBeGreaterThan(2);
    });

    it('a new crystal material starts on the current surface', () => {
        setSurface('light');
        expect(crystal().uniforms.uSurface.value).toBe(1);
        setSurface('dark');
        expect(crystal().uniforms.uSurface.value).toBe(0);
    });

    it('setSurface flips a live crystal material without a remount', () => {
        const m = crystal();
        expect(getSurface()).toBe('dark');
        setSurface('light');
        expect(m.uniforms.uSurface.value).toBe(1);
        setSurface('dark');
        expect(m.uniforms.uSurface.value).toBe(0);
    });

    it('a disposed crystal material stops listening', () => {
        const m = crystal();
        m.dispose();
        setSurface('light');
        expect(m.uniforms.uSurface.value).toBe(0);
    });
});

describe('SSS preset survives a material swap synchronously (fix d)', () => {
    it('re-applies the current preset inside onMaterialSwap, before any timer runs', () => {
        vi.useFakeTimers();
        try {
            const m = new EmotiveMascot3D({ assetBasePath: '/x/' });
            m.core3D = { customMaterial: crystal() };
            expect(m.setSSSPreset('ruby', { immediate: true })).toBe(true);

            // Morph midpoint: a fresh crystal material replaces the old one.
            const fresh = crystal();
            m.core3D.customMaterial = fresh;
            m.core3D.onMaterialSwap({ material: fresh });

            const ruby = SSSPresets.ruby;
            expect(fresh.uniforms.sssStrength.value).toBeCloseTo(ruby.sssStrength);
            expect(fresh.uniforms.sssAbsorption.value.x).toBeCloseTo(ruby.sssAbsorption[0]);
            expect(fresh.uniforms.emotionColorBleed.value).toBeCloseTo(ruby.emotionColorBleed);
            expect(vi.getTimerCount()).toBe(0);
        } finally {
            vi.useRealTimers();
        }
    });
});
