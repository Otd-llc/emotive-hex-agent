// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';

// Fix (a): no background prewarm loop; link pollers are tracked; destroy() stops them at
// once (P2a: own poller, no 20 s wait hole), then dispose() + forceContextLoss().
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
    it('tracks the link poller until the program is ready', async () => {
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

    it('destroy() with a link in flight: stops the poller, then dispose() + forceContextLoss(), no wait', async () => {
        const r = new ThreeRenderer(canvas(), {});
        const gl = r.renderer;
        const linked = r.compileObjectAsync(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()));
        expect(r.pendingCompileCount()).toBe(1);
        await r.destroy();
        expect(await linked).toBe(false);
        const checks = gl.readyChecks;
        await new Promise(res => setTimeout(res, 40));
        expect(gl.readyChecks).toBe(checks);
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

    it('starts no new shader compile once destroy() was called (found by the teardown gate)', async () => {
        const m = new Core3DManager(canvas(), { geometry: 'sphere', assetBasePath: '/x/' });
        const gl = m.renderer.renderer;
        const r = m.renderer;
        const done = m.destroy();
        // e.g. the electric pool finishes loading its GLBs after close and tries to link
        await r.compileObjectAsync(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()));
        expect(calls(gl, 'compileAsync')).toBe(0);
        await done;
        expect(calls(gl, 'forceContextLoss')).toBe(1);
    });

    it('tears down at once with a link in flight; the poller never queries after close', async () => {
        const m = new Core3DManager(canvas(), { geometry: 'sphere', assetBasePath: '/x/' });
        const gl = m.renderer.renderer;
        const mat = new THREE.MeshBasicMaterial();
        m.renderer.scene.add(new THREE.Mesh(new THREE.BoxGeometry(), mat));
        m.renderer.compileObjectAsync(new THREE.Mesh(new THREE.BoxGeometry(), mat));
        const spawnerDispose = vi.spyOn(m.elementSpawner, 'dispose');
        await m.destroy();
        const checks = gl.readyChecks;
        expect(spawnerDispose).toHaveBeenCalledTimes(1);
        expect(calls(gl, 'forceContextLoss')).toBe(1);
        await new Promise(res => setTimeout(res, 40));
        expect(gl.readyChecks).toBe(checks);
    });
});
