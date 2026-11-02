// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { fetchFixture } from '../../helpers/fixtureFetch.js';
import { linkCore } from '../../helpers/linkCore.js';

// An element gesture (shock, electricflourish) fired before its pool has linked is held
// (latest wins, ELEMENT_GESTURE_QUEUE_MS) and plays once the pool is ready.
vi.mock('three', async importOriginal => {
    const THREE = await importOriginal();
    const { makeFakeRendererClass } = await import('../../helpers/fakeWebGLRenderer.js');
    return { ...THREE, WebGLRenderer: makeFakeRendererClass(THREE) };
});

await import('../../../src/3d/index-hex-agent.js');
const { Core3DManager } = await import('../../../src/3d/Core3DManager.js');
const { EmotiveMascot3D, ELEMENT_GESTURE_QUEUE_MS } = await import('../../../src/3d/index.js');

const canvas = () => Object.assign(document.createElement('canvas'), { width: 300, height: 200 });
beforeAll(() => {
    globalThis.fetch = fetchFixture;
});
afterEach(() => vi.restoreAllMocks());

async function mascot(config = {}) {
    const m = new EmotiveMascot3D({ assetBasePath: '/agent', ...config });
    m.core3D = new Core3DManager(canvas(), { geometry: 'hexgem', assetBasePath: '/agent', preloadElements: [] });
    m._wireCore();
    await linkCore(m.core3D);
    return m;
}

describe('element gesture queue', () => {
    const ready = m => m.core3D.elementSpawner.pools.set('electricity', { mesh: {} });

    it('a shock before the pool links is held, then plays once the pool is ready', async () => {
        const m = await mascot();
        const play = vi.spyOn(m.core3D, 'playGesture').mockImplementation(() => {});
        const ev = [];
        m.eventManager.on('gesture:trigger', d => ev.push(d.gesture));
        m.express('shock');
        expect(play).not.toHaveBeenCalled();
        expect(ev).toEqual([]);
        m._drainGestureQueue();
        expect(play).not.toHaveBeenCalled();
        ready(m);
        m._drainGestureQueue();
        expect(play).toHaveBeenCalledTimes(1);
        expect(play).toHaveBeenCalledWith('shock');
        expect(ev).toEqual(['shock']);
        m._drainGestureQueue();
        expect(play).toHaveBeenCalledTimes(1);
        m.core3D.elementSpawner.pools.delete('electricity');
        await m.destroy();
    });

    it('the latest held gesture wins', async () => {
        const m = await mascot();
        const play = vi.spyOn(m.core3D, 'playGesture').mockImplementation(() => {});
        m.express('shock');
        m.express('electricflourish');
        ready(m);
        m._drainGestureQueue();
        expect(play.mock.calls).toEqual([['electricflourish']]);
        m.core3D.elementSpawner.pools.delete('electricity');
        await m.destroy();
    });

    it(`a held gesture is dropped after ELEMENT_GESTURE_QUEUE_MS`, async () => {
        const m = await mascot();
        const play = vi.spyOn(m.core3D, 'playGesture').mockImplementation(() => {});
        const t0 = performance.now();
        m.express('shock');
        const dropped = [];
        m.eventManager.on('gesture:dropped', d => dropped.push(d.gesture));
        vi.spyOn(performance, 'now').mockReturnValue(t0 + ELEMENT_GESTURE_QUEUE_MS + 50);
        ready(m);
        m._drainGestureQueue();
        expect(play).not.toHaveBeenCalled();
        expect(dropped).toEqual(['shock']);
        m.core3D.elementSpawner.pools.delete('electricity');
        await m.destroy();
    });

    it('plain gestures never wait for the pool', async () => {
        const m = await mascot();
        const play = vi.spyOn(m.core3D, 'playGesture').mockImplementation(() => {});
        m.express('nod');
        expect(play).toHaveBeenCalledWith('nod');
        await m.destroy();
    });
});
