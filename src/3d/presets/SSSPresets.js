/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  ╔═○─┐ emotive
 *    ●●  ENGINE - SSS Material Presets
 *  └─○═╝
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * @fileoverview Predefined subsurface scattering material presets for crystal geometries
 * @author Emotive Engine Team
 * @module 3d/presets/SSSPresets
 *
 * These presets configure the SSS (Subsurface Scattering) shader uniforms to create
 * realistic gemstone-like materials: quartz, emerald, ruby, sapphire, amethyst, etc.
 */

/**
 * SSS preset definitions
 * Each preset contains uniform values for the SSS shader
 */
export const SSSPresets = {
    // The hex agent's base gem = the sapphire look (A): a deep, less saturated blue. The hue is
    // the normalised absorption; sssStrength is how deep it runs (Beer-law path in the shader).
    hexgem: {
        sssStrength: 1.5,
        sssAbsorption: [0.55, 0.95, 3.2],
        sssScatterDistance: [0.1, 0.15, 0.5],
        sssThicknessBias: 0.65,
        sssThicknessScale: 1.8,
        sssCurvatureScale: 3.0,
        sssAmbient: 0.1,
        frostiness: 0.12,
        innerGlowStrength: 0.75,
        fresnelIntensity: 1.3,
        causticIntensity: 1.0,
        emotionColorBleed: 0.2,
    },
    // The quartz look (B): near-clear, a cool hint; the look supplies the electric-blue core.
    quartz: {
        sssStrength: 0.5,
        sssAbsorption: [2.6, 2.8, 3.0],
        sssScatterDistance: [0.2, 0.2, 0.25],
        sssThicknessBias: 0.6,
        sssThicknessScale: 1.8,
        sssCurvatureScale: 3.0,
        sssAmbient: 0.12,
        frostiness: 0.08,
        innerGlowStrength: 1.0,
        fresnelIntensity: 1.5,
        causticIntensity: 1.2,
        emotionColorBleed: 0.0,
    },
    // The ruby-violet look (C): a deep wine-violet between ruby and amethyst.
    'ruby-violet': {
        sssStrength: 2.6,
        sssAbsorption: [3.0, 0.15, 2.4],
        sssScatterDistance: [0.4, 0.05, 0.4],
        sssThicknessBias: 0.68,
        sssThicknessScale: 1.9,
        sssCurvatureScale: 2.8,
        sssAmbient: 0.08,
        frostiness: 0.1,
        innerGlowStrength: 0.6,
        fresnelIntensity: 1.3,
        causticIntensity: 1.0,
        emotionColorBleed: 0.2,
    },
    emerald: {
        sssStrength: 2.0,
        sssAbsorption: [0.05, 4.0, 0.1],
        sssScatterDistance: [0.1, 0.5, 0.1],
        sssThicknessBias: 0.65,
        sssThicknessScale: 1.8,
        sssCurvatureScale: 3.0,
        sssAmbient: 0.1,
        frostiness: 0.2,
        innerGlowStrength: 0.15,
        fresnelIntensity: 1.2,
        causticIntensity: 1.0,
        emotionColorBleed: 0.35,
    },
    ruby: {
        sssStrength: 1.8,
        sssAbsorption: [4.0, 0.03, 0.08],
        sssScatterDistance: [0.4, 0.04, 0.08],
        sssThicknessBias: 0.65,
        sssThicknessScale: 1.9,
        sssCurvatureScale: 2.5,
        sssAmbient: 0.08,
        frostiness: 0.12,
        innerGlowStrength: 0.12,
        fresnelIntensity: 1.2,
        causticIntensity: 1.15,
        emotionColorBleed: 0.35,
    },
    sapphire: {
        sssStrength: 2.2,
        sssAbsorption: [0.15, 0.4, 4.0],
        sssScatterDistance: [0.1, 0.15, 0.5],
        sssThicknessBias: 0.65,
        sssThicknessScale: 1.8,
        sssCurvatureScale: 3.0,
        sssAmbient: 0.1,
        frostiness: 0.18,
        innerGlowStrength: 0.15,
        fresnelIntensity: 1.3,
        causticIntensity: 1.0,
        emotionColorBleed: 0.35,
    },
    amethyst: {
        sssStrength: 2.5,
        sssAbsorption: [3.0, 0.05, 4.5],
        sssScatterDistance: [0.4, 0.05, 0.5],
        sssThicknessBias: 0.7,
        sssThicknessScale: 2.0,
        sssCurvatureScale: 3.0,
        sssAmbient: 0.08,
        frostiness: 0.18,
        innerGlowStrength: 0.12,
        fresnelIntensity: 1.4,
        causticIntensity: 1.0,
        emotionColorBleed: 0.35,
    },
    topaz: {
        sssStrength: 1.5,
        sssAbsorption: [3.5, 2.0, 0.1],
        sssScatterDistance: [0.3, 0.2, 0.05],
        sssThicknessBias: 0.6,
        sssThicknessScale: 1.7,
        sssCurvatureScale: 2.8,
        sssAmbient: 0.12,
        frostiness: 0.14,
        innerGlowStrength: 0.18,
        fresnelIntensity: 1.4,
        causticIntensity: 1.1,
        emotionColorBleed: 0.25,
    },
    citrine: {
        sssStrength: 1.6,
        sssAbsorption: [3.8, 2.5, 0.05],
        sssScatterDistance: [0.35, 0.25, 0.05],
        sssThicknessBias: 0.58,
        sssThicknessScale: 1.6,
        sssCurvatureScale: 2.6,
        sssAmbient: 0.14,
        frostiness: 0.12,
        innerGlowStrength: 0.22,
        fresnelIntensity: 1.3,
        causticIntensity: 1.2,
        emotionColorBleed: 0.2,
    },
    diamond: {
        sssStrength: 0.5,
        sssAbsorption: [2.5, 2.5, 2.5],
        sssScatterDistance: [0.15, 0.15, 0.15],
        sssThicknessBias: 0.55,
        sssThicknessScale: 1.5,
        sssCurvatureScale: 4.0,
        sssAmbient: 0.15,
        frostiness: 0.08,
        innerGlowStrength: 0.25,
        fresnelIntensity: 2.0,
        causticIntensity: 1.5,
        emotionColorBleed: 0.0,
    },
};

/** The preset every crystal starts on (applied at mount, re-applied after a morph). */
export const BASE_GEM = 'hexgem';

/**
 * Flash safety (WCAG 2.3.1 design rule): a gem colour shift never completes faster than this.
 * setGemColor() clamps shorter durations up to it.
 */
export const GEM_SHIFT_MIN_MS = 500;

/**
 * Apply an SSS preset to a mascot's custom material
 * @param {Object} mascot - The EmotiveMascot3D instance
 * @param {string} presetName - Name of the preset to apply
 * @returns {boolean} True if preset was applied successfully
 */
export function applySSSPreset(mascot, presetName) {
    if (!presetName || !mascot?.core3D?.customMaterial?.uniforms) {
        return false;
    }

    const preset = SSSPresets[presetName];
    if (!preset) {
        return false;
    }

    const u = mascot.core3D.customMaterial.uniforms;

    // Apply all preset values to uniforms
    if (u.sssStrength) u.sssStrength.value = preset.sssStrength;
    if (u.sssAbsorption) u.sssAbsorption.value.set(...preset.sssAbsorption);
    if (u.sssScatterDistance) u.sssScatterDistance.value.set(...preset.sssScatterDistance);
    if (u.sssThicknessBias) u.sssThicknessBias.value = preset.sssThicknessBias;
    if (u.sssThicknessScale) u.sssThicknessScale.value = preset.sssThicknessScale;
    if (u.sssCurvatureScale) u.sssCurvatureScale.value = preset.sssCurvatureScale;
    if (u.sssAmbient) u.sssAmbient.value = preset.sssAmbient;
    if (u.frostiness) u.frostiness.value = preset.frostiness;
    if (u.innerGlowStrength) u.innerGlowStrength.value = preset.innerGlowStrength;
    if (u.fresnelIntensity) u.fresnelIntensity.value = preset.fresnelIntensity;
    if (preset.causticIntensity !== undefined && u.causticIntensity) {
        u.causticIntensity.value = preset.causticIntensity;
    }
    if (u.emotionColorBleed) {
        u.emotionColorBleed.value = preset.emotionColorBleed ?? 0.0;
    }

    return true;
}

/**
 * Get list of available preset names
 * @returns {string[]} Array of preset names
 */
export function getPresetNames() {
    return Object.keys(SSSPresets);
}

/**
 * Get a specific preset's configuration
 * @param {string} name - Preset name
 * @returns {Object|null} Preset configuration or null if not found
 */
export function getPreset(name) {
    return SSSPresets[name] || null;
}

export default {
    presets: SSSPresets,
    apply: applySSSPreset,
    getNames: getPresetNames,
    get: getPreset,
};
