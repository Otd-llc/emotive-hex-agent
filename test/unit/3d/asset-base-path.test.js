// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';

// Fix (e): assetBasePath is required; there is no silent '/assets' default.
vi.mock('three', async importOriginal => {
    const THREE = await importOriginal();
    const { makeFakeRendererClass } = await import('../../helpers/fakeWebGLRenderer.js');
    return { ...THREE, WebGLRenderer: makeFakeRendererClass(THREE) };
});
const { EmotiveMascot3D } = await import('../../../src/3d/index.js');
const { Core3DManager } = await import('../../../src/3d/Core3DManager.js');

const canvas = () => Object.assign(document.createElement('canvas'), { width: 300, height: 200 });

describe('assetBasePath (fix e)', () => {
    it('EmotiveMascot3D throws without it', () => {
        expect(() => new EmotiveMascot3D({})).toThrow(/assetBasePath/);
        expect(() => new EmotiveMascot3D({ assetBasePath: '' })).toThrow(/assetBasePath/);
        expect(() => new EmotiveMascot3D({ assetBasePath: 42 })).toThrow(/assetBasePath/);
    });

    it('EmotiveMascot3D accepts a string path', () => {
        expect(() => new EmotiveMascot3D({ assetBasePath: '/agent/' })).not.toThrow();
    });

    it('Core3DManager throws without it', () => {
        expect(() => new Core3DManager(canvas(), { geometry: 'sphere' })).toThrow(/assetBasePath/);
    });
});
