/**
 * Geometry registry, hex-agent edition.
 *
 * Six purpose-made crystal shapes (Blender outputs, GLB) plus a plain sphere fallback. Every
 * crystal entry carries `crystalFamily: true` and its own soul/shell scale and calibration
 * rotation; the material factory, the soul and the shell/blink/uniform paths branch on that
 * flag, never on a geometry name. The stock OBJ crystal and the rough/heart/star loaders are
 * deleted.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Max dimension every crystal shape is normalised to (the shell scale multiplies it). */
export const CRYSTAL_MAX_DIM = 1.6;

/**
 * Defaults for a crystal-family entry. Calibration is in degrees (applied on top of every
 * animation). The Blender gems put a hexagon VERTEX on +X and a FLAT on +Z, so y = 0 already
 * shows a flat facet to the camera (the stock OBJ needed 30 degrees). The look round may tune
 * these per shape.
 */
export const CRYSTAL_FAMILY_DEFAULTS = Object.freeze({
    soulScale: 1.0,
    shellScale: 2.0,
    calibration: Object.freeze({ x: 0, y: 0, z: 0 }),
});

const ATTRS = ['position', 'normal', 'uv'];

/** Float32 copy of an attribute (dequantises normalised integer attributes). */
function toFloat32(attr) {
    if (attr.array instanceof Float32Array && !attr.normalized) return attr.clone();
    const out = new Float32Array(attr.count * attr.itemSize);
    for (let i = 0; i < attr.count; i++) {
        for (let k = 0; k < attr.itemSize; k++) out[i * attr.itemSize + k] = attr.getComponent(i, k);
    }
    return new THREE.BufferAttribute(out, attr.itemSize);
}

/**
 * Bake every mesh under `root` into one geometry in root space: world matrices are applied
 * (updateWorldMatrix + applyMatrix4) BEFORE anything is cached, so a node transform (e.g. the
 * dequantisation transform meshopt quantisation puts on the node) is never lost.
 * Keeps position/normal/uv only. Source geometries are not modified.
 * @param {THREE.Object3D} root
 * @returns {THREE.BufferGeometry}
 */
export function geometryFromScene(root) {
    root.updateWorldMatrix(true, true);
    const parts = [];
    root.traverse(o => {
        if (!o.isMesh || !o.geometry?.attributes?.position) return;
        const g = new THREE.BufferGeometry();
        for (const a of ATTRS) if (o.geometry.attributes[a]) g.setAttribute(a, toFloat32(o.geometry.attributes[a]));
        if (o.geometry.index) g.setIndex(o.geometry.index.clone());
        g.applyMatrix4(o.matrixWorld);
        parts.push(g);
    });
    if (parts.length === 0) throw new Error('[emotive-hex-agent] GLB has no mesh');
    if (parts.length === 1) return parts[0];
    const shared = ATTRS.filter(a => parts.every(p => p.attributes[a]));
    const indexed = parts.every(p => p.index);
    const ready = parts.map(p => {
        const q = indexed ? p : p.index ? p.toNonIndexed() : p;
        for (const a of Object.keys(q.attributes)) if (!shared.includes(a)) q.deleteAttribute(a);
        return q;
    });
    const merged = mergeGeometries(ready, false);
    if (!merged) throw new Error('[emotive-hex-agent] could not merge GLB meshes');
    return merged;
}

/**
 * Centre a geometry and scale its largest dimension to `maxDim`. Recomputes normals: the
 * Blender files share vertices only within a flat facet, so the facets stay flat.
 * @param {THREE.BufferGeometry} g
 * @param {number} [maxDim]
 */
export function normalizeCrystal(g, maxDim = CRYSTAL_MAX_DIM) {
    g.computeBoundingBox();
    const c = g.boundingBox.getCenter(new THREE.Vector3());
    g.translate(-c.x, -c.y, -c.z);
    const s = g.boundingBox.getSize(new THREE.Vector3());
    const k = maxDim / Math.max(s.x, s.y, s.z);
    g.scale(k, k, k);
    g.computeVertexNormals();
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
}

/**
 * Parse a GLB (ArrayBuffer) into one baked geometry.
 * @param {ArrayBuffer} buffer
 * @param {{ normalize?: boolean }} [opts]
 * @returns {Promise<THREE.BufferGeometry>}
 */
export async function parseCrystalGLB(buffer, { normalize = true } = {}) {
    // GLTFLoader tests `instanceof ArrayBuffer`; copy a foreign-realm buffer (tests, workers).
    if (!(buffer instanceof ArrayBuffer)) {
        const bytes = new Uint8Array(buffer);
        buffer = new ArrayBuffer(bytes.byteLength);
        new Uint8Array(buffer).set(bytes);
    }
    const gltf = await new GLTFLoader().parseAsync(buffer, '');
    const g = geometryFromScene(gltf.scene);
    return normalize ? normalizeCrystal(g) : g;
}

/** url -> Promise<BufferGeometry> (CPU only; callers get clones). */
const glbCache = new Map();

/**
 * Fetch a GLB once per URL; every caller gets its own clone (the core mesh disposes its
 * geometry on a swap). Rejects on an HTTP error; the failed URL is not cached.
 * @param {string} url
 * @param {{ normalize?: boolean }} [opts]
 * @returns {Promise<THREE.BufferGeometry>}
 */
export function loadCrystalGeometry(url, opts = {}) {
    const key = `${url}|${opts.normalize !== false}`;
    if (!glbCache.has(key)) {
        const p = fetch(url)
            .then(r => {
                if (!r.ok) throw new Error(`[emotive-hex-agent] ${url}: HTTP ${r.status}`);
                return r.arrayBuffer();
            })
            .then(buf => parseCrystalGLB(buf, opts));
        p.catch(() => glbCache.delete(key));
        glbCache.set(key, p);
    }
    return glbCache.get(key).then(g => g.clone());
}

/** Join an asset base path and a file name. */
export const assetUrl = (base, file) => `${String(base).replace(/\/+$/, '')}/${file}`;

/**
 * One crystal-family registry entry.
 * @param {string} file - GLB name under assetBasePath
 * @param {Partial<typeof CRYSTAL_FAMILY_DEFAULTS>} [over]
 */
function crystalShape(file, over = {}) {
    return {
        geometry: null,
        file,
        geometryLoader: base => loadCrystalGeometry(assetUrl(base, file)),
        material: 'custom',
        crystalFamily: true,
        soulScale: over.soulScale ?? CRYSTAL_FAMILY_DEFAULTS.soulScale,
        shellScale: over.shellScale ?? CRYSTAL_FAMILY_DEFAULTS.shellScale,
        calibration: { ...CRYSTAL_FAMILY_DEFAULTS.calibration, ...(over.calibration || {}) },
        blink: {
            type: 'facet-flash',
            duration: 160,
            scaleAxis: [0.95, 0.95, 0.95],
            glowBoost: 0.4,
            curve: 'sine',
        },
        particleRadiusMultiplier: 1.4,
    };
}

/** The picked morph set (D7), base first. */
export const CRYSTAL_SHAPES = ['hexgem', 'twisted', 'trio', 'cluster', 'split', 'rosette'];

/**
 * Core geometry registry.
 * hexgem = base (idle/listening/typing), twisted = thinking/searching, trio = placing parts,
 * cluster = almost done, split = refused/undo, rosette = done (owner pick D7).
 */
export const THREE_GEOMETRIES = {
    // Plain sphere: Core3DManager's unknown-geometry fallback dereferences this entry.
    sphere: {
        geometry: new THREE.SphereGeometry(0.5, 64, 64),
        material: 'custom',
        blink: {
            type: 'gentle-pulse',
            duration: 180,
            scaleAxis: [0.95, 0.95, 0.95],
            glowBoost: 0.2,
            curve: 'sine',
        },
        particleRadiusMultiplier: 1.4,
    },
    hexgem: crystalShape('crystal-double-terminated.glb'),
    twisted: crystalShape('crystal-dt-twisted.glb'),
    trio: crystalShape('crystal-dt-trio.glb'),
    cluster: crystalShape('crystal-dt-cluster.glb'),
    split: crystalShape('crystal-dt-split.glb'),
    rosette: crystalShape('crystal-dt-rosette.glb'),
};

/** @param {string} name @returns {boolean} */
export const isCrystalFamily = name => THREE_GEOMETRIES[name]?.crystalFamily === true;
