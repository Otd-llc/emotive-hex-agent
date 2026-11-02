// @vitest-environment jsdom
import { it, expect, vi } from 'vitest';

// The GL gate runs with debugShaders on; the option must reach three's renderer.
vi.mock('three', async importOriginal => {
    const THREE = await importOriginal();
    const { makeFakeRendererClass } = await import('../../helpers/fakeWebGLRenderer.js');
    return { ...THREE, WebGLRenderer: makeFakeRendererClass(THREE) };
});
const { Core3DManager } = await import('../../../src/3d/Core3DManager.js');

it('debugShaders reaches renderer.debug.checkShaderErrors', () => {
    const c = Object.assign(document.createElement('canvas'), { width: 300, height: 200 });
    const on = new Core3DManager(c, { geometry: 'sphere', assetBasePath: '/x/', debugShaders: true });
    expect(on.renderer.renderer.debug.checkShaderErrors).toBe(true);
    const off = new Core3DManager(c, { geometry: 'sphere', assetBasePath: '/x/' });
    expect(off.renderer.renderer.debug.checkShaderErrors).toBe(false);
});
