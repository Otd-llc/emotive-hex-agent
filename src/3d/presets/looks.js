/**
 * @fileoverview Look presets for the hex agent's crystal.
 *
 * A look is a base gem (an SSSPresets entry: the hue and how deep it runs) plus the glass
 * uniforms the gem preset does not carry: how much studio it reflects (uEnv), the body light
 * floor that keeps a deep stone from reading black (uBody), the optical depth (uDepth), the
 * core colour (uCore, uCoreMix), how much the current EMOTION drives the core (uEmotion: the
 * body stays the look's stone, the core and particles carry the emotion), how clear it is
 * (uClarity) and the light-surface ink rim.
 *
 * setLook(name, ms) ramps all of it; setGemColor(preset, ms) still shifts only the gem (the
 * refusal's slow ruby), and setGemColor(null) returns to the CURRENT look's gem.
 * @module 3d/presets/looks
 */

export const LOOKS = Object.freeze({
    // A: deep, less saturated blue with a pale ice core.
    sapphire: Object.freeze({
        gem: 'hexgem',
        uEnv: 1.0,
        uBody: 0.17,
        uDepth: 1.0,
        uCore: [0.35, 0.7, 1.0],
        uCoreMix: 0.6,
        uEmotion: 1.0,
        uClarity: 0.0,
        uRimInk: [0.06, 0.09, 0.2],
    }),
    // B: near-clear quartz with an electric-blue soul.
    quartz: Object.freeze({
        gem: 'quartz',
        uEnv: 1.0,
        uBody: 0.1,
        uDepth: 0.8,
        uCore: [0.1, 0.45, 1.0],
        uCoreMix: 1.0,
        uEmotion: 1.0,
        uClarity: 0.6,
        uRimInk: [0.1, 0.13, 0.2],
    }),
    // C: deep ruby-violet with a hot magenta core.
    'ruby-violet': Object.freeze({
        gem: 'ruby-violet',
        uEnv: 1.0,
        uBody: 0.13,
        uDepth: 1.1,
        uCore: [0.9, 0.12, 0.45],
        uCoreMix: 0.6,
        uEmotion: 1.0,
        uClarity: 0.0,
        uRimInk: [0.16, 0.04, 0.12],
    }),
});

/** The look every crystal starts on. Its gem is BASE_GEM. */
export const BASE_LOOK = 'sapphire';

/** Scalar and vec3 uniforms a look sets. */
export const LOOK_SCALARS = ['uEnv', 'uBody', 'uDepth', 'uCoreMix', 'uEmotion', 'uClarity'];
export const LOOK_VEC3S = ['uCore', 'uRimInk'];

/** Read a material's look uniforms into a plain object (the ramp start). */
export function readLook(u) {
    const out = {};
    for (const k of LOOK_SCALARS) if (u[k]) out[k] = u[k].value;
    for (const k of LOOK_VEC3S) if (u[k]) out[k] = [u[k].value.r ?? u[k].value.x, u[k].value.g ?? u[k].value.y, u[k].value.b ?? u[k].value.z];
    return out;
}

/**
 * Write `from` -> `to` at eased progress `e` (0..1) into a material's uniforms.
 * @param {Object} u - material.uniforms
 * @param {Object} to - a LOOKS entry (or readLook result)
 * @param {Object} [from] - ramp start; omitted = write `to` exactly
 * @param {number} [e=1]
 */
export function writeLook(u, to, from = null, e = 1) {
    const f = from ?? to;
    for (const k of LOOK_SCALARS) {
        if (u[k] && to[k] !== undefined) u[k].value = f[k] + (to[k] - f[k]) * e;
    }
    for (const k of LOOK_VEC3S) {
        if (!u[k] || !to[k]) continue;
        const a = f[k], b = to[k];
        u[k].value.setRGB
            ? u[k].value.setRGB(a[0] + (b[0] - a[0]) * e, a[1] + (b[1] - a[1]) * e, a[2] + (b[2] - a[2]) * e)
            : u[k].value.set(a[0] + (b[0] - a[0]) * e, a[1] + (b[1] - a[1]) * e, a[2] + (b[2] - a[2]) * e);
    }
}
