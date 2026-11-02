/**
 * @fileoverview Registers the two electric gestures the hex agent keeps (shock,
 * electricflourish). Side-effect module.
 * @module gestures/elemental/electric/register-hex-agent
 */

import electricShock from './electricshock.js';
import electricFlourish from './electricflourish.js';

import { GESTURE_REGISTRY, GESTURE_TYPES } from '../../index.js';

export const GESTURES = [electricShock, electricFlourish];

for (const gesture of GESTURES) {
    GESTURE_REGISTRY[gesture.name] = gesture;
    GESTURE_TYPES.override.push(gesture.name);
}
