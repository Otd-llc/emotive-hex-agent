// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { fixtureBuffer, fetchFixture } from '../../helpers/fixtureFetch.js';

// P2a items 1 + 2: GLB geometry loader (node transforms applied, flat facets kept) and a
// per-geometry crystalFamily flag instead of name checks.
const { THREE_GEOMETRIES, CRYSTAL_SHAPES, geometryFromScene, parseCrystalGLB, loadCrystalGeometry } =
    await import('../../../src/3d/geometries/ThreeGeometries.js');
const { createCustomMaterial } = await import('../../../src/3d/utils/MaterialFactory.js');

const SHAPES = {
    hexgem: 'crystal-double-terminated.glb',
    twisted: 'crystal-dt-twisted.glb',
    trio: 'crystal-dt-trio.glb',
    cluster: 'crystal-dt-cluster.glb',
    split: 'crystal-dt-split.glb',
    rosette: 'crystal-dt-rosette.glb',
};

const size = g => {
    g.computeBoundingBox();
    return g.boundingBox.getSize(new THREE.Vector3());
};

describe('geometryFromScene applies node transforms before caching', () => {
    it('bakes parent + child world matrices into the positions', () => {
        const root = new THREE.Group();
        root.position.set(1, 0, 0);
        root.scale.setScalar(2);
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
        mesh.position.set(0, 3, 0);
        root.add(mesh);
        const g = geometryFromScene(root);
        g.computeBoundingBox();
        expect(g.boundingBox.min.x).toBeCloseTo(0);
        expect(g.boundingBox.max.x).toBeCloseTo(2);
        expect(g.boundingBox.min.y).toBeCloseTo(5);
        expect(g.boundingBox.max.y).toBeCloseTo(7);
        // the source mesh is untouched
        mesh.geometry.computeBoundingBox();
        expect(mesh.geometry.boundingBox.max.y).toBeCloseTo(0.5);
    });

    it('merges several meshes into one geometry', () => {
        const root = new THREE.Group();
        const a = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
        const b = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
        b.position.x = 5;
        root.add(a, b);
        const g = geometryFromScene(root);
        expect(size(g).x).toBeCloseTo(6);
    });
});

describe('parseCrystalGLB (real fixtures)', () => {
    for (const [name, file] of Object.entries(SHAPES)) {
        it(`${name}: centred, max dimension 1.6, position + normal + uv, flat facets`, async () => {
            const g = await parseCrystalGLB(fixtureBuffer(file));
            expect(g.attributes.position).toBeTruthy();
            expect(g.attributes.normal).toBeTruthy();
            expect(g.attributes.uv).toBeTruthy();
            const s = size(g);
            expect(Math.max(s.x, s.y, s.z)).toBeCloseTo(1.6, 4);
            const c = g.boundingBox.getCenter(new THREE.Vector3());
            expect(c.length()).toBeLessThan(1e-5);
            // Flat facets: every triangle's three vertex normals equal its face normal.
            const pos = g.attributes.position;
            const nrm = g.attributes.normal;
            const idx = g.index;
            const tri = idx ? idx.count / 3 : pos.count / 3;
            const at = (attr, i) => new THREE.Vector3().fromBufferAttribute(attr, i);
            let bad = 0;
            for (let t = 0; t < tri; t++) {
                const [i0, i1, i2] = [0, 1, 2].map(k => (idx ? idx.getX(t * 3 + k) : t * 3 + k));
                const face = new THREE.Vector3()
                    .subVectors(at(pos, i1), at(pos, i0))
                    .cross(new THREE.Vector3().subVectors(at(pos, i2), at(pos, i0)));
                if (face.lengthSq() < 1e-14) continue; // degenerate sliver
                face.normalize();
                for (const i of [i0, i1, i2]) if (at(nrm, i).dot(face) < 0.999) bad++;
            }
            expect(bad).toBe(0);
        });
    }

    it('inclusion-hex parses (no uv needed)', async () => {
        const g = await parseCrystalGLB(fixtureBuffer('inclusion-hex.glb'), { normalize: false });
        expect(g.attributes.position.count).toBeGreaterThan(0);
    });
});

describe('loadCrystalGeometry caches per URL and hands out clones', () => {
    beforeEach(() => {
        globalThis.fetch = fetchFixture;
        fetchFixture.urls = [];
    });

    it('one request per URL; each caller gets its own geometry', async () => {
        const a = await loadCrystalGeometry('/a/crystal-dt-split.glb');
        const b = await loadCrystalGeometry('/a/crystal-dt-split.glb');
        expect(a).not.toBe(b);
        expect(a.attributes.position.count).toBe(b.attributes.position.count);
        expect(fetchFixture.urls.filter(u => u.endsWith('crystal-dt-split.glb')).length).toBe(1);
    });

    it('rejects on a 404 instead of resolving a fallback shape', async () => {
        await expect(loadCrystalGeometry('/a/missing.glb')).rejects.toThrow(/404|missing/);
    });
});

describe('registry: the six picked shapes, flagged crystalFamily', () => {
    it('registers exactly the picked crystal shapes (plus the sphere fallback)', () => {
        expect(Object.keys(THREE_GEOMETRIES).sort()).toEqual([...Object.keys(SHAPES), 'sphere'].sort());
        expect(CRYSTAL_SHAPES).toEqual(Object.keys(SHAPES));
    });

    it('the stock crystal path and the rough/heart/star loaders are gone', () => {
        for (const old of ['crystal', 'rough', 'heart', 'star']) expect(THREE_GEOMETRIES[old]).toBeUndefined();
    });

    for (const name of Object.keys(SHAPES)) {
        it(`${name} carries crystalFamily + soulScale + shellScale + calibration`, () => {
            const c = THREE_GEOMETRIES[name];
            expect(c.crystalFamily).toBe(true);
            expect(typeof c.soulScale).toBe('number');
            expect(typeof c.shellScale).toBe('number');
            expect(c.calibration).toEqual({ x: expect.any(Number), y: expect.any(Number), z: expect.any(Number) });
            expect(c.file).toBe(SHAPES[name]);
            expect(typeof c.geometryLoader).toBe('function');
        });
    }

    it('the sphere fallback is not crystalFamily', () => {
        expect(THREE_GEOMETRIES.sphere.crystalFamily).toBeFalsy();
    });
});

describe('material factory branches on the flag, not the name', () => {
    for (const name of Object.keys(SHAPES)) {
        it(`${name} gets the crystal shader with the hexgem detail map`, () => {
            const r = createCustomMaterial(name, THREE_GEOMETRIES[name], { assetBasePath: '/agent' });
            expect(r?.type).toBe('crystal');
            expect(r.material.uniforms.crystalTexture.value).toBeTruthy();
        });
    }

    it('an unflagged custom entry gets no crystal material', () => {
        const r = createCustomMaterial('whatever', { material: 'custom' }, { assetBasePath: '/agent' });
        expect(r).toBeNull();
    });

    it('a flagged entry under ANY name gets the crystal material', () => {
        const r = createCustomMaterial('brand-new-shape', { material: 'custom', crystalFamily: true }, { assetBasePath: '/agent' });
        expect(r?.type).toBe('crystal');
    });
});
