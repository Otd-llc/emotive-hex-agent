// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { fetchFixture } from '../../helpers/fixtureFetch.js';
import { linkCore } from '../../helpers/linkCore.js';

// P2a item 2: morphTo(name) works between any two picked shapes and keeps the crystal shader
// and the soul; calibration + shell/soul scale follow the target entry (flag, not name).
vi.mock('three', async importOriginal => {
    const THREE = await importOriginal();
    const { makeFakeRendererClass } = await import('../../helpers/fakeWebGLRenderer.js');
    return { ...THREE, WebGLRenderer: makeFakeRendererClass(THREE) };
});

const { Core3DManager } = await import('../../../src/3d/Core3DManager.js');
const { THREE_GEOMETRIES, CRYSTAL_SHAPES, STAR_SHAPES } = await import('../../../src/3d/geometries/ThreeGeometries.js');

const canvas = () => Object.assign(document.createElement('canvas'), { width: 300, height: 200 });
const DEG = Math.PI / 180;

beforeAll(() => {
    globalThis.fetch = fetchFixture;
    fetchFixture.urls = [];
});

async function mount(geometry) {
    const m = new Core3DManager(canvas(), { geometry, assetBasePath: '/agent/', preloadElements: [] });
    await linkCore(m);
    return m;
}

async function morph(m, to) {
    m.morphToShape(to, 200);
    for (let i = 0; i < 400 && (m.isMorphing() || m._targetGeometryType); i++) {
        m.render(16);
        await new Promise(r => setTimeout(r, 0));
    }
}

describe('mount on a crystal-family shape', () => {
    it('the stock asset paths are never requested (first mount in this module)', async () => {
        const m = await mount('hexgem');
        expect(fetchFixture.urls.some(u => /models\/Crystal|\.obj$/.test(u))).toBe(false);
        expect(fetchFixture.urls.some(u => u.endsWith('/crystal-double-terminated.glb'))).toBe(true);
        expect(fetchFixture.urls.some(u => u.endsWith('/inclusion-hex.glb'))).toBe(true);
        await m.destroy();
    });
    it('hexgem mounts with the crystal shader, a soul, and the entry calibration', async () => {
        const m = await mount('hexgem');
        expect(m.customMaterialType).toBe('crystal');
        expect(m.crystalSoul).toBeTruthy();
        const c = THREE_GEOMETRIES.hexgem.calibration;
        expect(m.calibrationRotation).toEqual([c.x * DEG, c.y * DEG, c.z * DEG]);
        expect(m.crystalShellBaseScale).toBe(THREE_GEOMETRIES.hexgem.shellScale);
        await m.destroy();
    });

});

describe('morphTo between every pair of picked shapes', () => {
    it('keeps the crystal shader + soul and takes the target entry values, for all 30 ordered pairs', async () => {
        const m = await mount('hexgem');
        // A tour that covers every ordered pair (from, to) at least once.
        const pairs = [];
        for (const a of CRYSTAL_SHAPES) for (const b of CRYSTAL_SHAPES) if (a !== b) pairs.push([a, b]);
        const seen = new Set();
        let at = 'hexgem';
        // Crystal to crystal reuses ONE material and ONE soul: no program is released/relinked.
        const material = m.customMaterial;
        const soul = m.crystalSoul;
        const disposed = vi.fn();
        material.addEventListener('dispose', disposed);
        for (const [a, b] of pairs) {
            if (at !== a) {
                await morph(m, a);
                at = a;
            }
            await morph(m, b);
            at = b;
            seen.add(`${a}>${b}`);
            expect(m.geometryType, `${a}>${b}`).toBe(b);
            expect(m.customMaterialType, `${a}>${b} shader`).toBe('crystal');
            expect(m.crystalSoul, `${a}>${b} soul`).toBeTruthy();
            expect(m.coreMesh.material, `${a}>${b} material on mesh`).toBe(m.customMaterial);
            const c = THREE_GEOMETRIES[b].calibration;
            expect(m.calibrationRotation).toEqual([c.x * DEG, c.y * DEG, c.z * DEG]);
            expect(m.crystalShellBaseScale).toBe(THREE_GEOMETRIES[b].shellScale);
            expect(m.crystalSoul.baseScale).toBe(THREE_GEOMETRIES[b].soulScale);
            expect(m.customMaterial, `${a}>${b} same material`).toBe(material);
            expect(m.crystalSoul, `${a}>${b} same soul`).toBe(soul);
        }
        expect(disposed).not.toHaveBeenCalled();
        expect(seen.size).toBe(30);
        await m.destroy();
    }, 60000);
});

describe('morphTo between every star candidate and hexgem / split', () => {
    it('both ways with hexgem and with split: crystal shader, soul, entry values, full size, glow kept', async () => {
        const m = await mount('hexgem');
        const material = m.customMaterial;
        const soul = m.crystalSoul;
        const disposed = vi.fn();
        material.addEventListener('dispose', disposed);
        const glow = material.uniforms.uGlow.value;
        // the resting mesh scale per unit of shell scale, on the hexgem (breathing moves it a little)
        for (let i = 0; i < 30; i++) m.render(16);
        const rest = m.coreMesh.scale.x / THREE_GEOMETRIES.hexgem.shellScale;
        const seen = new Set();
        let at = 'hexgem';
        for (const star of STAR_SHAPES) {
            for (const [a, b] of [
                ['hexgem', star],
                [star, 'hexgem'],
                ['split', star],
                [star, 'split'],
            ]) {
                if (at !== a) await morph(m, a);
                await morph(m, b);
                at = b;
                seen.add(`${a}>${b}`);
                expect(m.geometryType, `${a}>${b}`).toBe(b);
                expect(m.customMaterialType, `${a}>${b} shader`).toBe('crystal');
                expect(m.coreMesh.material, `${a}>${b} material on mesh`).toBe(material);
                expect(m.crystalSoul, `${a}>${b} same soul`).toBe(soul);
                expect(m.crystalShellBaseScale).toBe(THREE_GEOMETRIES[b].shellScale);
                expect(m.crystalSoul.baseScale).toBe(THREE_GEOMETRIES[b].soulScale);
                // not left dark or shrunk: the morph has fully landed, the mesh is drawn at
                // its full size, the glow is what it was
                expect(m.isMorphing(), `${a}>${b} landed`).toBe(false);
                expect(m.coreMesh.visible, `${a}>${b} visible`).toBe(true);
                const k = m.coreMesh.scale.x / THREE_GEOMETRIES[b].shellScale / rest;
                expect(k, `${a}>${b} full size`).toBeGreaterThan(0.85);
                expect(k, `${a}>${b} full size`).toBeLessThan(1.15);
                expect(material.uniforms.uGlow.value, `${a}>${b} glow`).toBe(glow);
                const n = m.coreMesh.geometry.attributes.position.count;
                expect(n, `${a}>${b} geometry`).toBeGreaterThan(0);
            }
        }
        expect(seen.size).toBe(STAR_SHAPES.length * 4);
        expect(disposed).not.toHaveBeenCalled();
        await m.destroy();
    }, 60000);
});

describe('a star faces the camera (faceCamera), the gem spins', () => {
    it('A, C, D hold yaw on the camera through emotion changes; B rocks about it; hexgem turns', async () => {
        const m = await mount('hexgem');
        const spin = async frames => {
            const y0 = m.baseEuler[1];
            for (let i = 0; i < frames; i++) m.render(16);
            return m.baseEuler[1] - y0;
        };
        expect(Math.abs(await spin(60))).toBeGreaterThan(0);
        for (const star of STAR_SHAPES) {
            await morph(m, star);
            const sway = THREE_GEOMETRIES[star].faceSway;
            expect(THREE_GEOMETRIES[star].faceCamera).toBe(true);
            const cam = m.renderer.camera.position;
            const toCam = Math.atan2(cam.x, cam.z);
            if (!sway) {
                expect(m.baseEuler[1]).toBeCloseTo(toCam, 6);
                expect(await spin(120)).toBeCloseTo(0, 6);
                m.setEmotion('euphoria');
                expect(await spin(120)).toBeCloseTo(0, 6);
                expect(m.baseEuler[0]).toBe(0);
                expect(m.baseEuler[2]).toBe(0);
            } else {
                // rocks within +-sway of the camera direction, never round
                let lo = Infinity;
                let hi = -Infinity;
                for (let i = 0; i < 500; i++) {
                    m.render(16);
                    lo = Math.min(lo, m.baseEuler[1] - toCam);
                    hi = Math.max(hi, m.baseEuler[1] - toCam);
                }
                expect(hi).toBeLessThanOrEqual(sway + 1e-9);
                expect(lo).toBeGreaterThanOrEqual(-sway - 1e-9);
                expect(hi - lo).toBeGreaterThan(sway);
            }
            await morph(m, 'hexgem');
            expect(Math.abs(await spin(120)), `${star} > hexgem spins again`).toBeGreaterThan(0);
        }
        expect(STAR_SHAPES.filter(s => THREE_GEOMETRIES[s].faceSway)).toEqual(['star-penetration']);
        for (const s of CRYSTAL_SHAPES) expect(THREE_GEOMETRIES[s].faceCamera, s).toBe(false);
        await m.destroy();
    }, 60000);
});
