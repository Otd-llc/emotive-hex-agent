// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';

// P2a item 5 (D8): particles kept and restyled: tone mapping + sRGB output chunks, a soft
// sprite falloff (in-shader glow, no bloom), per-emotion behaviour unchanged.
const { Particle3DRenderer } = await import('../../../src/3d/particles/Particle3DRenderer.js');
const { ParticleEmotionCalculator } = await import('../../../src/3d/particles/ParticleEmotionCalculator.js');

const fs = () => new Particle3DRenderer(10).material.fragmentShader;

describe('particle fragment shader', () => {
    it('ends with three tone mapping + colour space chunks, then premultiplies', () => {
        const s = fs();
        const tm = s.indexOf('#include <tonemapping_fragment>');
        const cs = s.indexOf('#include <colorspace_fragment>');
        const pm = s.lastIndexOf('gl_FragColor.rgb *= gl_FragColor.a');
        expect(tm).toBeGreaterThan(0);
        expect(cs).toBeGreaterThan(tm);
        expect(pm).toBeGreaterThan(cs);
    });

    it('has a soft falloff (smooth glow), not only a hard disc cut', () => {
        const s = fs();
        expect(s).toMatch(/exp\(-/);
        expect(s).toMatch(/smoothstep\(/);
    });
});

describe('per-emotion behaviour kept', () => {
    it('different emotions keep different particle behaviours', () => {
        const c = new ParticleEmotionCalculator();
        const b = e => c.calculate(e).behavior;
        expect(b('joy')).toBe('popcorn');
        expect(b('sadness')).toBe('falling');
        expect(b('focused')).toBe('directed');
        expect(b('resting')).toBe('resting');
    });
});
