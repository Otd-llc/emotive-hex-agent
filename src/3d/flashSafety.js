/**
 * Flash safety (WCAG 2.3.1, "three flashes or below threshold"): one switch and one cap for
 * every periodic brightness change the engine makes (gesture glow flicker, arc flicker and
 * emissive pulses, the gem's electric overlay, lightning flash events). With the switch on
 * (the default, and the only shipped setting) no flicker repeats faster than MAX_FLICKER_HZ
 * and flash events are spaced at least MIN_FLASH_GAP_MS apart, so a composite stays at or
 * below 3 flashes per second. The stock Emotive Engine rates (up to 30 Hz) apply only when
 * the switch is off (the flash gate's planted fault).
 */
export const FLASH_SAFETY = {
    enabled: true,
    rule: 'WCAG 2.3.1',
};

/** Max repeat rate of any engine flicker, Hz (a flicker cycle is one flash). */
export const MAX_FLICKER_HZ = 2;

/** Minimum spacing of discrete lightning flash events, ms. */
export const MIN_FLASH_GAP_MS = 400;

/**
 * @param {number} hz - requested flicker rate
 * @returns {number} the rate to use
 */
export function safeHz(hz) {
    return FLASH_SAFETY.enabled ? Math.min(hz, MAX_FLICKER_HZ) : hz;
}

/**
 * Thin flash events so consecutive ones are >= MIN_FLASH_GAP_MS apart (gesture progress
 * `at` x duration). The brightest event of a too-close group is kept.
 * @param {Array<{at: number, intensity: number}>} events
 * @param {number} durationMs
 */
export function safeFlashEvents(events, durationMs) {
    if (!FLASH_SAFETY.enabled || !Array.isArray(events)) return events;
    const sorted = [...events].sort((a, b) => a.at - b.at);
    const out = [];
    for (const e of sorted) {
        const last = out[out.length - 1];
        if (last && (e.at - last.at) * durationMs < MIN_FLASH_GAP_MS) {
            if (e.intensity > last.intensity) out[out.length - 1] = { ...last, intensity: e.intensity };
            continue;
        }
        out.push(e);
    }
    return out;
}
