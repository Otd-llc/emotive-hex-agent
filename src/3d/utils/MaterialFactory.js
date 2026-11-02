/**
 * Material Factory - Creates geometry-specific materials
 */

import * as THREE from 'three';

// Caching texture loader — wraps THREE.TextureLoader to avoid reloading on re-morph.
// Duck-types as TextureLoader so Sun/Moon code works unchanged.
// Lazy init avoids circular-dependency TDZ errors in rollup bundles.
let _texCache = null;
let _rawLoader = null;
const textureLoader = {
    load(url, onLoad, onProgress, onError) {
        if (!_texCache) { _texCache = new Map(); _rawLoader = new THREE.TextureLoader(); }
        if (_texCache.has(url)) {
            const tex = _texCache.get(url);
            // Defer callback — callers expect onLoad to fire asynchronously
            // (e.g., MaterialFactory references `material` which is declared after the load call)
            if (onLoad) Promise.resolve().then(() => onLoad(tex));
            return tex;
        }
        return _rawLoader.load(url, tex => {
            _texCache.set(url, tex);
            if (onLoad) onLoad(tex);
        }, onProgress, onError);
    },
};
import { getCrystalShaders, CRYSTAL_DEFAULT_UNIFORMS } from '../shaders/crystalWithSoul.js';
import { SSSPresets, BASE_GEM } from '../presets/SSSPresets.js';
import { LOOKS, BASE_LOOK } from '../presets/looks.js';
import { getSurface, onSurfaceChange } from '../materials/surface.js';
import { DEFORMATION_DEFAULT_UNIFORMS } from '../shaders/utils/deformation.js';
import { CRACK_DEFAULT_UNIFORMS } from '../shaders/utils/objectSpaceCracks.js';

/**
 * Material for a registry entry. Branches on the entry's `crystalFamily` flag, never on its
 * name: every crystal-family shape gets the crystal shader + the hexgem detail map.
 * @param {string} geometryType - registry name (logging only)
 * @param {Object} geometryConfig - THREE_GEOMETRIES entry
 * @returns {{ material: THREE.ShaderMaterial, type: 'crystal' } | null}
 */
export function createCustomMaterial(geometryType, geometryConfig, options = {}) {
    const { glowColor = [1.0, 1.0, 0.95], glowIntensity = 1.0, assetBasePath } = options;
    if (geometryConfig?.crystalFamily !== true) return null;
    return createCrystalMaterial(glowColor, glowIntensity, geometryConfig.materialOverrides || { sssPreset: BASE_GEM }, assetBasePath);
}

/** The gem detail map (R edge thickness, G honeycomb, B noise), shared by every shape. */
export const DETAIL_MAP = 'hexgem-detail.webp';

function createCrystalMaterial(glowColor, glowIntensity, overrides = {}, assetBasePath) {
    const { vertexShader, fragmentShader } = getCrystalShaders();

    const texturePath = `${String(assetBasePath).replace(/\/+$/, '')}/${DETAIL_MAP}`;
    const crystalTexture = textureLoader.load(
        texturePath,
        tex => {
            // Track texture on material for disposal
            if (material) material.userData._crystalTexture = tex;
        },
        undefined,
        err => console.warn('[emotive-hex-agent] detail map failed to load:', err)
    );

    // Get SSS preset if specified, otherwise use defaults
    // Every crystal starts on a gem preset (the base gem unless the entry overrides it).
    const sssPreset = overrides.sssPreset ? SSSPresets[overrides.sssPreset] : null;

    const material = new THREE.ShaderMaterial({
        uniforms: {
            time: { value: 0 },
            emotionColor: { value: new THREE.Color(glowColor[0], glowColor[1], glowColor[2]) },
            glowIntensity: { value: glowIntensity },
            opacity: { value: 1.0 },
            // 0 = dark page, 1 = light page; kept live by the surface listener below (fix d).
            uSurface: { value: getSurface() === 'light' ? 1 : 0 },
            uGlow: { value: CRYSTAL_DEFAULT_UNIFORMS.uGlow },
            uRim: { value: CRYSTAL_DEFAULT_UNIFORMS.uRim },
            // Look (setLook): starts on the base look; a morph re-applies the current one.
            uRimInk: { value: new THREE.Color(...LOOKS[BASE_LOOK].uRimInk) },
            uEnv: { value: LOOKS[BASE_LOOK].uEnv },
            uBody: { value: LOOKS[BASE_LOOK].uBody },
            uDepth: { value: LOOKS[BASE_LOOK].uDepth },
            uCore: { value: new THREE.Vector3(...LOOKS[BASE_LOOK].uCore) },
            uCoreMix: { value: LOOKS[BASE_LOOK].uCoreMix },
            uEmotion: { value: LOOKS[BASE_LOOK].uEmotion },
            uClarity: { value: LOOKS[BASE_LOOK].uClarity },
            frostiness: { value: overrides.frostiness ?? sssPreset?.frostiness ?? CRYSTAL_DEFAULT_UNIFORMS.frostiness },
            fresnelPower: {
                value: overrides.fresnelPower ?? CRYSTAL_DEFAULT_UNIFORMS.fresnelPower,
            },
            fresnelIntensity: {
                value: overrides.fresnelIntensity ?? sssPreset?.fresnelIntensity ?? CRYSTAL_DEFAULT_UNIFORMS.fresnelIntensity,
            },
            innerGlowStrength: {
                value: overrides.innerGlowStrength ?? sssPreset?.innerGlowStrength ?? CRYSTAL_DEFAULT_UNIFORMS.innerGlowStrength,
            },
            surfaceRoughness: { value: CRYSTAL_DEFAULT_UNIFORMS.surfaceRoughness },
            // Enhanced lighting uniforms
            shadowDarkness: {
                value: overrides.shadowDarkness ?? CRYSTAL_DEFAULT_UNIFORMS.shadowDarkness,
            },
            specularIntensity: {
                value: overrides.specularIntensity ?? CRYSTAL_DEFAULT_UNIFORMS.specularIntensity,
            },
            specularPower: {
                value: overrides.specularPower ?? CRYSTAL_DEFAULT_UNIFORMS.specularPower,
            },
            transmissionContrast: {
                value:
                    overrides.transmissionContrast ?? CRYSTAL_DEFAULT_UNIFORMS.transmissionContrast,
            },
            minBrightness: {
                value: overrides.minBrightness ?? CRYSTAL_DEFAULT_UNIFORMS.minBrightness,
            },
            surfaceNoiseScale: { value: CRYSTAL_DEFAULT_UNIFORMS.surfaceNoiseScale },
            noiseFrequency: { value: CRYSTAL_DEFAULT_UNIFORMS.noiseFrequency },
            // Internal caustics
            causticIntensity: {
                value: overrides.causticIntensity ?? sssPreset?.causticIntensity ?? CRYSTAL_DEFAULT_UNIFORMS.causticIntensity,
            },
            causticScale: {
                value: overrides.causticScale ?? CRYSTAL_DEFAULT_UNIFORMS.causticScale,
            },
            causticSpeed: {
                value: overrides.causticSpeed ?? CRYSTAL_DEFAULT_UNIFORMS.causticSpeed,
            },
            crystalTexture: { value: crystalTexture },
            textureStrength: { value: overrides.textureStrength ?? CRYSTAL_DEFAULT_UNIFORMS.textureStrength },
            // Soul refraction - samples soul texture with optical distortion
            soulTexture: { value: null }, // Set by ThreeRenderer at render time
            resolution: {
                value: new THREE.Vector2(
                    CRYSTAL_DEFAULT_UNIFORMS.resolution[0],
                    CRYSTAL_DEFAULT_UNIFORMS.resolution[1]
                ),
            },
            soulTextureSize: {
                value: new THREE.Vector2(
                    CRYSTAL_DEFAULT_UNIFORMS.soulTextureSize[0],
                    CRYSTAL_DEFAULT_UNIFORMS.soulTextureSize[1]
                ),
            },
            soulScreenCenter: {
                value: new THREE.Vector2(
                    CRYSTAL_DEFAULT_UNIFORMS.soulScreenCenter[0],
                    CRYSTAL_DEFAULT_UNIFORMS.soulScreenCenter[1]
                ),
            },
            refractionIndex: {
                value: overrides.refractionIndex ?? CRYSTAL_DEFAULT_UNIFORMS.refractionIndex,
            },
            refractionStrength: {
                value: overrides.refractionStrength ?? CRYSTAL_DEFAULT_UNIFORMS.refractionStrength,
            },
            // Physically-based subsurface scattering
            sssStrength: {
                value:
                    overrides.sssStrength ??
                    sssPreset?.sssStrength ??
                    CRYSTAL_DEFAULT_UNIFORMS.sssStrength,
            },
            sssAbsorption: {
                value: new THREE.Vector3(
                    ...(overrides.sssAbsorption ??
                        sssPreset?.sssAbsorption ??
                        CRYSTAL_DEFAULT_UNIFORMS.sssAbsorption)
                ),
            },
            sssScatterDistance: {
                value: new THREE.Vector3(
                    ...(overrides.sssScatterDistance ??
                        sssPreset?.sssScatterDistance ??
                        CRYSTAL_DEFAULT_UNIFORMS.sssScatterDistance)
                ),
            },
            sssThicknessBias: {
                value:
                    overrides.sssThicknessBias ??
                    sssPreset?.sssThicknessBias ??
                    CRYSTAL_DEFAULT_UNIFORMS.sssThicknessBias,
            },
            sssThicknessScale: {
                value:
                    overrides.sssThicknessScale ??
                    sssPreset?.sssThicknessScale ??
                    CRYSTAL_DEFAULT_UNIFORMS.sssThicknessScale,
            },
            sssCurvatureScale: {
                value:
                    overrides.sssCurvatureScale ??
                    sssPreset?.sssCurvatureScale ??
                    CRYSTAL_DEFAULT_UNIFORMS.sssCurvatureScale,
            },
            sssAmbient: {
                value:
                    overrides.sssAmbient ??
                    sssPreset?.sssAmbient ??
                    CRYSTAL_DEFAULT_UNIFORMS.sssAmbient,
            },
            sssLightDir: {
                value: new THREE.Vector3(
                    ...(overrides.sssLightDir ?? CRYSTAL_DEFAULT_UNIFORMS.sssLightDir)
                ),
            },
            sssLightColor: {
                value: new THREE.Vector3(
                    ...(overrides.sssLightColor ?? CRYSTAL_DEFAULT_UNIFORMS.sssLightColor)
                ),
            },
            // Emotion color bleed - how much soul color tints the gem
            emotionColorBleed: {
                value: overrides.emotionColorBleed ?? sssPreset?.emotionColorBleed ?? 0.0,
            },
            // ═══════════════════════════════════════════════════════════════
            // DEFORMATION UNIFORMS - Localized vertex displacement
            // Values from deformation.js utility module
            // ═══════════════════════════════════════════════════════════════
            deformationStrength: { value: DEFORMATION_DEFAULT_UNIFORMS.deformationStrength },
            impactPoint: { value: new THREE.Vector3(...DEFORMATION_DEFAULT_UNIFORMS.impactPoint) },
            deformationFalloff: { value: DEFORMATION_DEFAULT_UNIFORMS.deformationFalloff },
            // ═══════════════════════════════════════════════════════════════
            // OBJECT-SPACE CRACK UNIFORMS - Persistent damage
            // Values from objectSpaceCracks.js utility module
            // ═══════════════════════════════════════════════════════════════
            crackImpact0: { value: new THREE.Vector3(...CRACK_DEFAULT_UNIFORMS.crackImpact0) },
            crackImpact1: { value: new THREE.Vector3(...CRACK_DEFAULT_UNIFORMS.crackImpact1) },
            crackImpact2: { value: new THREE.Vector3(...CRACK_DEFAULT_UNIFORMS.crackImpact2) },
            crackDirection0: {
                value: new THREE.Vector3(...CRACK_DEFAULT_UNIFORMS.crackDirection0),
            },
            crackDirection1: {
                value: new THREE.Vector3(...CRACK_DEFAULT_UNIFORMS.crackDirection1),
            },
            crackDirection2: {
                value: new THREE.Vector3(...CRACK_DEFAULT_UNIFORMS.crackDirection2),
            },
            crackParams0: { value: new THREE.Vector3(...CRACK_DEFAULT_UNIFORMS.crackParams0) },
            crackParams1: { value: new THREE.Vector3(...CRACK_DEFAULT_UNIFORMS.crackParams1) },
            crackParams2: { value: new THREE.Vector3(...CRACK_DEFAULT_UNIFORMS.crackParams2) },
            crackNumImpacts: { value: CRACK_DEFAULT_UNIFORMS.crackNumImpacts },
            crackColor: { value: new THREE.Color(...CRACK_DEFAULT_UNIFORMS.crackColor) },
            crackGlowColor: { value: new THREE.Color(...CRACK_DEFAULT_UNIFORMS.crackGlowColor) },
            crackGlowStrength: { value: CRACK_DEFAULT_UNIFORMS.crackGlowStrength },
        },
        vertexShader,
        fragmentShader,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: true, // Soul renders to separate RT via texture sampling, not depth
        blending: THREE.NormalBlending,
        // The crystal shader tone-maps itself (hue-preserving); ACES turns saturated blue violet.
        toneMapped: false,
    });

    // setSurface() reaches live crystals without a remount; dropped with the material.
    const offSurface = onSurfaceChange(mode => {
        material.uniforms.uSurface.value = mode === 'light' ? 1 : 0;
    });
    material.addEventListener('dispose', offSurface);

    return { material, type: 'crystal' };
}



export function disposeCustomMaterial(customMaterial) {
    if (!customMaterial) return;
    const skip = tex => tex && _isCached(tex);
    if (customMaterial.map && !skip(customMaterial.map)) customMaterial.map.dispose();
    if (customMaterial.normalMap && !skip(customMaterial.normalMap)) customMaterial.normalMap.dispose();
    if (customMaterial.emissiveMap && !skip(customMaterial.emissiveMap)) customMaterial.emissiveMap.dispose();
    if (customMaterial.roughnessMap && !skip(customMaterial.roughnessMap)) customMaterial.roughnessMap.dispose();
    if (customMaterial.metalnessMap && !skip(customMaterial.metalnessMap)) customMaterial.metalnessMap.dispose();
}

/** Check if a texture is managed by the cache (should not be disposed individually) */
function _isCached(tex) {
    if (!_texCache) return false;
    for (const cached of _texCache.values()) {
        if (cached === tex) return true;
    }
    return false;
}

/** Dispose all cached textures — call on full teardown only */
export function disposeTextureCache() {
    if (!_texCache) return;
    for (const tex of _texCache.values()) tex.dispose();
    _texCache.clear();
}

export default { createCustomMaterial, disposeCustomMaterial, disposeTextureCache };
