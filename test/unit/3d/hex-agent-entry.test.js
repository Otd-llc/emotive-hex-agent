import { describe, it, expect } from 'vitest';

// The single entry registers the electric element and ONLY the shock + electricflourish
// electric gestures, and exports exactly EmotiveMascot3D (+ default) and SSSPresets.
describe('hex-agent entry', () => {
    it('exports only EmotiveMascot3D and SSSPresets', async () => {
        const mod = await import('../../../src/3d/index-hex-agent.js');
        expect(Object.keys(mod).sort()).toEqual(['EmotiveMascot3D', 'SSSPresets', 'default']);
        expect(mod.default).toBe(mod.EmotiveMascot3D);
    });

    it('registers electricity and exactly two electric gestures', async () => {
        await import('../../../src/3d/index-hex-agent.js');
        const { ElementTypeRegistry } = await import('../../../src/3d/effects/ElementTypeRegistry.js');
        const { GESTURE_REGISTRY } = await import('../../../src/core/gestures/index.js');
        expect(ElementTypeRegistry.has('electricity')).toBe(true);
        const electric = Object.values(GESTURE_REGISTRY).filter(g => g?.element === 'electricity' || /electric|shock/.test(g?.name ?? ''));
        expect(electric.map(g => g.name).sort()).toEqual(['electricflourish', 'shock']);
    });
});
