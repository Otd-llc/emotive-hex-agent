// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { fetchFixture } from '../../helpers/fixtureFetch.js';
import { linkCore } from '../../helpers/linkCore.js';

// An element gesture (shock, electricflourish) fired before its pool has linked is held
// (latest wins, no expiry) and plays once the pool is ready; the host cancels it when its
// moment has passed (cancelQueuedGesture).
vi.mock('three', async importOriginal => {
    const THREE = await importOriginal();
    const { makeFakeRendererClass } = await import('../../helpers/fakeWebGLRenderer.js');
    return { ...THREE, WebGLRenderer: makeFakeRendererClass(THREE) };
});

await import('../../../src/3d/index-hex-agent.js');
const { Core3DManager } = await import('../../../src/3d/Core3DManager.js');
const { EmotiveMascot3D } = await import('../../../src/3d/index.js');

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

    it('gesture:trigger says how long a held gesture waited (0 when it played at once)', async () => {
        const m = await mascot();
        vi.spyOn(m.core3D, 'playGesture').mockImplementation(() => {});
        const ev = [];
        m.on('gesture:trigger', d => ev.push([d.gesture, d.held]));
        const t0 = performance.now();
        m.express('shock');
        vi.spyOn(performance, 'now').mockReturnValue(t0 + 9000);
        ready(m);
        m._drainGestureQueue();
        expect(ev.length).toBe(1);
        expect(ev[0][0]).toBe('shock');
        expect(ev[0][1]).toBeGreaterThan(8990);
        m.express('shock');
        expect(ev[1]).toEqual(['shock', 0]);
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

    it('a held gesture has no expiry: a 12 s cold link still plays it', async () => {
        const m = await mascot();
        const play = vi.spyOn(m.core3D, 'playGesture').mockImplementation(() => {});
        const dropped = [];
        m.on('gesture:dropped', d => dropped.push(d.gesture));
        const t0 = performance.now();
        m.express('shock');
        vi.spyOn(performance, 'now').mockReturnValue(t0 + 12500);
        m._drainGestureQueue();
        expect(m.queuedGesture()).toBe('shock');
        ready(m);
        m._drainGestureQueue();
        expect(play.mock.calls).toEqual([['shock']]);
        expect(dropped).toEqual([]);
        expect(m.queuedGesture()).toBe(null);
        m.core3D.elementSpawner.pools.delete('electricity');
        await m.destroy();
    });

    it('cancelQueuedGesture drops the held gesture; it never plays', async () => {
        const m = await mascot();
        const play = vi.spyOn(m.core3D, 'playGesture').mockImplementation(() => {});
        const dropped = [];
        const off = m.on('gesture:dropped', d => dropped.push(d.gesture));
        m.express('shock');
        expect(m.cancelQueuedGesture()).toBe(true);
        expect(m.cancelQueuedGesture()).toBe(false);
        ready(m);
        m._drainGestureQueue();
        expect(play).not.toHaveBeenCalled();
        expect(dropped).toEqual(['shock']);
        off();
        m.express('electricflourish');
        m.cancelQueuedGesture();
        expect(dropped).toEqual(['shock']);
        m.core3D.elementSpawner.pools.delete('electricity');
        await m.destroy();
    });

    it('cancelQueuedGesture(name) only drops that gesture', async () => {
        const m = await mascot();
        const play = vi.spyOn(m.core3D, 'playGesture').mockImplementation(() => {});
        m.express('electricflourish');
        expect(m.cancelQueuedGesture('shock')).toBe(false);
        expect(m.queuedGesture()).toBe('electricflourish');
        ready(m);
        m._drainGestureQueue();
        expect(play.mock.calls).toEqual([['electricflourish']]);
        m.core3D.elementSpawner.pools.delete('electricity');
        await m.destroy();
    });

    it('a plain gesture meanwhile neither waits nor cancels the held one', async () => {
        const m = await mascot();
        const play = vi.spyOn(m.core3D, 'playGesture').mockImplementation(() => {});
        m.express('shock');
        m.express('nod');
        expect(play.mock.calls).toEqual([['nod']]);
        expect(m.queuedGesture()).toBe('shock');
        ready(m);
        m._drainGestureQueue();
        expect(play.mock.calls).toEqual([['nod'], ['shock']]);
        m.core3D.elementSpawner.pools.delete('electricity');
        await m.destroy();
    });

    it('electric:ready is emitted once, the first frame the pool can draw', async () => {
        const m = await mascot();
        const ev = [];
        m.on('electric:ready', () => ev.push(1));
        expect(m.isElectricReady()).toBe(false);
        m._checkElectricReady();
        expect(ev).toEqual([]);
        ready(m);
        expect(m.isElectricReady()).toBe(true);
        m._checkElectricReady();
        m._checkElectricReady();
        expect(ev).toEqual([1]);
        m.core3D.elementSpawner.pools.delete('electricity');
        await m.destroy();
    });

    it('on() after destroy is a no-op that returns an unsubscribe', async () => {
        const m = await mascot();
        await m.destroy();
        const off = m.on('electric:ready', () => {});
        expect(typeof off).toBe('function');
        off();
    });

    it('plain gestures never wait for the pool', async () => {
        const m = await mascot();
        const play = vi.spyOn(m.core3D, 'playGesture').mockImplementation(() => {});
        m.express('nod');
        expect(play).toHaveBeenCalledWith('nod');
        await m.destroy();
    });
});
