// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';

// Fix (a): no background prewarm; raw renderer.compileAsync promises are tracked;
// destroy() defers GL teardown until they settle, then dispose() + forceContextLoss().
vi.mock('three', async importOriginal => {
    const THREE = await importOriginal();
    const { makeFakeRendererClass } = await import('../../helpers/fakeWebGLRenderer.js');
    return { ...THREE, WebGLRenderer: makeFakeRendererClass(THREE) };
});

const THREE = await import('three');
const { ThreeRenderer } = await import('../../../src/3d/ThreeRenderer.js');
const { Core3DManager } = await import('../../../src/3d/Core3DManager.js');

const canvas = () => Object.assign(document.createElement('canvas'), { width: 300, height: 200 });
const flush = () => new Promise(r => setTimeout(r, 0));
const calls = (gl, fn) => gl.log.filter(e => e.fn === fn).length;

describe('ThreeRenderer compile tracking + deferred teardown', () => {
    it('tracks the raw compileAsync promise until it settles', async () => {
        const r = new ThreeRenderer(canvas(), {});
        const gl = r.renderer;
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
        const p = r.compileObjectAsync(mesh);
        expect(r.pendingCompileCount()).toBe(1);
        gl.settleCompiles();
        await p;
        await flush();
        expect(r.pendingCompileCount()).toBe(0);
    });

    it('destroy() waits for pending compiles, then dispose() + forceContextLoss()', async () => {
        const r = new ThreeRenderer(canvas(), {});
        const gl = r.renderer;
        r.compileObjectAsync(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()));
        const done = r.destroy();
        await flush();
        expect(calls(gl, 'dispose')).toBe(0);
        expect(calls(gl, 'forceContextLoss')).toBe(0);
        gl.settleCompiles();
        await done;
        expect(calls(gl, 'dispose')).toBe(1);
        expect(calls(gl, 'forceContextLoss')).toBe(1);
        const order = gl.log.filter(e => e.fn === 'dispose' || e.fn === 'forceContextLoss').map(e => e.fn);
        expect(order).toEqual(['dispose', 'forceContextLoss']);
    });

    it('destroy() with nothing pending still releases the context', async () => {
        const r = new ThreeRenderer(canvas(), {});
        const gl = r.renderer;
        await r.destroy();
        expect(calls(gl, 'forceContextLoss')).toBe(1);
    });
});

describe('Core3DManager teardown', () => {
    it('has no background prewarm', () => {
        const m = new Core3DManager(canvas(), { geometry: 'sphere', assetBasePath: '/x/' });
        expect(m._backgroundPrewarm).toBeFalsy();
        expect(typeof m._backgroundPrewarmElements).toBe('undefined');
        m.destroy();
    });

    it('keeps materials alive while a compile is pending, then tears down', async () => {
        const m = new Core3DManager(canvas(), { geometry: 'sphere', assetBasePath: '/x/' });
        const gl = m.renderer.renderer;
        const mat = new THREE.MeshBasicMaterial();
        const disposeSpy = vi.spyOn(mat, 'dispose');
        m.renderer.scene.add(new THREE.Mesh(new THREE.BoxGeometry(), mat));
        m.renderer.compileObjectAsync(new THREE.Mesh(new THREE.BoxGeometry(), mat));
        const spawnerDispose = vi.spyOn(m.elementSpawner, 'dispose');
        const done = m.destroy();
        await flush();
        expect(spawnerDispose).not.toHaveBeenCalled();
        expect(calls(gl, 'forceContextLoss')).toBe(0);
        gl.settleCompiles();
        await done;
        expect(spawnerDispose).toHaveBeenCalledTimes(1);
        expect(calls(gl, 'forceContextLoss')).toBe(1);
        void disposeSpy;
    });
});
