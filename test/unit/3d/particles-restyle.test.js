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

describe('particle size and surface (round 2: the particles were invisible on phones)', () => {
    const vs = () => new Particle3DRenderer(10).material.vertexShader;
    it('gl_PointSize is in drawing-buffer pixels: it multiplies by the pixel ratio', () => {
        expect(vs()).toMatch(/\* pixelRatio \* sizeK/);
        expect(vs()).not.toMatch(/\/ pixelRatio/);
    });
    it('no sprite is drawn as a hollow ring (the stock bokeh ring)', () => {
        expect(fs()).not.toMatch(/smoothstep\(0\.20, 0\.28, dist\)/);
    });
    it('follows the page surface live (ink sparks on a light page)', async () => {
        const { setSurface } = await import('../../../src/3d/materials/surface.js');
        const r = new Particle3DRenderer(10);
        expect(fs()).toMatch(/uniform float uSurface;/);
        setSurface('light');
        expect(r.material.uniforms.uSurface.value).toBe(1);
        setSurface('dark');
        expect(r.material.uniforms.uSurface.value).toBe(0);
        r.dispose();
        setSurface('light');
        expect(r.material.uniforms.uSurface.value).toBe(0);
        setSurface('dark');
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
