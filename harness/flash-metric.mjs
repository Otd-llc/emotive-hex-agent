/**
 * WCAG 2.3.1 flash metric over captured frames (runs in the browser AND in node tests).
 *
 * Definitions (WCAG 2.2, "general flash and red flash thresholds"):
 *  - relative luminance L of each pixel (sRGB -> linear, Rec. 709 weights);
 *  - a TRANSITION is a change of L of >= 0.10 from the last extreme, in the opposite
 *    direction to the previous transition, where the darker of the two is < 0.80;
 *  - a FLASH is a pair of opposing transitions; more than 3 flashes in any 1 s fails;
 *  - a RED transition is a change of R' = max(0, R - G - B) x 320 of > 20 where either state
 *    is saturated red (R / (R + G + B) >= 0.8, sRGB 0-1 values);
 *  - AREA: the flashing pixels count against a 341 x 256 CSS px window (10 degrees of
 *    visual field at a typical viewing distance); 25 % of it (21,824 px at DPR 1) or more
 *    flashing fails.
 * Conservative simplification: a pixel "flashes" if it has more than 3 flashes in ANY 1 s
 * window, and all such pixels are summed as if they flashed together.
 */

export const WINDOW_PX = 341 * 256;
export const AREA_FRAC = 0.25;
export const MAX_FLASHES_PER_S = 3;

const lin = v => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const LUT = new Float32Array(256);
for (let i = 0; i < 256; i++) LUT[i] = lin(i / 255);

/** Per-pixel transition tracker for one channel. */
class Tracker {
    constructor(n) {
        this.ref = new Float32Array(n);
        this.dir = new Int8Array(n);
        this.init = new Uint8Array(n);
        /** transition times per pixel (ms), only kept for the last 1 s */
        this.times = Array.from({ length: n }, () => []);
        this.maxIn1s = new Uint16Array(n);
    }

    /**
     * @param {number} i - pixel
     * @param {number} v - value
     * @param {number} t - ms
     * @param {(a: number, b: number) => boolean} counts - does a ref->v move count as a transition
     */
    push(i, v, t, counts) {
        if (!this.init[i]) {
            this.init[i] = 1;
            this.ref[i] = v;
            return;
        }
        const ref = this.ref[i];
        const d = this.dir[i];
        // extend the current excursion
        if ((d > 0 && v > ref) || (d < 0 && v < ref)) {
            this.ref[i] = v;
            return;
        }
        const s = Math.sign(v - ref);
        if (s !== 0 && s !== d && counts(ref, v)) {
            this.dir[i] = s;
            this.ref[i] = v;
            const ts = this.times[i];
            ts.push(t);
            while (ts.length && ts[0] <= t - 1000) ts.shift();
            if (ts.length > this.maxIn1s[i]) this.maxIn1s[i] = ts.length;
        } else if (d === 0) {
            // no direction yet: follow the signal until it moves far enough
            this.ref[i] = v;
        }
    }

    /** pixels with more than MAX_FLASHES_PER_S flashes (2 transitions each) in some 1 s */
    flashingPixels() {
        let n = 0;
        for (let i = 0; i < this.maxIn1s.length; i++) if (this.maxIn1s[i] / 2 > MAX_FLASHES_PER_S) n++;
        return n;
    }

    maxFlashesPerS() {
        let m = 0;
        for (let i = 0; i < this.maxIn1s.length; i++) m = Math.max(m, this.maxIn1s[i]);
        return m / 2;
    }
}

const lumaCounts = (a, b) => Math.abs(a - b) >= 0.1 && Math.min(a, b) < 0.8;

export class FlashMeter {
    /**
     * @param {number} pixels - pixels per frame
     * @param {{ dpr?: number }} [opts]
     */
    constructor(pixels, { dpr = 1 } = {}) {
        this.n = pixels;
        this.windowPx = WINDOW_PX * dpr * dpr;
        this.luma = new Tracker(pixels);
        this.red = new Tracker(pixels);
        this.sat = new Uint8Array(pixels); // saturated red in the reference state
        this.frames = 0;
        this.meanL = [];
    }

    /**
     * @param {Uint8ClampedArray|Uint8Array} rgba - one frame, composited on the page field
     * @param {number} tMs
     */
    push(rgba, tMs) {
        let sum = 0;
        for (let i = 0, p = 0; i < this.n; i++, p += 4) {
            const r = rgba[p], g = rgba[p + 1], b = rgba[p + 2];
            const L = 0.2126 * LUT[r] + 0.7152 * LUT[g] + 0.0722 * LUT[b];
            sum += L;
            this.luma.push(i, L, tMs, lumaCounts);
            const rs = r / 255, gs = g / 255, bs = b / 255;
            const tot = rs + gs + bs;
            const saturated = tot > 0 && rs / tot >= 0.8 ? 1 : 0;
            const q = Math.max(0, rs - gs - bs) * 320;
            const wasSat = this.sat[i];
            this.red.push(i, q, tMs, (a, c) => Math.abs(a - c) > 20 && (saturated || wasSat));
            this.sat[i] = saturated;
        }
        this.meanL.push(sum / this.n);
        this.frames++;
    }

    result() {
        const lumaPx = this.luma.flashingPixels();
        const redPx = this.red.flashingPixels();
        const limit = this.windowPx * AREA_FRAC;
        return {
            frames: this.frames,
            windowPx: this.windowPx,
            areaLimitPx: Math.round(limit),
            generalFlashPx: lumaPx,
            redFlashPx: redPx,
            generalFrac: +(lumaPx / this.windowPx).toFixed(4),
            redFrac: +(redPx / this.windowPx).toFixed(4),
            maxFlashesPerSAnyPixel: this.luma.maxFlashesPerS(),
            maxRedFlashesPerSAnyPixel: this.red.maxFlashesPerS(),
            pass: lumaPx < limit && redPx < limit,
        };
    }
}
