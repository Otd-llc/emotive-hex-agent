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

/** Generic name for the same loader (electric meshes, the soul inclusion). */
export const loadGLBGeometry = loadCrystalGeometry;

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
        // A flat shape keeps its face to the camera instead of spinning edge-on.
        faceCamera: over.faceCamera === true,
        faceSway: over.faceSway ?? 0,
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
 * The VICTORY ("done") candidates, round star (owner, 2026-11-02: "Can we create a natural
 * star crystal in the style of our crystal?"). Natural star habits, every member made from 02
 * (the hexgem's own crystal; the agent-crystal sandbox's tools/agent/blender/star.py): A trilling (three at
 * 60 deg, six points), B penetration (three perpendicular, six points face-on), C cross (two
 * at 60 deg, four points), D stellate (six points growing out of a short hub). Registered so
 * the owner can pick live; the state table moves to the pick, the rest are then dropped.
 * Each carries `faceCamera` (no ambient spin, front to the camera); B also `faceSway`.
 * A star spans its whole box in both directions, so its shell is smaller than the hexgem's
 * (STAR_SHELL, tuned on the gem coverage in the engine at rest, 2026-11-02): the same visual
 * mass as the hexgem, not the same bounding side.
 */
export const STAR_SHAPES = ['star-trilling', 'star-penetration', 'star-cross', 'star-stellate'];
const STAR_SHELL = { 'star-trilling': 1.85, 'star-penetration': 1.6, 'star-cross': 1.75, 'star-stellate': 1.85 };
/** Every star faces the camera (a flat star turned edge-on is a stick, and B is a six-point
 *  star only down its diagonal); B, the 3D one, rocks +-0.15 rad about that view to show depth (more folds two of its points onto one line). */
const STAR_SWAY = { 'star-penetration': 0.15 };

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
    ...Object.fromEntries(STAR_SHAPES.map(n => [n, crystalShape(`crystal-${n}.glb`, { shellScale: STAR_SHELL[n], faceCamera: true, faceSway: STAR_SWAY[n] ?? 0 })])),
};

/** @param {string} name @returns {boolean} */
export const isCrystalFamily = name => THREE_GEOMETRIES[name]?.crystalFamily === true;
