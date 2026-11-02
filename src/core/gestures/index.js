/**
 * @fileoverview Gesture registry, hex-agent edition: only the curated motions.
 *
 * Kept (core): breathe, sway, float, lean, tilt, nod, shake, bounce, pulse, expand, contract,
 * wave, peek, point, pointUp, pointDown, pointLeft, pointRight, spin, orbit, sparkle,
 * shimmer, flash, glow. Electric shock + electricflourish are added by
 * elemental/electric/register-hex-agent.js. Every other gesture of the Emotive Engine is
 * deleted from this repository.
 * @module gestures
 */

import breathe from './idle/breathing/breathe.js';
import expand from './idle/breathing/expand.js';
import contract from './idle/breathing/contract.js';
import pulse from './idle/breathing/pulse.js';
import sway from './idle/swaying/sway.js';
import float from './idle/swaying/float.js';
import lean from './idle/swaying/lean.js';
import shake from './idle/fidgeting/shake.js';
import bounce from './dance/accents/bounce.js';
import orbit from './dance/orbits/orbit.js';
import spin from './actions/acrobatics/spin.js';
import point from './actions/gesturing/point.js';
import pointUp from './actions/gesturing/pointUp.js';
import pointDown from './actions/gesturing/pointDown.js';
import pointLeft from './actions/gesturing/pointLeft.js';
import pointRight from './actions/gesturing/pointRight.js';
import nod from './actions/gesturing/nod.js';
import tilt from './actions/poses/tilt.js';
import wave from './atmosphere/particles/wave.js';
import flash from './atmosphere/glow/flash.js';
import glow from './atmosphere/glow/glow.js';
import peek from './atmosphere/control/peek.js';

const sparkle = {
    name: 'sparkle',
    emoji: '✨',
    type: 'blending',
    description: 'Bright twinkling sparkle bursts',
    config: {
        duration: 800,
        musicalDuration: { musical: true, beats: 2 },
    },
    apply: (_particle, _progress, _params) => false,
    blend: (_particle, _progress, _params) => false,
    '3d': {
        evaluate(progress, motion) {
            const strength = motion?.strength || 1.0;

            // Create rapid sparkle bursts - multiple quick flashes
            // Use high-frequency sine waves with sharp peaks
            const sparkle1 = Math.pow(Math.max(0, Math.sin(progress * Math.PI * 6)), 3);
            const sparkle2 = Math.pow(Math.max(0, Math.sin(progress * Math.PI * 8 + 1)), 3);
            const sparkle3 = Math.pow(Math.max(0, Math.sin(progress * Math.PI * 10 + 2)), 3);

            // Combine for twinkling effect - peaks are sharp and bright
            const sparkleValue = Math.max(sparkle1, sparkle2, sparkle3);

            // Envelope to fade in/out
            const envelope = Math.sin(progress * Math.PI);

            // Final sparkle intensity
            const finalSparkle = sparkleValue * envelope;

            // Strong glow pulse
            const glowIntensity = 1.0 + finalSparkle * 0.5 * strength;

            // Very strong glow boost for dramatic sparkle halo
            const glowBoost = finalSparkle * 2.0 * strength;

            // Tiny scale pulse on sparkle peaks
            const scale = 1.0 + finalSparkle * 0.08 * strength;

            return {
                position: [0, 0, 0],
                rotation: [0, 0, 0],
                scale,
                glowIntensity,
                glowBoost,
            };
        },
    },
};

const shimmer = {
    name: 'shimmer',
    emoji: '🌟',
    type: 'particle', // Particle type to affect particle behavior
    description: 'Shimmer effect with sparkling particles',
    config: {
        duration: 2000, // Legacy fallback
        musicalDuration: { musical: true, bars: 1 }, // 1 bar (4 beats)
        particleMotion: 'radiant', // Use radiant behavior for shimmering effect
    },
    override: (particle, progress, _params) => {
        // Shimmer makes particles sparkle with wave effect
        particle.shimmerEffect = true;
        particle.shimmerProgress = progress;
        return true;
    },
    blend: (_particle, _progress, _params) => {
        // Blend with other gestures
        return false;
    },
    '3d': {
        evaluate(progress, motion) {
            const strength = motion?.strength || 1.0;

            // Create shimmering wave effect - multiple overlapping sine waves
            const wave1 = Math.sin(progress * Math.PI * 4);
            const wave2 = Math.sin(progress * Math.PI * 6 + 0.5);
            const wave3 = Math.sin(progress * Math.PI * 10 + 1.0);

            // Combine waves for sparkling effect
            const shimmerValue = (wave1 * 0.4 + wave2 * 0.35 + wave3 * 0.25 + 1) / 2; // 0 to 1

            // Glow pulses with shimmer
            const glowIntensity = 1.0 + shimmerValue * 0.3 * strength;

            // Glow boost for screen-space halo - sparkles!
            const glowBoost = shimmerValue * 1.0 * strength;

            return {
                position: [0, 0, 0],
                rotation: [0, 0, 0],
                scale: 1.0 + shimmerValue * 0.05 * strength,
                glowIntensity,
                glowBoost,
            };
        },
    },
};

export const GESTURE_REGISTRY = {};

const _motionNames = [];
const _transformNames = [];
const _effectNames = [];

function _reg(gesture, group) {
    GESTURE_REGISTRY[gesture.name] = gesture;
    group.push(gesture.name);
}

[bounce, pulse, shake, nod, sway, float, sparkle, shimmer, point, lean, pointUp, pointDown,
    pointLeft, pointRight, breathe, expand, contract, orbit].forEach(g => _reg(g, _motionNames));
[spin, tilt].forEach(g => _reg(g, _transformNames));
[wave, flash, glow, peek].forEach(g => _reg(g, _effectNames));

/** Gesture names by type (register-hex-agent.js pushes the electric ones into override). */
export const GESTURE_TYPES = {
    blending: _motionNames,
    override: _transformNames,
    effect: _effectNames,
};

/**
 * @param {string} name
 * @returns {Object|null} the gesture definition
 */
export function getGesture(name) {
    return Object.prototype.hasOwnProperty.call(GESTURE_REGISTRY, name) ? GESTURE_REGISTRY[name] : null;
}

/** @param {string} name */
export function isBlendingGesture(name) {
    return getGesture(name)?.type === 'blending';
}

/** @param {string} name */
export function isOverrideGesture(name) {
    return getGesture(name)?.type === 'override';
}

/**
 * @returns {Array<{name: string, type: string, description: string}>} every registered gesture
 */
export function listGestures() {
    return Object.values(GESTURE_REGISTRY).map(g => ({
        name: g.name,
        type: g.type,
        description: g.description || '',
    }));
}
