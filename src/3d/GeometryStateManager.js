/**
 * GeometryStateManager - Reset Shader States During Morphs
 *
 * Provides reset functions for each geometry type to clear shader uniforms
 * to their default values when morphing away. This prevents visual remnants
 * from bleeding between geometries (e.g., blood moon effects on crystal).
 *
 * Architecture:
 * - Each geometry has its own reset function
 * - Reset functions clear uniforms to defaults (don't dispose materials)
 * - Called during the "shrink" phase of morph before geometry swap
 */

// THREE - available for type checking if needed
import { CRYSTAL_DEFAULT_UNIFORMS } from './shaders/crystalWithSoul.js';



/**
 * Reset crystal material to default state
 * Clears: blend layers, frostiness, glow settings
 *
 * @param {THREE.ShaderMaterial} material - Crystal shader material
 */
export function resetCrystal(material) {
    if (!material || !material.uniforms) {
        return;
    }

    const u = material.uniforms;
    const defaults = CRYSTAL_DEFAULT_UNIFORMS;

    // Crystal appearance
    if (u.frostiness) u.frostiness.value = defaults.frostiness;
    if (u.fresnelPower) u.fresnelPower.value = defaults.fresnelPower;
    if (u.fresnelIntensity) u.fresnelIntensity.value = defaults.fresnelIntensity;
    if (u.innerGlowStrength) u.innerGlowStrength.value = defaults.innerGlowStrength;
    if (u.surfaceRoughness) u.surfaceRoughness.value = defaults.surfaceRoughness;

    // Noise scales
    if (u.surfaceNoiseScale) u.surfaceNoiseScale.value = defaults.surfaceNoiseScale;
    if (u.noiseFrequency) u.noiseFrequency.value = defaults.noiseFrequency;

    // Internal caustics
    if (u.causticIntensity) u.causticIntensity.value = defaults.causticIntensity;
    if (u.causticScale) u.causticScale.value = defaults.causticScale;
    if (u.causticSpeed) u.causticSpeed.value = defaults.causticSpeed;

    // Texture
    if (u.textureStrength) u.textureStrength.value = defaults.textureStrength;

    // Blend layers
    if (u.layer1Mode) u.layer1Mode.value = defaults.layer1Mode;
    if (u.layer1Strength) u.layer1Strength.value = defaults.layer1Strength;
    if (u.layer1Enabled) u.layer1Enabled.value = defaults.layer1Enabled;

    if (u.layer2Mode) u.layer2Mode.value = defaults.layer2Mode;
    if (u.layer2Strength) u.layer2Strength.value = defaults.layer2Strength;
    if (u.layer2Enabled) u.layer2Enabled.value = defaults.layer2Enabled;

    if (u.layer3Mode) u.layer3Mode.value = defaults.layer3Mode;
    if (u.layer3Strength) u.layer3Strength.value = defaults.layer3Strength;
    if (u.layer3Enabled) u.layer3Enabled.value = defaults.layer3Enabled;

    if (u.layer4Mode) u.layer4Mode.value = defaults.layer4Mode;
    if (u.layer4Strength) u.layer4Strength.value = defaults.layer4Strength;
    if (u.layer4Enabled) u.layer4Enabled.value = defaults.layer4Enabled;

    // Glow (preserve emotion color, just reset intensity)
    if (u.glowIntensity) u.glowIntensity.value = defaults.glowIntensity;

    // Reset opacity to full
    if (u.opacity) u.opacity.value = defaults.opacity;

    // Reset time
    if (u.time) u.time.value = defaults.time;
}

/**
 * Reset material state for the geometry being morphed away from (crystal family by flag).
 * @param {Object} geometryConfig - THREE_GEOMETRIES entry
 * @param {THREE.ShaderMaterial} material - The material to reset
 */
export function resetGeometryState(geometryConfig, material) {
    if (geometryConfig?.crystalFamily) resetCrystal(material);
}

/**
 * Default uniform values for a registry entry (crystal family), or null.
 * @param {Object} geometryConfig - THREE_GEOMETRIES entry
 * @returns {Object|null}
 */
export function getDefaultState(geometryConfig) {
    return geometryConfig?.crystalFamily ? { ...CRYSTAL_DEFAULT_UNIFORMS } : null;
}

export default {
    resetCrystal,
    resetGeometryState,
    getDefaultState,
};
