/**
 * Engine clock. Wall time (performance.now) normally; in step mode (the test-only
 * `__step(dtMs)` hook) a virtual time that advances only when a frame is stepped, so frame
 * captures are deterministic. Every engine timer that used Date.now/performance.now for
 * animation reads this instead.
 */
let virtual = null;

/** @returns {number} ms */
export function now() {
    return virtual ?? (typeof performance !== 'undefined' ? performance.now() : Date.now());
}

/** Enter step mode at the current time (idempotent). */
export function enterStepMode() {
    if (virtual === null) virtual = now();
}

/** Leave step mode (back to wall time). */
export function exitStepMode() {
    virtual = null;
}

/** @param {number} dtMs - advance the virtual clock (step mode only) */
export function advance(dtMs) {
    if (virtual !== null) virtual += dtMs;
}

/** @returns {boolean} */
export const isStepMode = () => virtual !== null;
