// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Fix (c): ONE render path, no EffectComposer. Soul (layer 2) into its own render target
// sized to the drawing buffer, camera layers back to 0, then the scene to the canvas.
vi.mock('three', async importOriginal => {
    const THREE = await importOriginal();
    const { makeFakeRendererClass } = await import('../../helpers/fakeWebGLRenderer.js');
    return { ...THREE, WebGLRenderer: makeFakeRendererClass(THREE, { bufferW: 300, bufferH: 200 }) };
});

const THREE = await import('three');
const { ThreeRenderer } = await import('../../../src/3d/ThreeRenderer.js');
const { getCrystalShaders } = await import('../../../src/3d/shaders/crystalWithSoul.js');
const { createInstancedElectricMaterial } = await import(
    '../../../src/3d/materials/instanced/InstancedElectricMaterial.js'
);

function makeRenderer() {
    const canvas = document.createElement('canvas');
    canvas.width = 300;
    canvas.height = 200;
    const r = new ThreeRenderer(canvas, { assetBasePath: '/x/' });
    const mat = new THREE.ShaderMaterial({
        uniforms: {
            soulTexture: { value: null },
            soulTextureSize: { value: new THREE.Vector2() },
            soulScreenCenter: { value: new THREE.Vector2() },
        },
    });
    r.createCoreMesh(new THREE.BoxGeometry(), mat);
    const soul = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    soul.name = 'crystalSoul';
    soul.layers.set(2);
    r.scene.add(soul);
    return r;
}

describe('single render path (fix c)', () => {
    let r;
    beforeEach(() => {
        r = makeRenderer();
    });

    it('builds no EffectComposer and no post passes', () => {
        expect(r.composer).toBeFalsy();
        expect(r.bloomPass).toBeFalsy();
        expect(r.motionBlurPass).toBeFalsy();
        expect(r.aoPass).toBeFalsy();
    });

    it('renders soul (layer 2) into its own target sized to the drawing buffer, then the scene on layer 0', () => {
        r.render({ hasSoul: true, hasParticles: false }); // first frame only clears
        const gl = r.renderer;
        gl.log.length = 0;
        r.render({ hasSoul: true, hasParticles: false });

        const renders = gl.log.filter(e => e.fn === 'render');
        expect(renders.length).toBe(2);
        const [soulPass, scenePass] = renders;
        expect(soulPass.layers).toBe(1 << 2);
        expect(soulPass.target).toBeTruthy();
        expect(soulPass.target.width).toBe(300);
        expect(soulPass.target.height).toBe(200);
        expect(scenePass.target).toBeNull();
        expect(scenePass.layers & 1).toBe(1);
        expect(scenePass.layers & (1 << 2)).toBe(0);
        expect(r.coreMesh.material.uniforms.soulTexture.value).toBe(soulPass.target.texture);
        expect(r.camera.layers.mask).toBe(1);
    });

    it('draws particles (layer 1) after the scene, still to the canvas, when present', () => {
        r.render({ hasSoul: true, hasParticles: true });
        const gl = r.renderer;
        gl.log.length = 0;
        r.render({ hasSoul: true, hasParticles: true });
        const renders = gl.log.filter(e => e.fn === 'render');
        const last = renders[renders.length - 1];
        expect(last.target).toBeNull();
        expect(last.layers).toBe(1 << 1);
        expect(r.camera.layers.mask).toBe(1);
    });

    it('resize keeps the soul target at the drawing-buffer size', () => {
        r.render({ hasSoul: true });
        r.render({ hasSoul: true });
        r.resize(300, 200);
        expect(r.soulRenderTarget.width).toBe(300);
        expect(r.soulRenderTarget.height).toBe(200);
    });
});

describe('shaders encode their own output (fix c)', () => {
    const tail = src => src.slice(src.lastIndexOf('gl_FragColor ='));

    it('crystal fragment ends with tonemapping + colorspace chunks', () => {
        const fs = getCrystalShaders().fragmentShader;
        const t = tail(fs);
        expect(t).toContain('#include <tonemapping_fragment>');
        expect(t).toContain('#include <colorspace_fragment>');
        expect(t.indexOf('#include <tonemapping_fragment>')).toBeLessThan(t.indexOf('#include <colorspace_fragment>'));
    });

    it('electric fragment encodes on both the light and the ink path', () => {
        const fs = createInstancedElectricMaterial().fragmentShader;
        const inkStart = fs.indexOf('if (uInk > 0.5)');
        const inkReturn = fs.indexOf('return;', inkStart);
        const inkBranch = fs.slice(inkStart, inkReturn);
        expect(inkBranch).toContain('#include <tonemapping_fragment>');
        expect(inkBranch).toContain('#include <colorspace_fragment>');
        expect(tail(fs)).toContain('#include <colorspace_fragment>');
        expect(tail(fs)).toContain('#include <tonemapping_fragment>');
    });
});
