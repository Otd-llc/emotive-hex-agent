// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { fetchFixture } from '../../helpers/fixtureFetch.js';
import { linkCore } from '../../helpers/linkCore.js';

// P2a item 4: the electric element points at the 5 Blender meshes (same names), the gesture
// model lists use only those, the pool shader is linked at mount in the background (so the
// FIRST shock shows arcs), destroy cancels it, and the link poller never outlives close.
vi.mock('three', async importOriginal => {
    const THREE = await importOriginal();
    const { makeFakeRendererClass } = await import('../../helpers/fakeWebGLRenderer.js');
    return { ...THREE, WebGLRenderer: makeFakeRendererClass(THREE) };
});

await import('../../../src/3d/index-hex-agent.js');
const THREE = await import('three');
const { ElementTypeRegistry } = await import('../../../src/3d/effects/ElementTypeRegistry.js');
const { GESTURE_REGISTRY } = await import('../../../src/core/gestures/index.js');
const { Core3DManager } = await import('../../../src/3d/Core3DManager.js');
const { ThreeRenderer } = await import('../../../src/3d/ThreeRenderer.js');

const FIVE = ['arc-small.glb', 'arc-medium.glb', 'spark-node.glb', 'lightning-ring.glb', 'plasma-ring.glb'];
const canvas = () => Object.assign(document.createElement('canvas'), { width: 300, height: 200 });
const flush = (ms = 0) => new Promise(r => setTimeout(r, ms));
const calls = (gl, fn) => gl.log.filter(e => e.fn === fn).length;

beforeAll(() => {
    globalThis.fetch = fetchFixture;
});

describe('electric element: exactly the five Blender meshes', () => {
    it('the model list is the five files, served flat from assetBasePath', () => {
        const cfg = ElementTypeRegistry.get('electricity');
        expect([...cfg.models].sort()).toEqual([...FIVE].sort());
        expect(cfg.basePath).toBe('');
    });

    it('shock and electricflourish reference only those five, and request no atmospherics', () => {
        const names = new Set(FIVE.map(f => f.replace('.glb', '')));
        for (const g of ['shock', 'electricflourish']) {
            const json = JSON.stringify(GESTURE_REGISTRY[g].config);
            const used = [...json.matchAll(/"models":\[([^\]]*)\]/g)].flatMap(m => m[1].split(',').map(s => s.replace(/"/g, '')));
            expect(used.length, g).toBeGreaterThan(0);
            for (const u of used) expect(names.has(u), `${g} uses ${u}`).toBe(true);
            expect(json).not.toMatch(/atmospherics|ozone/);
        }
    });

    it('rings are turned from the XZ files into the XY plane the gestures expect', () => {
        const cfg = ElementTypeRegistry.get('electricity');
        expect(cfg.modelRotation?.['lightning-ring.glb']).toEqual([-Math.PI / 2, 0, 0]);
        expect(cfg.modelRotation?.['plasma-ring.glb']).toEqual([-Math.PI / 2, 0, 0]);
        expect(cfg.modelRotation?.['arc-small.glb']).toBeUndefined();
    });
});

describe('the electric pool links at mount, in the background', () => {
    const mountLinked = async opts => {
        const m = new Core3DManager(canvas(), { geometry: 'hexgem', assetBasePath: '/agent', ...opts });
        const gl = m.renderer.renderer;
        await m.waitUntilReady();
        return { m, gl };
    };
    const coreCompiles = 3; // crystal (canvas), soul (its linear target), particles

    it('the core links first, off the main thread; nothing is drawn until then', async () => {
        const { m, gl } = await mountLinked({ preloadElements: [] });
        for (let i = 0; i < 50 && calls(gl, 'compile') < coreCompiles; i++) await flush(2);
        expect(calls(gl, 'compile')).toBe(coreCompiles);
        const soulTarget = gl.log.find(e => e.fn === 'compile' && e.target === m.renderer.soulRenderTarget);
        expect(soulTarget, 'soul compiled for its render target').toBeTruthy();
        m.render(16);
        m.render(16);
        expect(calls(gl, 'render')).toBe(0);
        await linkCore(m);
        m.render(16);
        m.render(16);
        expect(calls(gl, 'render')).toBeGreaterThan(0);
        await m.destroy();
    });

    it('after the core link: the five GLBs load from the base path, then the pool + gem overlay link', async () => {
        fetchFixture.urls = [];
        const { m, gl } = await mountLinked({});
        await linkCore(m);
        for (let i = 0; i < 100 && calls(gl, 'compile') < coreCompiles + 2; i++) await flush(5);
        for (const f of FIVE) expect(fetchFixture.urls).toContain(`/agent/${f}`);
        expect(calls(gl, 'compile')).toBe(coreCompiles + 2);
        expect(m.renderer.pendingCompileCount()).toBe(2);
        gl.settleCompiles();
        await flush(30);
        expect(m.renderer.pendingCompileCount()).toBe(0);
        expect(m.elementSpawner.pools.get('electricity')?.mesh).toBeTruthy();
        expect(m._electricMaterial).toBeTruthy();
        await m.destroy();
    });

    it('preloadElements: [] opts out', async () => {
        const { m, gl } = await mountLinked({ preloadElements: [] });
        await linkCore(m);
        await flush(50);
        expect(calls(gl, 'compile')).toBe(coreCompiles);
        await m.destroy();
    });

    it('destroy() during the GLB loads cancels it: no pool compile, no pool', async () => {
        const { m, gl } = await mountLinked({});
        await linkCore(m);
        await m.destroy();
        await flush(80);
        expect(calls(gl, 'compile')).toBeLessThanOrEqual(coreCompiles + 1); // the overlay may start
        expect(m.elementSpawner).toBeNull();
        expect(calls(gl, 'forceContextLoss')).toBe(1);
    });

    it('destroy() during the link: the poller stops at once, no isReady after close, context released without waiting', async () => {
        const { m, gl } = await mountLinked({});
        await linkCore(m);
        for (let i = 0; i < 100 && calls(gl, 'compile') < coreCompiles + 2; i++) await flush(5);
        expect(m.renderer.pendingCompileCount()).toBe(2);
        const t0 = Date.now();
        await m.destroy();
        expect(Date.now() - t0).toBeLessThan(200);
        const readyChecksAtClose = gl.readyChecks;
        expect(calls(gl, 'forceContextLoss')).toBe(1);
        await flush(60);
        expect(gl.readyChecks).toBe(readyChecksAtClose);
    });
});

describe('ThreeRenderer.compileObjectAsync: own poller', () => {
    const mesh = () => new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());

    it('polls isReady until the program reports ready', async () => {
        const r = new ThreeRenderer(canvas(), {});
        const gl = r.renderer;
        const p = r.compileObjectAsync(mesh());
        expect(r.pendingCompileCount()).toBe(1);
        await flush(35);
        expect(gl.readyChecks).toBeGreaterThan(1);
        gl.settleCompiles();
        await p;
        expect(r.pendingCompileCount()).toBe(0);
        await r.destroy();
    });

    it('without KHR_parallel_shader_compile it never queries completion status', async () => {
        const r = new ThreeRenderer(canvas(), {});
        const gl = r.renderer;
        gl.parallelCompile = false;
        await r.compileObjectAsync(mesh());
        expect(gl.readyChecks).toBe(0);
        expect(r.pendingCompileCount()).toBe(0);
        await r.destroy();
    });

    it('no compile starts once close has begun', async () => {
        const r = new ThreeRenderer(canvas(), {});
        const gl = r.renderer;
        r.beginClose();
        await r.compileObjectAsync(mesh());
        expect(calls(gl, 'compile')).toBe(0);
        await r.destroy();
    });
});
