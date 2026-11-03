/**
 * @fileoverview The electric sets the hex agent can draw (no side effects).
 * @module effects/electricSets
 */

/**
 * The electric SETS: each is the same five roles (the file names the gestures draw), made by
 * a different Blender generator variant. 'current' is the original set, served as
 * `<role>.glb`; any other set is served flat beside it as `<set>-<role>.glb`. An instance
 * picks one with `new EmotiveMascot3D({ electricSet })`.
 */
export const ELECTRIC_SETS = ['current', 'filament', 'corona', 'halo'];

/** File prefix of an electric set ('' for current or an unknown name). */
export function electricSetPrefix(set) {
    return set && set !== 'current' && ELECTRIC_SETS.includes(set) ? `${set}-` : '';
}

/**
 * Each set's tune. `fill`: how much of the set's own tube is lit regardless of the shader's
 * bolt network (0 = the network alone, as the current set has always drawn); the new sets
 * carry their character in the mesh, so their tube shows. `surfaceScale`: the size of the
 * shock's surface arcs (1 = as the gesture config says). `gain` (default 1): the arcs' light
 * (dark page) or ink (light page), on colour and opacity alike; it changes how much shows, never
 * the flicker rate. `countScale` (default 1): how many surface arcs a shock spawns.
 *
 * CORONA, round 7 (owner, 2026-11-02: "reads as a thin fringe at in-scene size"): in the scene
 * the gem is 64-90 px tall, so the arcs need a lit tube, bigger and more of them to read.
 * Was { fill: 0.45, surfaceScale: 1.25 }. The flash gate runs with --electric-set=corona.
 */
export const ELECTRIC_SET_TUNE = {
    current: { fill: 0, surfaceScale: 1 },
    filament: { fill: 0.55, surfaceScale: 1.6 },
    corona: { fill: 0.9, surfaceScale: 2.4, gain: 2, countScale: 2 },
    halo: { fill: 0.6, surfaceScale: 1.5 },
};

/** The material tune of a set (current for an unknown name). */
export function electricSetTune(set) {
    return ELECTRIC_SET_TUNE[set] ?? ELECTRIC_SET_TUNE.current;
}
