// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { fetchFixture } from '../../helpers/fixtureFetch.js';
import { linkCore } from '../../helpers/linkCore.js';

// Electric sets: one instance draws ONE set of the five electric roles. 'current' is the
// original files (<role>.glb); any other set loads <set>-<role>.glb from the same base path,
// and the pool keys every mesh by its role, so the gesture configs need no change.
vi.mock('three', async importOriginal => {
    const THREE = await importOriginal();
    const { makeFakeRendererClass } = await import('../../helpers/fakeWebGLRenderer.js');
    return { ...THREE, WebGLRenderer: makeFakeRendererClass(THREE) };
});

await import('../../../src/3d/index-hex-agent.js');
const { Core3DManager } = await import('../../../src/3d/Core3DManager.js');
const { EmotiveMascot3D } = await import('../../../src/3d/index.js');
const { ELECTRIC_SETS, ELECTRIC_SET_TUNE, electricSetPrefix } = await import('../../../src/3d/effects/electricSets.js');

const ROLES = ['arc-small', 'arc-medium', 'spark-node', 'lightning-ring', 'plasma-ring'];
const canvas = () => Object.assign(document.createElement('canvas'), { width: 300, height: 200 });
const flush = (ms = 0) => new Promise(r => setTimeout(r, ms));

beforeAll(() => {
    globalThis.fetch = fetchFixture;
});

describe('electric sets', () => {
    it('lists current first, then the three Blender variants', () => {
        expect(ELECTRIC_SETS).toEqual(['current', 'filament', 'corona', 'halo']);
        expect(electricSetPrefix('current')).toBe('');
        expect(electricSetPrefix(undefined)).toBe('');
        expect(electricSetPrefix('nope')).toBe('');
        expect(electricSetPrefix('halo')).toBe('halo-');
    });

    it('current keeps the original look (no fill, stock arc size); every set has a tune', () => {
        expect(ELECTRIC_SET_TUNE.current).toEqual({ fill: 0, surfaceScale: 1 });
        for (const s of ELECTRIC_SETS) {
            expect(ELECTRIC_SET_TUNE[s].fill).toBeGreaterThanOrEqual(0);
            expect(ELECTRIC_SET_TUNE[s].fill).toBeLessThanOrEqual(1);
            expect(ELECTRIC_SET_TUNE[s].surfaceScale).toBeGreaterThan(0);
        }
    });

    for (const set of ELECTRIC_SETS) {
        it(`${set}: the pool loads that set's five files and keys them by role`, async () => {
            fetchFixture.urls = [];
            const m = new Core3DManager(canvas(), { geometry: 'hexgem', assetBasePath: '/agent', electricSet: set });
            await m.waitUntilReady();
            await linkCore(m);
            const gl = m.renderer.renderer;
            // The pool links at mount (background): settle its compiles as electric.test does.
            for (let i = 0; i < 200 && !m.elementSpawner.mergedGeometries.get('electricity'); i++) {
                gl.settleCompiles?.();
                await flush(5);
            }
            gl.settleCompiles?.();
            await flush(30);
            const prefix = set === 'current' ? '' : `${set}-`;
            for (const r of ROLES) expect(fetchFixture.urls).toContain(`/agent/${prefix}${r}.glb`);
            // No file of another set is fetched.
            const others = ELECTRIC_SETS.filter(s => s !== set && s !== 'current').map(s => `${s}-`);
            for (const u of fetchFixture.urls) for (const o of others) expect(u.includes(`/${o}`), u).toBe(false);
            expect(m.elementSpawner.pools.get('electricity')?.mesh).toBeTruthy();
            const keys = [...m.elementSpawner.mergedGeometries.get('electricity').modelMap.keys()].sort();
            expect(keys).toEqual([...ROLES].sort());
            // The set's tune reaches the pool: its tube fill on the material, its surface scale.
            const mat = m.elementSpawner.materials.get('electricity');
            expect(mat.uniforms.uFill.value).toBe(ELECTRIC_SET_TUNE[set].fill);
            expect(m.elementSpawner.tune.electricity.surfaceScale).toBe(ELECTRIC_SET_TUNE[set].surfaceScale);
            await flush(10);
            await m.destroy();
        });
    }

    it('the mascot forwards electricSet; an unknown name warns and falls back to current', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const a = new EmotiveMascot3D({ assetBasePath: '/agent', electricSet: 'corona' });
        expect(a.getElectricSet()).toBe('corona');
        expect(a.getAvailableElectricSets()).toEqual(ELECTRIC_SETS);
        const b = new EmotiveMascot3D({ assetBasePath: '/agent', electricSet: 'sparkly' });
        expect(b.getElectricSet()).toBe('current');
        expect(warn).toHaveBeenCalledWith(expect.stringMatching(/Unknown electricSet "sparkly"/));
        expect(new EmotiveMascot3D({ assetBasePath: '/agent' }).getElectricSet()).toBe('current');
        warn.mockRestore();
    });
});
