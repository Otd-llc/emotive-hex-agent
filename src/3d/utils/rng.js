/**
 * Engine RNG hook. Math.random by default; seed(n) switches to a deterministic mulberry32
 * stream (test-only, for frame captures and the flash gate); seed(null) switches back.
 * Every random draw in the electric/flicker path goes through random().
 */
let state = null;

/** @returns {number} in [0, 1) */
export function random() {
    if (state === null) return Math.random();
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** @param {number|null} n - seed, or null for Math.random */
export function seed(n) {
    state = n === null || n === undefined ? null : n | 0;
}

/**
 * Stateless hash of (a, b) to [0, 1): time-slot flicker values that do not depend on the
 * frame rate (same slot -> same value).
 * @param {number} a
 * @param {number} b
 */
export function hash2(a, b) {
    let h = Math.imul((a | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((b | 0) + 0x27d4eb2f, 0xc2b2ae35);
    h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
    h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
