/**
 * @fileoverview emotive-hex-agent entry: the 3D crystal engine with ONLY the electric
 * element, registered with ONLY the `shock` and `electricflourish` gestures.
 * Exports EmotiveMascot3D and SSSPresets; nothing else is public.
 * @module emotive-hex-agent
 */

import './effects/elements/electricity.js';
import '../core/gestures/elemental/electric/register-hex-agent.js';

export { EmotiveMascot3D, EmotiveMascot3D as default } from './index.js';
export { SSSPresets } from './presets/SSSPresets.js';
