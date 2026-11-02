import { describe, it, expect } from 'vitest';
import '../../../src/3d/index-hex-agent.js';
import { listGestures, getGesture } from '../../../src/core/gestures/index.js';

// The hex agent keeps exactly these gestures (PLAN.md P1 keep list + D4 electric pair).
const KEEP = [
    'breathe', 'sway', 'float', 'lean', 'tilt', 'nod', 'shake', 'bounce', 'pulse', 'expand',
    'contract', 'wave', 'peek', 'point', 'pointUp', 'pointDown', 'pointLeft', 'pointRight',
    'spin', 'orbit', 'sparkle', 'shimmer', 'flash', 'glow', 'shock', 'electricflourish',
];

describe('curated gesture set', () => {
    it('registers exactly the keep list', () => {
        expect(listGestures().map(g => g.name).sort()).toEqual([...KEEP].sort());
    });

    it('every kept gesture has a 3D evaluator', () => {
        for (const name of KEEP) expect(typeof getGesture(name)?.['3d']?.evaluate, name).toBe('function');
    });

    it('unknown names resolve to null (no prototype leaks)', () => {
        expect(getGesture('shatter')).toBeNull();
        expect(getGesture('toString')).toBeNull();
    });
});
