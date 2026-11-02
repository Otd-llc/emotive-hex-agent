/**
 * @fileoverview Registers the 'electricity' element type (instanced material + GLB model
 * config) with the ElementTypeRegistry. Side-effect module: importing it registers the
 * element. ElementRegistrations.js imports all eight; the lean `./3d-electric` entry
 * imports only this one.
 * @module effects/elements/electricity
 */

import { ElementTypeRegistry } from '../ElementTypeRegistry.js';

import {
    createInstancedElectricMaterial,
    updateInstancedElectricMaterial,
    setInstancedElectricArcAnimation,
    setInstancedElectricGestureGlow,
    setInstancedElectricBloomThreshold,
    setInstancedElectricCutout,
    resetCutout as resetElectricCutout,
    setGrain as setElectricGrain,
    resetGrain as resetElectricGrain,
    resetAnimation as resetElectricAnimation,
    setFlash as setElectricFlash,
    resetFlash as resetElectricFlash,
    setRelay as setElectricRelay,
    resetRelay as resetElectricRelay,
} from '../../materials/instanced/InstancedElectricMaterial.js';

// The five Blender meshes shock + electricflourish use, served flat from assetBasePath.
// The ring files lie in the XZ plane; the gesture configs were written for rings in XY, so
// they are turned at load (modelRotation, Euler XYZ radians).
ElementTypeRegistry.register('electricity', {
    basePath: '',
    models: ['arc-small.glb', 'arc-medium.glb', 'spark-node.glb', 'lightning-ring.glb', 'plasma-ring.glb'],
    modelRotation: {
        'lightning-ring.glb': [-Math.PI / 2, 0, 0],
        'plasma-ring.glb': [-Math.PI / 2, 0, 0],
    },
    createMaterial: createInstancedElectricMaterial,
    updateMaterial: updateInstancedElectricMaterial,
    setShaderAnimation: setInstancedElectricArcAnimation,
    setGestureGlow: setInstancedElectricGestureGlow,
    setBloomThreshold: setInstancedElectricBloomThreshold,
    setCutout: setInstancedElectricCutout,
    resetCutout: resetElectricCutout,
    setGrain: setElectricGrain,
    resetGrain: resetElectricGrain,
    setFlash: setElectricFlash,
    resetFlash: resetElectricFlash,
    resetShaderAnimation: resetElectricAnimation,
    setRelay: setElectricRelay,
    resetRelay: resetElectricRelay,
    scaleMultiplier: 1.3,
});

export { ElementTypeRegistry };
