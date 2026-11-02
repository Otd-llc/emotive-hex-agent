// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';

// init() must not open a throwaway WebGL 2 context to probe support: it counts against the
// browser's context cap and Firefox logs "WebGL context was lost" when it is released.
vi.mock('three', async importOriginal => {
    const THREE = await importOriginal();
    const { makeFakeRendererClass } = await import('../../helpers/fakeWebGLRenderer.js');
    return { ...THREE, WebGLRenderer: makeFakeRendererClass(THREE) };
});
const { EmotiveMascot3D } = await import('../../../src/3d/index.js');

describe('init() WebGL 2 detection', () => {
    it('creates no probe context', async () => {
        globalThis.WebGL2RenderingContext ??= function () {};
        const spy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext');
        const m = new EmotiveMascot3D({ assetBasePath: '/x', coreGeometry: 'sphere' });
        m.init(document.createElement('div'));
        expect(spy.mock.calls.filter(c => c[0] === 'webgl2').length).toBe(0);
        expect(m.core3D).toBeTruthy();
        spy.mockRestore();
        await m.destroy();
    });

    it('without WebGL 2 it warns and mounts nothing', () => {
        const saved = globalThis.WebGL2RenderingContext;
        delete globalThis.WebGL2RenderingContext;
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const m = new EmotiveMascot3D({ assetBasePath: '/x', coreGeometry: 'sphere' });
        m.init(document.createElement('div'));
        expect(m.core3D).toBeNull();
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
        globalThis.WebGL2RenderingContext = saved;
    });
});
