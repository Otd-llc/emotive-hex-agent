/**
 * Core3DManager - Main orchestrator for Three.js 3D rendering
 *
 * Manages:
 * - Three.js renderer
 * - 3D geometry selection
 * - Animation playback
 * - Emotion-based lighting and materials
 *
 * @class Core3DManager
 */

import * as THREE from 'three';
import { ThreeRenderer } from './ThreeRenderer.js';
import { assertAssetBasePath } from './utils/assetBasePath.js';
import { THREE_GEOMETRIES } from './geometries/ThreeGeometries.js';
import { ProceduralAnimator } from './animation/ProceduralAnimator.js';
import { BreathingAnimator } from './animation/BreathingAnimator.js';
import { GestureBlender } from './animation/GestureBlender.js';
import { BlinkAnimator } from './animation/BlinkAnimator.js';
import { GeometryMorpher } from './utils/GeometryMorpher.js';
// Note: Behavior classes (RotationBehavior, RightingBehavior, FacingBehavior)
// are now managed by BehaviorController
import { getEmotion } from '../core/emotions/index.js';
// getGesture - not imported here; gesture lookup handled by AnimationManager and GestureBlender
import { getUndertoneModifier } from '../config/undertoneModifiers.js';
import { hexToRGB, applyUndertoneSaturation } from './utils/ColorUtilities.js';
import { getGlowIntensityForColor, normalizeRGBLuminance } from '../utils/glowIntensityFilter.js';
import ParticleSystem from '../core/ParticleSystem.js';
import { Particle3DTranslator } from './particles/Particle3DTranslator.js';
import { CrystalSoul } from './effects/CrystalSoul.js';
import { Particle3DRenderer } from './particles/Particle3DRenderer.js';
import { Particle3DOrchestrator } from './particles/Particle3DOrchestrator.js';
import { createCustomMaterial, disposeCustomMaterial, disposeTextureCache } from './utils/MaterialFactory.js';
import { resetGeometryState } from './GeometryStateManager.js';
import * as GeometryCache from './utils/GeometryCache.js';
import { AnimationManager } from './managers/AnimationManager.js';
import { BehaviorController } from './managers/BehaviorController.js';
import { BreathingPhaseManager } from './managers/BreathingPhaseManager.js';
import { createElectricMaterial, setElectricCharge } from './materials/overlays/ElectricMaterial.js';
import { ElementInstancedSpawner } from './effects/ElementInstancedSpawner.js';

const DEG = Math.PI / 180;

/**
 * Calibration rotation (radians) for a registry entry: a crystal-family entry's own
 * `calibration` (degrees), zero for anything else.
 * @param {Object} config - THREE_GEOMETRIES entry
 * @param {number[]} [out]
 */
function calibrationFor(config, out = [0, 0, 0]) {
    const c = config?.crystalFamily ? config.calibration : null;
    out[0] = (c?.x ?? 0) * DEG;
    out[1] = (c?.y ?? 0) * DEG;
    out[2] = (c?.z ?? 0) * DEG;
    return out;
}

// Element types this build can preload
const ALL_ELEMENT_TYPES = ['electricity'];


export class Core3DManager {
    /**
     * Create a new Core3DManager instance
     * @param {HTMLCanvasElement} canvas - WebGL canvas element
     * @param {Object} [options={}] - Configuration options
     * @param {string} [options.geometry='sphere'] - Geometry type (sphere, crystal, diamond, moon, sun, etc.)
     * @param {string} [options.emotion='neutral'] - Initial emotion state
     * @param {boolean} [options.enableParticles=true] - Enable particle effects
     * @param {boolean} [options.enablePostProcessing=true] - Enable post-processing (bloom, etc.)
     * @param {boolean} [options.enableShadows=false] - Enable shadow rendering
     * @param {boolean} [options.enableControls=true] - Enable camera orbit controls
     * @param {boolean} [options.autoRotate=true] - Enable auto-rotation
     * @param {number} [options.autoRotateSpeed=0.5] - Auto-rotate speed
     * @param {boolean} [options.enableBlinking=true] - Enable blinking animation
     * @param {boolean} [options.enableBreathing=true] - Enable breathing animation
     * @param {number} [options.cameraDistance=3] - Camera Z distance from origin
     * @param {number} [options.fov=45] - Camera field of view in degrees
     * @param {number} [options.minZoom] - Minimum zoom distance
     * @param {number} [options.maxZoom] - Maximum zoom distance
     * @param {string} [options.materialVariant] - Material variant override
     * @param {string} options.assetBasePath - Base path for loading assets (required)
     * @param {string[]} [options.preloadElements] - Element types to preload immediately (e.g., ['fire', 'ice'])
     */
    constructor(canvas, options = {}) {
        // Validate required dependencies
        if (!canvas) {
            throw new Error('[Core3DManager] canvas element is required');
        }
        if (!(canvas instanceof HTMLCanvasElement)) {
            throw new Error('[Core3DManager] canvas must be an HTMLCanvasElement');
        }
        if (typeof THREE === 'undefined') {
            throw new Error(
                '[Core3DManager] Three.js library is not loaded. Import three.js before using Core3DManager'
            );
        }

        this._instanceId = Math.random().toString(36).substr(2, 6);

        this.canvas = canvas;
        this.options = options;
        this._destroyed = false;
        this._ready = false; // Flag indicating all async loading is complete
        this._readyPromise = null; // Promise that resolves when ready
        // Programs of the core, soul and particles are linked OFF the main thread before the
        // first draw (a cold synchronous link froze the page for seconds); nothing is drawn
        // until then. whenVisible() resolves at that point.
        this._linked = false;
        this._visiblePromise = new Promise(resolve => (this._resolveVisible = resolve));

        // Asset base path for textures and models (configurable for GitHub Pages, etc.)
        // Empty string triggers auto-detection in ThreeRenderer
        assertAssetBasePath(options.assetBasePath);
        this.assetBasePath = options.assetBasePath;


        // Element preloading options
        // preloadElements: specific elements to preload immediately (e.g., ['fire', 'ice'])
        // Default: link the electric pool at mount (background) so the FIRST shock has arcs.
        this._preloadElements = options.preloadElements ?? ALL_ELEMENT_TYPES;

        // Load geometry type first (needed to determine if moon = tidally locked)
        this.geometryType = options.geometry || 'sphere';

        // Initialize Three.js renderer
        this.renderer = new ThreeRenderer(canvas, {
            cameraDistance: options.cameraDistance, // Camera Z distance (undefined = default 3)
            fov: options.fov, // Field of view (undefined = default 45)
            maxPixelRatio: options.maxPixelRatio, // DPR cap (undefined = default 2.0)
            debugShaders: options.debugShaders === true, // sync shader error checks (gates)
        });


        // Register for WebGL context restoration to recreate custom materials
        this.renderer.onContextRestored = () => this._handleContextRestored();

        const geometryConfig = THREE_GEOMETRIES[this.geometryType];

        if (!geometryConfig) {
            console.warn(`[Core3DManager] Unknown geometry: ${this.geometryType}, falling back to sphere`);
            // Guard the fallback itself: dereferencing a missing entry here turns a
            // recoverable typo into a constructor throw, which is how an unregistered
            // 'sphere' took down every default-configured mascot.
            this.geometryConfig = THREE_GEOMETRIES.sphere ?? Object.values(THREE_GEOMETRIES)[0];
            this.geometryType = THREE_GEOMETRIES.sphere ? 'sphere' : Object.keys(THREE_GEOMETRIES)[0];
        } else {
            this.geometryConfig = geometryConfig;
        }

        this.geometry = this.geometryConfig.geometry;

        // Store geometry type name for material/rendering logic
        if (this.geometry && !this.geometry.isGroup) {
            this.geometry.userData.geometryType = this.geometryType;
        }

        // Store materialVariant for use when morphing geometries
        this.materialVariant = options.materialVariant || null;

        // Callback for when material is swapped during morph (allows immediate preset application)
        this.onMaterialSwap = null;

        // Check if this geometry requires custom material (e.g., moon with textures, sun with emissive)
        // Use MaterialFactory for centralized material creation
        // IMPORTANT: Must create material BEFORE calling _loadAsyncGeometry so it's available when OBJ loads
        let customMaterial = null;
        const emotionData = getEmotion(this.emotion);

        // Create callback for when textures finish loading (for moon async textures)
        // This re-runs shard precomputation so shards get the actual texture
        // Capture geometryType NOW to ensure correct type even if morph happens before texture loads
        const geometryTypeForCallback = this.geometryType;
        const onTextureReady = _material => {
        };

        const materialResult = createCustomMaterial(this.geometryType, this.geometryConfig, {
            glowColor: this.glowColor || [1.0, 1.0, 0.95],
            glowIntensity: this.glowIntensity || 1.0,
            materialVariant: this.materialVariant,
            emotionData, // Pass emotion data for auto-deriving geometry params
            assetBasePath: this.assetBasePath,
            onTextureReady,
        });

        if (materialResult) {
            customMaterial = materialResult.material;
            this.customMaterial = customMaterial;
            this.customMaterialType = materialResult.type;
        }

        // Check for async geometry loader (e.g., OBJ models)
        // Must be called AFTER material is created so this.customMaterial is available
        if (this.geometryConfig.geometryLoader) {
            // Store promise so callers can await full initialization
            this._readyPromise = this._loadAsyncGeometry();
        } else {
            // No async loading needed - immediately ready (fallback sphere: drawn as-is)
            this._ready = true;
            this._linked = true;
            this._resolveVisible();
            this._readyPromise = Promise.resolve();
        }

        // Create core mesh with geometry (and optional custom material)
        // If geometry is null (e.g., crystal waiting for OBJ), defer mesh creation
        if (this.geometry === null && this.geometryConfig.geometryLoader) {
            this._deferredMeshCreation = true;
            // Mesh will be created in _loadAsyncGeometry when OBJ loads
        } else {
            this.coreMesh = this.renderer.createCoreMesh(this.geometry, customMaterial);

            // For crystal/rough with blend-layers shader, create inner glowing core
            if (this.customMaterialType === 'crystal') {
                this.createCrystalInnerCore();
            }
        }

        // Calibration rotation offset (applied on top of all animations)
        // Used for moon orientation calibration
        this.calibrationRotation = [0, 0, 0]; // [X, Y, Z] in radians

        // Camera-space roll: rotates the tidally-locked face around camera's viewing axis
        // Applied AFTER all world-space rotations, spins the face like a wheel
        this.cameraRoll = 0; // in radians


        // Calibration rotation from the entry (crystal family), zero otherwise.
        calibrationFor(this.geometryConfig, this.calibrationRotation);
        if (this.geometryConfig.crystalFamily) this.crystalShellBaseScale = this.geometryConfig.shellScale;

        // Animation controller
        this.animator = new ProceduralAnimator();

        // Gesture blender
        this.gestureBlender = new GestureBlender();

        // Animation manager (orchestrates gesture playback and blending)
        this.animationManager = new AnimationManager(this.animator, this.gestureBlender);

        // Behavior controller (manages rotation, righting, and facing behaviors)
        this.behaviorController = new BehaviorController({
            rotationDisabled: options.autoRotate === false,
            wobbleEnabled: true,
            camera: this.renderer.camera,
        });

        // Breathing phase manager (imperative meditation-style breathing control)
        this.breathingPhaseManager = new BreathingPhaseManager();

        // Breathing animator
        this.breathingAnimator = new BreathingAnimator();
        this.breathingEnabled = options.enableBreathing !== false; // Enabled by default

        // Note: Imperative breathing phase animation state is now managed by BreathingPhaseManager
        // See: breathePhase(), stopBreathingPhase(), _updateBreathingPhase()

        // Geometry morpher for smooth shape transitions
        this.geometryMorpher = new GeometryMorpher();
        this._morphBloomFlash = 0; // Bloom flash intensity (1.0 at swap, decays to 0)

        // Blink animator (emotion-aware)
        this.blinkAnimator = new BlinkAnimator(this.geometryConfig);
        this.blinkAnimator.setEmotion(this.emotion);
        this.blinkingManuallyDisabled = false; // Track if user disabled blinking

        // Disable blinking if requested
        if (options.enableBlinking === false) {
            this.blinkAnimator.pause();
            this.blinkingManuallyDisabled = true;
        }

        // Rotation state flags (BehaviorController manages the actual behaviors)
        this.rotationDisabled = options.autoRotate === false; // Disable rotation if autoRotate is false
        this.wobbleEnabled = true; // Wobble/shake effects enabled by default


        // Current state
        this.emotion = options.emotion || 'neutral';
        this.undertone = options.undertone || null;
        this.glowColor = [1.0, 1.0, 1.0]; // RGB
        this.glowColorHex = '#FFFFFF'; // Hex color for luminance normalization
        this.glowIntensity = 1.0;
        // OPTIMIZATION: Cache normalized color to avoid recalculating every frame
        this._normalizedGlowColor = null;
        this.coreGlowEnabled = true; // Toggle to enable/disable core glow
        this.glowIntensityOverride = null; // Manual override for testing
        this.intensityCalibrationOffset = 0; // Universal filter calibration offset

        // Quaternion-based rotation system for smooth 3D orientation
        this.baseEuler = [0, 0, 0]; // Persistent base Euler angles (updated by RotationBehavior)
        this.baseQuaternion = new THREE.Quaternion(); // Ambient rotation (from emotion state)
        this.gestureQuaternion = new THREE.Quaternion(); // Gesture delta rotation (for debugging)
        this.tempEuler = new THREE.Euler(); // Temp for conversions
        this.rotation = [0, 0, 0]; // Final Euler angles for renderer

        // Match 2D sizing: core is 1/12th of canvas size (coreSizeDivisor: 12)
        this.baseScale = 0.16; // Properly sized core relative to particles
        this.scale = 0.16; // Current scale (base + animation)
        this.position = [0, 0, 0];
        this._nonUniformScaleBuf = [1, 1, 1]; // Pre-allocated buffer for nonUniformScale


        // ═══════════════════════════════════════════════════════════════════════════
        // PARTICLE SYSTEM INTEGRATION
        // ═══════════════════════════════════════════════════════════════════════════

        // Enable/disable particles
        this.particlesEnabled = options.enableParticles !== false;
        this.particleVisibility = this.particlesEnabled; // Runtime toggle matches initial state

        // ALWAYS create particle system (even if disabled) so it can be toggled later
        // Create 2D particle system (reuse existing logic)
        const particleSystem = new ParticleSystem(50); // 50 particles max

        // Set canvas size for particle spawning
        particleSystem.canvasWidth = canvas.width;
        particleSystem.canvasHeight = canvas.height;

        // Create 3D translator (converts 2D → 3D)
        // Note: coreRadius3D is now updated each frame from Core3DManager
        // to ensure particles orbit at correct distance regardless of screen size
        const particleTranslator = new Particle3DTranslator({
            worldScale: 2.0,
            baseRadius: 1.5, // Legacy fallback (coreRadius3D takes precedence)
            depthScale: 0.75,
            verticalScale: 1.0,
            coreRadius3D: 2.0, // Initial value, updated each frame
        });

        // Create 3D renderer (Three.js points system)
        // Increased particle count for richer particle effects
        const particleRenderer = new Particle3DRenderer(150, { renderer: this.renderer.renderer });

        // Add particle points to scene
        const particlePoints = particleRenderer.getPoints();
        // Put particles on layer 1 for separate particle bloom pipeline
        // Layer 1 uses white clear color to prevent dark halos from blur sampling
        particlePoints.layers.set(1);
        this.renderer.scene.add(particlePoints);

        // Create orchestrator (coordinates everything)
        this.particleOrchestrator = new Particle3DOrchestrator(
            particleSystem,
            particleTranslator,
            particleRenderer
        );

        // Set geometry type for special rendering rules (e.g., black hole particle culling)
        this.particleOrchestrator.setGeometryType(this.geometryType);

        // If particles disabled, hide them immediately
        if (!this.particlesEnabled) {
            particleRenderer.geometry.setDrawRange(0, 0);
        }



        // ═══════════════════════════════════════════════════════════════════════════
        // ELEMENT SPAWNER (GPU-Instanced)
        // ═══════════════════════════════════════════════════════════════════════════
        // Uses instanced rendering to fix GPU memory leaks from material cloning
        this.elementSpawner = new ElementInstancedSpawner({
            scene: this.renderer.scene,
            assetsBasePath: this.assetBasePath,
            renderer: this.renderer,
        });


        // Initialize with core mesh and camera if available
        // NOTE: Models are NOT preloaded here - they load lazily on first spawn
        // This prevents GPU overhead for demos that don't use elemental gestures
        if (this.renderer?.coreMesh) {
            this.elementSpawner.initialize(this.renderer.coreMesh, this.renderer.camera);
        }

        // Note: Virtual particle pool is now managed by AnimationManager

        // Apply default glass mode for initial geometry (if specified)
        // Crystal and diamond geometries have defaultGlassMode: true
        // BUT skip this if we have a custom material (e.g., blend-layers shader)
        if (this.geometryConfig.defaultGlassMode && !this.customMaterial) {
            this.setGlassMaterialEnabled(true);
        }

        // Pre-allocated render options object to avoid per-frame allocation (16 properties)
        this._renderOptions = {
            position: this.position,
            rotation: this.rotation,
            scale: 0.16,
            nonUniformScale: null,
            glowColor: this.glowColor,
            glowColorHex: '#FFFFFF',
            glowIntensity: 1.0,
            hasActiveGesture: false,
            calibrationRotation: this.calibrationRotation,
            cameraRoll: 0,
            solarEclipse: null,
            deltaTime: 0,
            morphProgress: null,
            hasSoul: false,
            hasParticles: false,
            deformation: null,
        };

        // Initialize emotion
        this.setEmotion(this.emotion);
    }

    // Note: createVirtualParticlePool and getVirtualParticleFromPool
    // have been moved to AnimationManager

    /**
     * Set emotional state
     * Updates glow color, lighting, rotation behavior, and triggers emotion animation
     * @param {string} emotion - Emotion name
     * @param {string|null} undertone - Optional undertone modifier
     */
    setEmotion(emotion, undertone = null) {
        this.emotion = emotion;
        this.undertone = undertone;

        // Get emotion color and intensity from existing emotion system
        const emotionData = getEmotion(emotion);
        if (emotionData && emotionData.visual) {
            // Convert hex to RGB
            if (emotionData.visual.glowColor) {
                let rgb = hexToRGB(emotionData.visual.glowColor);

                // Apply undertone saturation modifier to glow color
                rgb = applyUndertoneSaturation(rgb, undertone);

                this.glowColor = rgb;
                // Store hex color for bloom luminance normalization
                this.glowColorHex = emotionData.visual.glowColor;

                // Compute TARGET normalized color for smooth transition
                const normalized = normalizeRGBLuminance(rgb, 0.3);
                this._targetGlowColor = [normalized.r, normalized.g, normalized.b];

                // Initialize current color if not set (first emotion)
                if (!this._normalizedGlowColor) {
                    this._normalizedGlowColor = [...this._targetGlowColor];
                }

                // Start color transition
                this._colorTransitionProgress = 0;
                this._colorTransitionStart = [...this._normalizedGlowColor];

                // Calculate intensity using universal filter based on color luminance
                // This ensures consistent visibility across all emotions regardless of color brightness
                const materialMode = this.renderer.materialMode || 'glass';
                this.glowIntensity = getGlowIntensityForColor(
                    emotionData.visual.glowColor,
                    this.intensityCalibrationOffset,
                    materialMode
                );
            }

            // Update Three.js lighting based on emotion
            this.renderer.updateLighting(emotion, emotionData);


            // Note: Bloom is updated every frame in render() for smooth transitions
        }

        // Configure behavior controller for this emotion and geometry
        // Get geometry-specific rotation config if available
        const geometryRotation = null;

        // Build facing config for moon if needed
        let facingConfig = null;

        // Configure behaviors via controller
        this.behaviorController.configureForEmotion({
            geometryType: this.geometryType,
            emotionData,
            facingConfig,
            geometryRotation,
        });

        // Reset Euler angles to upright [pitch=0, yaw=current, roll=0]
        // Preserve yaw to maintain current spin direction, but reset pitch/roll
        this.baseEuler[0] = 0; // Reset pitch
        this.baseEuler[2] = 0; // Reset roll
        // Keep baseEuler[1] (yaw) to preserve rotation continuity

        // Apply undertone multipliers if present
        const undertoneModifier = getUndertoneModifier(undertone);

        if (undertoneModifier && undertoneModifier['3d']) {
            this.behaviorController.applyUndertone(undertoneModifier['3d']);
        }

        // Stop previous emotion animations to prevent stacking
        // Use stopEmotions() to preserve active gestures (additive blending)
        this.animator.stopEmotions();

        // Store base glow intensity for this emotion (before animation modulation)
        // Use universal filter to calculate intensity from color luminance
        // Pass material mode so formula adjusts correctly (glass vs glow mode)
        const glowColor = emotionData?.visual?.glowColor || '#00BCD4';
        const materialMode = this.renderer.materialMode || 'glass';
        this.baseGlowIntensity = getGlowIntensityForColor(
            glowColor,
            this.intensityCalibrationOffset,
            materialMode
        );

        // Apply undertone glow multiplier to base intensity
        if (undertoneModifier && undertoneModifier['3d'] && undertoneModifier['3d'].glow) {
            this.baseGlowIntensity *= undertoneModifier['3d'].glow.intensityMultiplier;
        }

        // Update breathing animator with emotion and undertone
        this.breathingAnimator.setEmotion(emotion, undertoneModifier);

        // Update blink animator with new emotion
        this.blinkAnimator.setEmotion(emotion);



        // Trigger emotion animation - now handled by blending system in render()
        this.animator.playEmotion(emotion);

        // ═══════════════════════════════════════════════════════════════════════════
        // UPDATE PARTICLE SYSTEM FOR NEW EMOTION
        // ═══════════════════════════════════════════════════════════════════════════
        if (this.particlesEnabled && this.particleOrchestrator) {
            // Notify orchestrator of emotion change (will recalculate config)
            this.particleOrchestrator.setEmotion(emotion, undertone);
        }

        // ═══════════════════════════════════════════════════════════════════════════
        // UPDATE CRYSTAL SOUL ANIMATION FROM EMOTION CONFIG
        // ═══════════════════════════════════════════════════════════════════════════
        // Soul animation parameters are geometry-agnostic and can be used by:
        // - Crystal (inner core drift/shimmer)
        // - Sun (plasma flow) - future
        // - Moon (subtle glow pulse) - future
        if (emotionData && emotionData.soulAnimation) {
            const soul = emotionData.soulAnimation;
            this.setCrystalSoulEffects({
                driftEnabled: true,
                driftSpeed: soul.driftSpeed || 0.5,
                shimmerEnabled: true,
                shimmerSpeed: soul.shimmerSpeed || 0.5,
                // Note: turbulence will be used for future geometries (Sun plasma chaos)
            });
        }
    }

    /**
     * Enable or disable core glow
     * @param {boolean} enabled - True to enable glow, false to disable
     */
    setCoreGlowEnabled(enabled) {
        this.coreGlowEnabled = enabled;

        // Also toggle crystal soul visibility for crystal-type geometries
        if (this.crystalSoul) {
            this.crystalSoul.setVisible(enabled);
        }
    }

    /**
     * Set glass material mode
     * @param {boolean} enabled - True for glass material, false for glow material
     */
    setGlassMaterialEnabled(enabled) {
        const mode = enabled ? 'glass' : 'glow';
        this.renderer.setMaterialMode(mode);
    }

    /**
     * Set glow intensity override
     * @param {number} intensity - Glow intensity value (0.3-10.0 range for auto system, 0.8-1.2 for normalized), or null to clear override
     */
    setGlowIntensity(intensity) {
        this.glowIntensityOverride = intensity;
        if (intensity !== null) {
            this.glowIntensity = intensity;
            this.baseGlowIntensity = intensity;
        }
    }

    /**
     * Get current glow intensity
     * @returns {number} Current glow intensity
     */
    getGlowIntensity() {
        return this.glowIntensity;
    }

    /**
     * Play gesture animation using 2D gesture data translated to 3D
     * Delegates to AnimationManager for gesture orchestration
     */
    playGesture(gestureName) {
        this.animationManager.playGesture(gestureName, {
            onUpdate: (props, _progress) => {
                if (props.position) this.position = props.position;
                if (props.rotation) {
                    // Convert gesture Euler rotation to quaternion
                    this.tempEuler.set(
                        props.rotation[0],
                        props.rotation[1],
                        props.rotation[2],
                        'XYZ'
                    );
                    this.gestureQuaternion.setFromEuler(this.tempEuler);
                }
                if (props.scale !== undefined) this.scale = this.baseScale * props.scale;
                // Apply glow intensity as multiplier on base intensity (not absolute override)
                if (props.glowIntensity !== undefined) {
                    this.glowIntensity = this.baseGlowIntensity * props.glowIntensity;
                }
            },
            onComplete: () => {
                // Reset to base state
                this.position = [0, 0, 0];
                // NOTE: Don't reset rotation - it's computed from quaternions in render()
                // gestureQuaternion will be reset to identity in render() when no gestures active
                this.scale = this.baseScale;
            },
        });
    }











    /**
     * Set crystal blend layer for a specific visual component
     * @param {string} component - Component name: 'core', 'fresnel', 'trans', 'facet'
     * @param {number} blendIndex - Blend index (1 or 2)
     * @param {Object} params - { mode, strength, enabled }
     */
    setCrystalBlendLayer(component, blendIndex, params = {}) {
        if (!this.geometryConfig?.crystalFamily || !this.customMaterial || this.customMaterialType !== 'crystal') {
            return;
        }

        const prefix = `${component}Blend${blendIndex}`;

        if (params.mode !== undefined && this.customMaterial.uniforms[`${prefix}Mode`]) {
            this.customMaterial.uniforms[`${prefix}Mode`].value = params.mode;
        }
        if (params.strength !== undefined && this.customMaterial.uniforms[`${prefix}Strength`]) {
            this.customMaterial.uniforms[`${prefix}Strength`].value = params.strength;
        }
        if (params.enabled !== undefined && this.customMaterial.uniforms[`${prefix}Enabled`]) {
            this.customMaterial.uniforms[`${prefix}Enabled`].value = params.enabled ? 1.0 : 0.0;
        }
    }

    /**
     * Set crystal shader uniforms
     * @param {Object} params - Crystal uniform values
     */
    setCrystalUniforms(params = {}) {
        if (!this.geometryConfig?.crystalFamily || !this.customMaterial || this.customMaterialType !== 'crystal') {
            console.warn('[Core3DManager] Crystal uniforms only available with crystal blend-layers material');
            return;
        }

        const { uniforms } = this.customMaterial;

        // Helper to safely set uniform value (protect against NaN)
        const safeSet = (uniform, value, min = 0, max = 10) => {
            if (uniform && typeof value === 'number' && !isNaN(value) && isFinite(value)) {
                uniform.value = Math.max(min, Math.min(max, value));
            }
        };

        // Crystal-specific parameters with validation
        safeSet(uniforms.coreGlowStrength, params.coreGlowStrength, 0, 2);
        if (params.coreGlowFalloff !== undefined && !isNaN(params.coreGlowFalloff)) {
            safeSet(uniforms.coreGlowFalloff, params.coreGlowFalloff, 0.1, 3);
            // Also update inner core size
            this.setCrystalCoreSize(params.coreGlowFalloff);
        }
        safeSet(uniforms.fresnelStrength, params.fresnelStrength, 0, 2);
        safeSet(uniforms.fresnelPower, params.fresnelPower, 0.5, 10); // Min 0.5 to avoid pow issues
        safeSet(uniforms.transmissionStrength, params.transmissionStrength, 0, 1);
        safeSet(uniforms.facetStrength, params.facetStrength, 0, 2);
        safeSet(uniforms.iridescenceStrength, params.iridescenceStrength, 0, 1);
        safeSet(uniforms.chromaticAberration, params.chromaticAberration, 0, 1);
        safeSet(uniforms.causticStrength, params.causticStrength, 0, 1);
        safeSet(uniforms.emissiveIntensity, params.emissiveIntensity, 0, 5);

        // Animation controls
        safeSet(uniforms.sparkleEnabled, params.sparkleEnabled, 0, 1);
        safeSet(uniforms.sparkleSpeed, params.sparkleSpeed, 0.1, 5);
        safeSet(uniforms.causticEnabled, params.causticEnabled, 0, 1);
        safeSet(uniforms.causticSpeed, params.causticSpeed, 0.1, 10);
        safeSet(uniforms.causticScale, params.causticScale, 0.5, 10);
        safeSet(uniforms.causticCoverage, params.causticCoverage, 0, 1);
        safeSet(uniforms.energyPulseEnabled, params.energyPulseEnabled, 0, 1);
        safeSet(uniforms.energyPulseSpeed, params.energyPulseSpeed, 0.1, 5);
    }

    /**
     * Create inner glowing core for crystal-type geometries
     * Uses CrystalSoul class for reusable soul effect
     */
    createCrystalInnerCore() {
        // Dispose existing soul if present
        if (this.crystalSoul) {
            this.crystalSoul.dispose();
            this.crystalSoul = null;
        }

        // Invalidate renderer's cached soul reference so it re-traverses on next render
        if (this.renderer) this.renderer.invalidateSoulCache();

        if (!this.coreMesh) {
            return;
        }

        // Create new soul and attach to coreMesh
        // Pass renderer for scene locking during async geometry swaps
        // Use _targetGeometryType during morph, fall back to geometryType for initial load
        const effectiveGeometryType = this._targetGeometryType || this.geometryType;
        this.crystalSoul = new CrystalSoul({
            radius: 0.35,
            detail: 1,
            geometryType: effectiveGeometryType,
            renderer: this.renderer,
            assetBasePath: this.assetBasePath,
        });
        this.crystalSoul.attachTo(this.coreMesh, this.renderer?.scene);

        // Shell and soul sizes come from the entry (use the morph target's during a morph).
        const cfg = this._targetGeometryConfig || this.geometryConfig;
        this.crystalShellBaseScale = cfg?.shellScale ?? 2.0;
        const soulScale = cfg?.soulScale ?? 1.0;

        this.crystalSoul.baseScale = soulScale;
        this.crystalSoul.mesh.scale.setScalar(soulScale);

        // Respect coreGlowEnabled toggle state
        this.crystalSoul.setVisible(this.coreGlowEnabled);

        // Legacy references for backwards compatibility
        this.crystalInnerCore = this.crystalSoul.mesh;
        this.crystalInnerCoreMaterial = this.crystalSoul.material;
        this.crystalInnerCoreBaseScale = this.crystalSoul.baseScale;
    }

    /**
     * Update crystal inner core color, intensity, and animation based on emotion
     * @param {Array} glowColor - RGB color array [r, g, b] (0-1 range)
     * @param {number} deltaTime - Time since last frame in ms (for animation)
     */
    updateCrystalInnerCore(glowColor, deltaTime = 0) {
        if (!this.crystalSoul) {
            return;
        }

        // Get breathing scale if enabled
        const breathScale =
            this.breathingAnimator && this.breathingEnabled
                ? this.breathingAnimator.getBreathingScale()
                : 1.0;

        // Update the soul
        this.crystalSoul.update(deltaTime, glowColor, breathScale);

        // Keep legacy reference in sync
        this.crystalInnerCoreBaseScale = this.crystalSoul.baseScale;
    }

    /**
     * Set crystal soul effect parameters
     * @param {Object} params - Soul effect parameters
     * @param {boolean} params.driftEnabled - Enable/disable drifting energy
     * @param {number} params.driftSpeed - Drift animation speed (0.1-3.0)
     * @param {boolean} params.shimmerEnabled - Enable/disable vertical shimmer
     * @param {number} params.shimmerSpeed - Shimmer animation speed (0.1-3.0)
     */
    setCrystalSoulEffects(params = {}) {
        if (!this.crystalSoul) return;
        this.crystalSoul.setEffects(params);
    }

    /**
     * Set crystal inner core (soul) size
     * @param {number} size - Size value 0-1, where 0.5 is default
     */
    setCrystalCoreSize(size) {
        if (!this.crystalSoul) return;
        this.crystalSoul.setSize(size);
        this.crystalInnerCoreBaseScale = this.crystalSoul.baseScale;
    }

    /**
     * Set crystal shell size (outer crystal)
     * @param {number} size - Size value 0.5-2.0, where 1.0 is default
     */
    setCrystalShellSize(size) {
        if (!this.coreMesh || !this.geometryConfig?.crystalFamily) return;

        // Store base shell scale for use during rendering
        this.crystalShellBaseScale = size;
        // Don't apply directly - it will be applied in render() along with other transforms
    }

    /**
     * Enable or disable wobble/shake effects on rotation
     * @param {boolean} enabled - Whether wobble is enabled
     */
    setWobbleEnabled(enabled) {
        this.wobbleEnabled = enabled;
        this.behaviorController.setWobbleEnabled(enabled);

        // Clear freeze-wobble tracking so the per-frame freeze logic
        // doesn't override this explicit user toggle
        this._wobbleWasFrozen = false;

        // When disabling wobble, reset pitch/roll to upright, preserve yaw for rotation continuity
        if (!enabled) {
            this.baseEuler[0] = 0; // Reset pitch
            this.baseEuler[2] = 0; // Reset roll
        }
    }

    /**
     * Set material variant for use in morphing
     * Call this before morphToShape() to change material during transition
     * @param {string|null} variant - Material variant (e.g., 'multiplexer' for moon blood moon support)
     */
    setMaterialVariant(variant) {
        this.materialVariant = variant;
    }














    // ═══════════════════════════════════════════════════════════════════════════
    // IMPERATIVE BREATHING PHASE API (for meditation)
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Animate mascot scale for a breathing phase over a specified duration.
     * Used by meditation controller for precise breathing exercise timing.
     *
     * Scale targets:
     * - 'inhale': 1.0 → 1.3 (grow larger as lungs fill)
     * - 'exhale': current → 0.85 (shrink as lungs empty)
     * - 'hold': maintain current scale (no animation)
     *
     * @param {string} phase - 'inhale' | 'exhale' | 'hold'
     * @param {number} durationSec - Duration in seconds for the animation
     */
    breathePhase(phase, durationSec) {
        // Delegate to BreathingPhaseManager
        this.breathingPhaseManager.startPhase(phase, durationSec);
    }

    /**
     * Stop any active breathing phase animation and reset to neutral scale
     */
    stopBreathingPhase() {
        this.breathingPhaseManager.stop();
    }

    /**
     * Update imperative breathing phase animation
     * Called from render loop
     * @private
     * @param {number} deltaTime - Time since last frame in ms
     * @returns {number} Current breathing phase scale multiplier (1.0 if inactive)
     */
    _updateBreathingPhase(deltaTime) {
        // Delegate to BreathingPhaseManager
        return this.breathingPhaseManager.update(deltaTime);
    }

    /**
     * Morph to different shape with smooth transition
     * Supports interruption - calling this while a morph is in progress will
     * smoothly transition to the new target without visual glitches.
     *
     * @param {string} shapeName - Target geometry name
     * @param {number} duration - Transition duration in ms (default: 600ms)
     */
    morphToShape(shapeName, duration = 600) {
        const targetGeometryConfig = THREE_GEOMETRIES[shapeName];
        if (!targetGeometryConfig) {
            console.warn(`[Core3DManager] Unknown shape: ${shapeName}`);
            return;
        }


        // Start smooth morph transition (handles interruptions internally)
        const started = this.geometryMorpher.startMorph(this.geometryType, shapeName, duration);

        // If morph didn't start (already at target), skip
        if (!started) {
            return;
        }

        // Check if this was an interruption that changed the target
        // (getInterruptedTarget clears the flag after reading)
        this.geometryMorpher.getInterruptedTarget();

        // Pause blinks during morph (cleaner visual experience)
        this.blinkAnimator.pause();

        // Store target geometry for when morph completes
        this._targetGeometryConfig = targetGeometryConfig;
        this._targetGeometryType = shapeName;

        // Handle async geometry loaders (e.g., crystal OBJ)
        if (targetGeometryConfig.geometryLoader && !targetGeometryConfig.geometry) {
            // Start loading during shrink phase so it's ready for swap
            this._targetGeometry = null; // Will be set when loaded
            this._pendingGeometryLoad = targetGeometryConfig
                .geometryLoader(this.assetBasePath)
                .then(geometry => {
                    this._targetGeometry = geometry;
                    // Also update the registry so subsequent morphs don't need to reload
                    targetGeometryConfig.geometry = geometry;
                    this._pendingGeometryLoad = null;
                });
        } else {
            this._targetGeometry = targetGeometryConfig.geometry;
            this._pendingGeometryLoad = null;
        }
    }

    /**
     * Check if a morph is currently in progress
     * @returns {boolean} True if morphing
     */
    isMorphing() {
        return this.geometryMorpher.isTransitioning;
    }

    /**
     * Check if the current custom material's textures have finished loading.
     * Three.js textureLoader.load() returns a Texture immediately but the
     * image data arrives asynchronously — .image is null until loaded.
     * @returns {boolean} True if all textures are ready (or no custom material)
     */
    _isMaterialTextureReady() {
        if (!this.customMaterial) return true;
        const { uniforms } = this.customMaterial;
        for (const key of Object.keys(uniforms)) {
            const val = uniforms[key].value;
            if (val && val.isTexture && !val.image) {
                return false;
            }
        }
        return true;
    }

    /**
     * Get current morph state for debugging/UI
     * @returns {Object} Morph state including progress, target, etc.
     */
    getMorphState() {
        return this.geometryMorpher.getState();
    }

    /**
     * Ramp the crystal's in-shader glow (uGlow) to `level` over `ms`.
     * @param {number} level - 1 = rest
     * @param {number} ms
     */
    setGlow(level, ms) {
        const u = this.customMaterial?.uniforms?.uGlow;
        if (!u) return;
        this._glowRamp = { from: u.value, to: Math.max(0, level), ms: Math.max(1, ms), t: 0 };
    }

    /**
     * Shrink to scale 0 (mirror of growIn) and stay hidden until growIn.
     * @param {number} [duration=500]
     */
    shrinkOut(duration = 500) {
        this.geometryMorpher.shrinkOut(this.geometryType, duration);
    }

    /**
     * Start a grow-in animation from scale 0 to 1
     * Used for initial appearance of mascots (pop-in effect)
     * @param {number} duration - Duration in milliseconds (default: 500ms)
     */
    growIn(duration = 500) {
        this.geometryMorpher.growIn(this.geometryType, duration);
    }

    /**
     * Easing function for smooth transitions
     * @param {number} t - Progress (0.0 to 1.0)
     * @returns {number} - Eased progress
     */
    easeInOutCubic(t) {
        return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }

    /**
     * Render frame
     */
    render(deltaTime) {

        // Guard against calls after destroy
        if (this._destroyed) {
            return;
        }

        // Guard against rendering before geometry is ready (async loading)
        // This prevents Three.js errors during crystal/rough OBJ loading
        // Callers should use waitUntilReady() before starting render loop
        if (!this._ready || !this._linked) {
            return;
        }

        // Store deltaTime in seconds for particle systems
        this._lastDeltaTime = deltaTime / 1000;

        // Update animations
        this.animator.update(deltaTime);

        // Update geometry morph animation
        const morphState = this.geometryMorpher.update(deltaTime);

        // If waiting for async geometry to load, pause morph at midpoint
        if (morphState.shouldSwapGeometry && this._pendingGeometryLoad) {
            // Geometry still loading - pause at minimum scale until ready
            this.geometryMorpher.pauseAtSwap();
        }

        // Check if async geometry finished loading while paused
        if (
            morphState.waitingForGeometry &&
            this._targetGeometry &&
            !this._pendingGeometryLoad
        ) {
            this.geometryMorpher.resumeFromSwap();
            // Re-trigger swap by setting hasSwappedGeometry back to false
            this.geometryMorpher.hasSwappedGeometry = false;
        }

        // Swap geometry at midpoint (when scale is at minimum ~0) for smooth transition
        // After swap, pause the morph clock at scale=0 until material textures
        // are loaded and Three.js scene has stabilized (min 2 frames).
        if (morphState.shouldSwapGeometry && this._targetGeometry) {
            // Trigger bloom flash to mask the geometry swap
            this._morphBloomFlash = 1.0;
            // ═══════════════════════════════════════════════════════════════════
            // RESET OLD GEOMETRY STATE
            // Clear shader uniforms to defaults before swapping to prevent
            // visual remnants (e.g., blood moon effects bleeding to crystal)
            // ═══════════════════════════════════════════════════════════════════
            // Crystal to crystal (same shader, no per-shape overrides): keep the material and
            // the soul, so the morph never releases and relinks a program and the gem colour
            // (incl. a running setGemColor shift) carries straight through.
            const reuseCrystal =
                this.customMaterialType === 'crystal' &&
                this.geometryConfig?.crystalFamily === true &&
                this._targetGeometryConfig?.crystalFamily === true &&
                !this.geometryConfig.materialOverrides &&
                !this._targetGeometryConfig.materialOverrides;

            if (this.customMaterial && !reuseCrystal) {
                resetGeometryState(this.geometryConfig, this.customMaterial);
            }

            this.geometry = this._targetGeometry;
            this.geometryType = this._targetGeometryType;
            this.geometryConfig = this._targetGeometryConfig;

            // Dispose old custom material textures before creating new ones (prevent GPU memory leak)
            if (this.customMaterial && !reuseCrystal) {
                // Use MaterialFactory for proper disposal of textures
                disposeCustomMaterial(this.customMaterial);
                // Then dispose the material itself
                this.renderer.disposeMaterial(this.customMaterial);
                this.customMaterial = null;
                this.customMaterialType = null;
            }

            // Check if target geometry needs custom material (e.g., moon, sun, future black hole)
            // Use MaterialFactory for centralized material creation
            let customMaterial = null;
            const emotionData = getEmotion(this.emotion);

            // Create callback for when textures finish loading (for moon async textures)
            // This re-runs shard precomputation so shards get the actual texture
            // IMPORTANT: Capture geometryType NOW because _targetGeometryType gets cleared after morph
            const geometryTypeForCallback = this._targetGeometryType;
            const onTextureReady = _material => {
            };

            const materialResult = reuseCrystal
                ? { material: this.customMaterial, type: 'crystal' }
                : createCustomMaterial(this._targetGeometryType, this._targetGeometryConfig, {
                      glowColor: this.glowColor || [1.0, 1.0, 0.95],
                      glowIntensity: this.glowIntensity || 1.0,
                      materialVariant: this.materialVariant,
                      emotionData, // Pass emotion data for auto-deriving geometry params
                      assetBasePath: this.assetBasePath,
                      onTextureReady,
                  });

            if (materialResult) {
                customMaterial = materialResult.material;
                this.customMaterial = customMaterial;
                this.customMaterialType = materialResult.type;
            }
            // Note: If not using custom material, references were already cleared above

            // Swap geometry (and material if custom)
            if (customMaterial) {
                this.renderer.swapGeometry(this.geometry, customMaterial);
            } else {
                this.renderer.swapGeometry(this.geometry);

                // Apply default glass mode for this geometry (only for non-custom materials)
                // Crystal and diamond have defaultGlassMode: true, others default to false
                const shouldEnableGlass = this._targetGeometryConfig.defaultGlassMode === true;
                this.setGlassMaterialEnabled(shouldEnableGlass);
            }

            // Invoke material swap callback immediately (before geometry becomes visible)
            // This allows presets to be applied while scale is still 0 (a new material only)
            if (this.onMaterialSwap && !reuseCrystal) {
                this.onMaterialSwap({
                    geometryType: this._targetGeometryType,
                    material: this.customMaterial,
                    materialType: this.customMaterialType,
                });
            }

            // Update blink animator with new geometry's blink config
            this.blinkAnimator.setGeometry(this._targetGeometryConfig);

            // Reset Euler angles to upright [pitch=0, yaw=0, roll=0]
            this.rotation = [0, 0, 0];



            // Create or dispose the soul: crystal family only (flag, not name).
            if (this._targetGeometryConfig?.crystalFamily) {
                if (reuseCrystal && this.crystalSoul) {
                    // Keep the soul (and its program); take the target entry's sizes.
                    this.crystalShellBaseScale = this._targetGeometryConfig.shellScale ?? 2.0;
                    this.crystalSoul.baseScale = this._targetGeometryConfig.soulScale ?? 1.0;
                    this.crystalSoul.mesh.scale.setScalar(this.crystalSoul.baseScale);
                    this.crystalInnerCoreBaseScale = this.crystalSoul.baseScale;
                } else if (this.customMaterialType === 'crystal') {
                    this.createCrystalInnerCore();
                }
            } else {
                if (this.crystalSoul) {
                    this.crystalSoul.dispose();
                    this.crystalSoul = null;
                    this.crystalInnerCore = null;
                    this.crystalInnerCoreMaterial = null;
                    if (this.renderer) this.renderer.invalidateSoulCache();
                }
            }

            // Update behavior controller for target geometry
            // Build facing config for moon if needed
            let facingConfig = null;

            // Configure behaviors for target geometry via controller
            // Note: emotionData is already declared above in this scope
            this.behaviorController.configureForMorph({
                targetGeometryType: this._targetGeometryType,
                emotionData,
                facingConfig,
                geometryRotation: null, // No geometry-specific rotation during morph
            });


            // Calibration from the target entry (zero for non-crystal entries).
            calibrationFor(this._targetGeometryConfig, this.calibrationRotation);

            // No post-swap hold — mascot is at 8% scale (nearly invisible) so
            // textures load from cache or network by the time it's large enough to see.
            // Force opacity to 1.0 immediately to prevent fade-in flash.
            if (this._electricOverlayMesh) this._electricOverlayMesh.geometry = this.geometry;
            if (this.customMaterial?.uniforms?.opacity) {
                this.customMaterial.uniforms.opacity.value = 1.0;
            }
        }

        // Clean up on completion and resume blinks
        if (morphState.completed) {
            this._targetGeometry = null;
            this._targetGeometryType = null;
            this._targetGeometryConfig = null;

            // Resume blinks after morph completes (unless manually disabled)
            if (!this.blinkingManuallyDisabled) {
                this.blinkAnimator.resume();
            }
        }

        // Update breathing animation
        this.breathingAnimator.update(
            deltaTime,
            this.emotion,
            getUndertoneModifier(this.undertone)
        );

        // Update imperative breathing phase (for meditation)
        const imperativeBreathScale = this._updateBreathingPhase(deltaTime);

        // Get breathing scale multiplier
        // If imperative breathing is active (scale != 1.0), use it exclusively
        // Otherwise fall back to ambient breathing if enabled
        const breathScale =
            imperativeBreathScale !== 1.0
                ? imperativeBreathScale
                : this.breathingEnabled
                  ? this.breathingAnimator.getBreathingScale()
                  : 1.0;

        // Get morph scale multiplier (for shrink/grow effect)
        const morphScale = morphState.scaleMultiplier;

        // Decay morph bloom flash (exponential, ~15 frames to vanish)
        if (this._morphBloomFlash > 0) {
            this._morphBloomFlash *= 0.85;
            if (this._morphBloomFlash < 0.01) this._morphBloomFlash = 0;
        }


        // Update blink animation
        const blinkState = this.blinkAnimator.update(deltaTime);

        // Update all behaviors (rotation, righting, facing) via controller
        // This handles: ambient spin, self-stabilization, and tidal lock for moon
        // Apply freeze from previous frame's hold gesture (reduces rotation speed)
        const freezeRotation = this._pendingFreezeRotation || 0;
        const freezeWobble = this._pendingFreezeWobble || 0;

        // Temporarily reduce rotation speed if frozen
        if (freezeRotation > 0) {
            // Scale delta time by freeze amount (0 = normal, 1 = frozen)
            const frozenDeltaTime = deltaTime * (1.0 - freezeRotation);
            this.behaviorController.update(frozenDeltaTime, this.baseEuler);
        } else {
            this.behaviorController.update(deltaTime, this.baseEuler);
        }

        // Set wobble enabled based on freeze (temporarily disable during hold)
        if (freezeWobble > 0.5 && this.wobbleEnabled) {
            this.behaviorController.setWobbleEnabled(false);
            this._wobbleWasFrozen = true;
        } else if (this._wobbleWasFrozen && freezeWobble < 0.5) {
            this.behaviorController.setWobbleEnabled(this.wobbleEnabled);
            this._wobbleWasFrozen = false;
        }

        // HARD LIMIT: Clamp pitch and roll to prevent lateral/dolphin tipping
        // No emotion should ever tip more than ~20 degrees from upright
        const MAX_TILT_ANGLE = 0.35; // ~20 degrees in radians
        this.baseEuler[0] = Math.max(-MAX_TILT_ANGLE, Math.min(MAX_TILT_ANGLE, this.baseEuler[0])); // Pitch (X)
        this.baseEuler[2] = Math.max(-MAX_TILT_ANGLE, Math.min(MAX_TILT_ANGLE, this.baseEuler[2])); // Roll (Z)
        // Yaw (Y) is left unclamped for free rotation

        // Convert base Euler to quaternion
        this.tempEuler.set(this.baseEuler[0], this.baseEuler[1], this.baseEuler[2], 'XYZ');
        this.baseQuaternion.setFromEuler(this.tempEuler);

        // ═══════════════════════════════════════════════════════════════════════════
        // GESTURE BLENDING SYSTEM - Blend multiple simultaneous gestures
        // ═══════════════════════════════════════════════════════════════════════════
        const blended = this.animationManager.blend(
            this.baseEuler, // Pass raw Euler angles to avoid gimbal lock
            this.baseScale,
            this.baseGlowIntensity
        );

        // Initialize smoothed boost values
        if (this._smoothedBoost === undefined) {
            this._smoothedBoost = { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1.0 };
        }

        const dt = deltaTime / 1000;
        const t = 1 - Math.exp(-12.0 * dt);

        // Smooth boost values toward their targets (same speed as groove)
        const targetPosBoost = blended.positionBoost || [0, 0, 0];
        const targetRotBoost = blended.rotationBoost || [0, 0, 0];
        const targetScaleBoost = blended.scaleBoost || 1.0;

        for (let i = 0; i < 3; i++) {
            this._smoothedBoost.position[i] +=
                (targetPosBoost[i] - this._smoothedBoost.position[i]) * t;
            this._smoothedBoost.rotation[i] +=
                (targetRotBoost[i] - this._smoothedBoost.rotation[i]) * t;
        }
        this._smoothedBoost.scale += (targetScaleBoost - this._smoothedBoost.scale) * t;

        // Use smoothed boost values (computed above) for all channels
        const posBoost = this._smoothedBoost.position;
        const rotBoost = this._smoothedBoost.rotation;
        const scaleBoost = this._smoothedBoost.scale;

        // ═══════════════════════════════════════════════════════════════════════════
        // CAMERA-RELATIVE TRANSFORMS: View-space position & rotation to world-space
        // ═══════════════════════════════════════════════════════════════════════════
        // This enables "tidally locked" gestures that move toward/away from camera
        // regardless of camera angle. View-space: Z = toward camera, Y = up, X = right
        let camRelWorldX = 0,
            camRelWorldY = 0,
            camRelWorldZ = 0;
        this._cameraRoll = 0; // Reset camera roll each frame

        if (blended.hasCameraRelativeGestures && this.renderer.camera) {
            const cam = this.renderer.camera;
            const camRelPos = blended.cameraRelativePosition;

            // Get camera's basis vectors in world space
            // Forward = direction camera is looking (negative Z in camera space)
            // We want "toward camera" so we negate it
            if (!this._camTempVec3) {
                this._camTempVec3 = new THREE.Vector3();
                this._camRight = new THREE.Vector3();
                this._camUp = new THREE.Vector3();
                this._camForward = new THREE.Vector3();
            }

            // Ensure camera matrix is up to date
            cam.updateMatrixWorld();

            // Get camera direction (where it's looking)
            cam.getWorldDirection(this._camForward);

            // Right vector = camera's X axis in world space
            this._camRight.setFromMatrixColumn(cam.matrixWorld, 0);

            // Up vector = camera's Y axis in world space
            this._camUp.setFromMatrixColumn(cam.matrixWorld, 1);

            // Transform view-space position to world-space:
            // X (right in view) -> camera right
            // Y (up in view) -> camera up
            // Z (toward camera in view) -> negative camera forward
            camRelWorldX =
                this._camRight.x * camRelPos[0] +
                this._camUp.x * camRelPos[1] -
                this._camForward.x * camRelPos[2];
            camRelWorldY =
                this._camRight.y * camRelPos[0] +
                this._camUp.y * camRelPos[1] -
                this._camForward.y * camRelPos[2];
            camRelWorldZ =
                this._camRight.z * camRelPos[0] +
                this._camUp.z * camRelPos[1] -
                this._camForward.z * camRelPos[2];

            // Camera-relative rotation: use the cameraRoll parameter in renderer
            // This rotates around the camera's forward vector, giving true "lean left/right as seen"
            const camRelRot = blended.cameraRelativeRotation;
            if (camRelRot && camRelRot[2] !== 0) {
                // Z roll in view space = rotation around camera forward = cameraRoll
                this._cameraRoll = camRelRot[2];
            } else {
                this._cameraRoll = 0;
            }
        }

        // (Camera-relative rotation is applied via cameraRoll in renderer)
        this.position[0] = blended.position[0] + camRelWorldX + posBoost[0];
        this.position[1] = blended.position[1] + camRelWorldY + posBoost[1];
        this.position[2] = blended.position[2] + camRelWorldZ + posBoost[2];
        this.rotation[0] = blended.rotation[0] + rotBoost[0];
        this.rotation[1] = blended.rotation[1] + rotBoost[1];
        this.rotation[2] = blended.rotation[2] + rotBoost[2];
        this.scale = blended.scale * scaleBoost;
        // Non-uniform scale (squash/stretch) - apply scale boost
        if (blended.nonUniformScale) {
            this._nonUniformScaleBuf[0] = blended.nonUniformScale[0] * scaleBoost;
            this._nonUniformScaleBuf[1] = blended.nonUniformScale[1] * scaleBoost;
            this._nonUniformScaleBuf[2] = blended.nonUniformScale[2] * scaleBoost;
            this.nonUniformScale = this._nonUniformScaleBuf;
        } else {
            this.nonUniformScale = null;
        }

        // Only apply blended glow if no manual override is active
        if (this.glowIntensityOverride === null) {
            this.glowIntensity = blended.glowIntensity;
        }
        this.gestureQuaternion = blended.gestureQuaternion;
        this.glowBoost = blended.glowBoost || 0; // For isolated glow layer

        // ═══════════════════════════════════════════════════════════════════════════
        // GLOW COLOR OVERRIDE - Temporary glow color from electric/elemental effects
        // ═══════════════════════════════════════════════════════════════════════════
        // When a gesture provides glowColorOverride, temporarily use that color
        // instead of the emotion glow color. This creates electric cyan, fire orange, etc.
        if (blended.glowColorOverride) {
            // Store original color if not already stored
            if (!this._originalGlowColor) {
                this._originalGlowColor = [...this.glowColor];
            }
            // Apply override
            this.glowColor = [...blended.glowColorOverride];
        } else if (this._originalGlowColor) {
            // Smooth lerp back to original color — prevents instant snap when
            // gesture ends and glowColorOverride drops to null in one frame.
            // Exponential lerp: ~8 frames to converge at 60fps.
            const lerpRate = 0.2;
            this.glowColor[0] += (this._originalGlowColor[0] - this.glowColor[0]) * lerpRate;
            this.glowColor[1] += (this._originalGlowColor[1] - this.glowColor[1]) * lerpRate;
            this.glowColor[2] += (this._originalGlowColor[2] - this.glowColor[2]) * lerpRate;
            // Check if close enough to snap to final value
            const diff =
                Math.abs(this.glowColor[0] - this._originalGlowColor[0]) +
                Math.abs(this.glowColor[1] - this._originalGlowColor[1]) +
                Math.abs(this.glowColor[2] - this._originalGlowColor[2]);
            if (diff < 0.01) {
                this.glowColor = [...this._originalGlowColor];
                this._originalGlowColor = null;
            }
        }

        // ═══════════════════════════════════════════════════════════════════════════
        // ELECTRIC OVERLAY - Additive lightning effect rendered ON TOP of mesh
        // ═══════════════════════════════════════════════════════════════════════════
        // Creates a duplicate mesh with electric shader that renders additively,
        // so lightning appears on top of the original mesh appearance.
        if (blended.electricOverlay && blended.electricOverlay.enabled) {
            const mesh = this.renderer?.coreMesh;
            const scene = this.renderer?.scene;
            if (mesh && scene) {
                // Attach the (persistent, pre-linked) overlay for this gesture
                if (!this._electricOverlayMesh?.parent) {
                    const overlay = this._getElectricOverlay(mesh);
                    setElectricCharge(this._electricMaterial, Math.min(1.0, blended.electricOverlay.charge));
                    overlay.geometry = mesh.geometry;
                    mesh.add(overlay);
                }

                // Spawn 3D electricity elements
                this._spawnElement('electricity', blended.electricOverlay, {
                    signatureSet: '_electricSpawnedSignatures',
                    signatureKey: '_electricSpawnSignature',
                    exitScope: 'electricity',
                });

                // Update electric material each frame
                if (this._electricMaterial?.uniforms?.uTime) {
                    this._electricMaterial.uniforms.uTime.value = blended.electricOverlay.time;
                }
                // Update charge dynamically
                if (this._electricMaterial?.uniforms?.uCharge) {
                    this._electricMaterial.uniforms.uCharge.value = Math.min(
                        1.0,
                        blended.electricOverlay.charge
                    );
                }

                // Store gesture progress for element spawner animation
                this._currentElectricProgress = blended.electricOverlay.progress ?? null;
            }
        } else if (this._electricOverlayMesh?.parent) {
            // Detach the overlay when the electric effect ends (kept for the next gesture,
            // so its program is never released and relinked)
            if (this._electricOverlayMesh.parent) {
                this._electricOverlayMesh.parent.remove(this._electricOverlayMesh);
            }

            // Gracefully exit electricity elements (fade out)
            if (this.elementSpawner) {
                this.elementSpawner.triggerExit('electricity');
            }

            // Clear spawn tracking so next gesture session starts fresh
            this._electricSpawnSignature = null;
            this._electricSpawnedSignatures = null;

            // Clear electric progress tracking
            this._currentElectricProgress = null;
        }

        // ═══════════════════════════════════════════════════════════════════════════
        // MESH OPACITY - Fade mascot in/out (for smokebomb/vanish/materialize)
        // ═══════════════════════════════════════════════════════════════════════════
        // Controls the main mesh's opacity independent of glow/overlay effects.
        // Used for ninja smokebomb (fade while hidden by smoke) and magician vanish.
        // Works with both ShaderMaterial (uOpacity/opacity uniform) and standard materials.
        if (blended.meshOpacity !== undefined && blended.meshOpacity < 1.0) {
            const mesh = this.renderer?.coreMesh;
            if (mesh?.material) {
                // ShaderMaterial - check for uOpacity or opacity uniform
                if (mesh.material.uniforms?.uOpacity) {
                    mesh.material.uniforms.uOpacity.value = blended.meshOpacity;
                } else if (mesh.material.uniforms?.opacity) {
                    // MaterialFactory creates materials with 'opacity' uniform
                    mesh.material.uniforms.opacity.value = blended.meshOpacity;
                }
                // Standard materials use opacity property
                else if (mesh.material.opacity !== undefined) {
                    if (this._originalMeshOpacity === undefined) {
                        this._originalMeshOpacity = mesh.material.opacity ?? 1.0;
                        this._originalMeshTransparent = mesh.material.transparent ?? false;
                    }
                    mesh.material.transparent = true;
                    mesh.material.opacity = blended.meshOpacity;
                    mesh.material.needsUpdate = true;
                }
            }
        } else if (blended.meshOpacity === undefined || blended.meshOpacity >= 1.0) {
            // Restore full opacity when effect ends
            const mesh = this.renderer?.coreMesh;
            if (mesh?.material) {
                // ShaderMaterial - check for uOpacity or opacity uniform
                if (mesh.material.uniforms?.uOpacity) {
                    mesh.material.uniforms.uOpacity.value = 1.0;
                } else if (mesh.material.uniforms?.opacity) {
                    mesh.material.uniforms.opacity.value = 1.0;
                }
                // Standard materials - restore original
                else if (this._originalMeshOpacity !== undefined) {
                    mesh.material.opacity = this._originalMeshOpacity;
                    mesh.material.transparent = this._originalMeshTransparent;
                    mesh.material.needsUpdate = true;
                    this._originalMeshOpacity = undefined;
                    this._originalMeshTransparent = undefined;
                }
            }
        }


        // Store freeze values for next frame's behavior controller update
        // (Behavior controller runs before blending, so we use previous frame's freeze)
        this._pendingFreezeRotation = blended.freezeRotation || 0;
        this._pendingFreezeWobble = blended.freezeWobble || 0;

        // ═══════════════════════════════════════════════════════════════════════════
        // DEFORMATION - Localized vertex displacement for impact effects
        // ═══════════════════════════════════════════════════════════════════════════
        //
        // Transforms impactPoint from CAMERA-RELATIVE to MESH-LOCAL space.
        // This enables "tidal locking" - the dent always appears on the camera-facing
        // side regardless of mesh rotation.
        //
        // Coordinate transformation:
        // 1. Gesture provides impactPoint in camera-relative coords (X=right, Y=up, Z=toward camera)
        // 2. We convert to WORLD space using camera basis vectors (same as cameraRelativePosition)
        // 3. We convert WORLD to MESH-LOCAL using inverse mesh quaternion (rotation only, not translation)
        //
        // Why quaternion instead of worldToLocal()?
        // - worldToLocal() transforms POINTS (includes translation offset)
        // - We need to transform a DIRECTION (rotation only)
        // - Using inverse quaternion gives us pure rotational transformation
        //
        // See: deformation.js for shader code, oofFactory.js for gesture definitions
        if (
            blended.deformation &&
            blended.deformation.enabled &&
            this.renderer?.camera &&
            this.renderer?.coreMesh
        ) {
            const d = blended.deformation;
            const ip = d.impactPoint;
            const cam = this.renderer.camera;
            const mesh = this.renderer.coreMesh;

            // Ensure matrices are up to date
            cam.updateMatrixWorld();
            mesh.updateMatrixWorld();

            // Get camera basis vectors (same as used for cameraRelativePosition)
            if (!this._deformCamRight) {
                this._deformCamRight = new THREE.Vector3();
                this._deformCamUp = new THREE.Vector3();
                this._deformCamForward = new THREE.Vector3();
                this._deformWorldDir = new THREE.Vector3();
                this._deformLocalDir = new THREE.Vector3();
                this._deformInverseQuat = new THREE.Quaternion();
            }

            cam.getWorldDirection(this._deformCamForward);
            this._deformCamRight.setFromMatrixColumn(cam.matrixWorld, 0);
            this._deformCamUp.setFromMatrixColumn(cam.matrixWorld, 1);

            // Transform impact DIRECTION from camera-relative to WORLD space
            // Same math as cameraRelativePosition:
            // X (right) -> camera right
            // Y (up) -> camera up
            // Z (toward camera) -> negative camera forward
            this._deformWorldDir.set(
                this._deformCamRight.x * ip[0] +
                    this._deformCamUp.x * ip[1] -
                    this._deformCamForward.x * ip[2],
                this._deformCamRight.y * ip[0] +
                    this._deformCamUp.y * ip[1] -
                    this._deformCamForward.y * ip[2],
                this._deformCamRight.z * ip[0] +
                    this._deformCamUp.z * ip[1] -
                    this._deformCamForward.z * ip[2]
            );

            // Transform DIRECTION from world space to mesh-local space
            // We only want to apply the ROTATION, not translation
            // Get the mesh's world quaternion and invert it
            mesh.getWorldQuaternion(this._deformInverseQuat);
            this._deformInverseQuat.invert();

            // Apply inverse rotation to the world-space direction
            this._deformLocalDir.copy(this._deformWorldDir);
            this._deformLocalDir.applyQuaternion(this._deformInverseQuat);

            this._deformation = {
                ...d,
                impactPoint: [
                    this._deformLocalDir.x,
                    this._deformLocalDir.y,
                    this._deformLocalDir.z,
                ],
            };
        } else if (blended.deformation && blended.deformation.enabled) {
            // Fallback if no camera/mesh available - use raw values
            this._deformation = { ...blended.deformation };
        } else {
            this._deformation = blended.deformation || null;
        }


        // Update element spawner (ice crystals, rocks, etc.)
        if (this.elementSpawner) {
            // Pass gesture progress for element animations (fire temperature, water flow, etc.)
            // Use first available progress from any active elemental effect
            const gestureProgress =
                this._currentFireProgress ??
                this._currentWaterProgress ??
                this._currentIceProgress ??
                this._currentElectricProgress ??
                this._currentVoidProgress ??
                this._currentLightProgress ??
                this._currentEarthProgress ??
                this._currentNatureProgress ??
                null;
            this.elementSpawner.update(deltaTime / 1000, gestureProgress); // Convert ms to seconds
        }

        // Apply blink effects (AFTER gestures, blending with other animations)
        if (blinkState.isBlinking) {
            // Apply blink rotation (additive to gesture rotation)
            if (blinkState.rotation) {
                this.rotation[0] += blinkState.rotation[0];
                this.rotation[1] += blinkState.rotation[1];
                this.rotation[2] += blinkState.rotation[2];
            }
        }

        // Calculate final scale: gesture * morph * breathing * BLINK * crystal shell scale
        // Crystal/diamond don't squish on blink - they use energy pulse instead
        // Use Y-axis blink scale (primary squish axis) for uniform application
        const shouldApplyBlinkScale = !this.geometryConfig?.crystalFamily;
        const blinkScale =
            blinkState.isBlinking && shouldApplyBlinkScale ? blinkState.scale[1] : 1.0;
        const crystalShellScale = this.crystalShellBaseScale || 2.0; // Default shell size
        const scaleMultipliers = morphScale * breathScale * blinkScale * crystalShellScale;
        const finalScale = this.scale * scaleMultipliers;

        // Calculate final non-uniform scale (for squash/stretch effects)
        // Applies same multipliers to each axis of the non-uniform scale
        const finalNonUniformScale = this.nonUniformScale
            ? [
                  this.nonUniformScale[0] * scaleMultipliers,
                  this.nonUniformScale[1] * scaleMultipliers,
                  this.nonUniformScale[2] * scaleMultipliers,
              ]
            : null;

        // ═══════════════════════════════════════════════════════════════════════════
        // PARTICLE SYSTEM UPDATE & RENDERING (Orchestrated)
        // ═══════════════════════════════════════════════════════════════════════════
        // Only check particleVisibility (runtime toggle), not particlesEnabled (initial config)
        if (this.particleVisibility && this.particleOrchestrator) {
            // Calculate actual 3D core radius in world units
            // This ensures particles orbit at consistent distance regardless of screen size
            // Crystal shell scale is the main factor (default 2.0)
            // particleRadiusMultiplier adjusts for different geometry shapes/sizes
            const particleRadiusMultiplier = this.geometryConfig?.particleRadiusMultiplier || 1.0;
            const coreRadius3D =
                (this.crystalShellBaseScale || 2.0) *
                this.scale *
                breathScale *
                particleRadiusMultiplier;

            // Delegate all particle logic to orchestrator
            this.particleOrchestrator.update(
                deltaTime,
                this.emotion,
                this.undertone,
                this.animationManager.getActiveAnimations(), // Active gestures
                this.animationManager.getTime(), // Current animation time
                { x: this.position[0], y: this.position[1], z: this.position[2] }, // Core position
                { width: this.canvas.width, height: this.canvas.height }, // Canvas size
                // Rotation state for orbital physics
                {
                    euler: this.baseEuler,
                    quaternion: this.baseQuaternion,
                    angularVelocity: this.behaviorController.getAngularVelocity(),
                },
                this.baseScale, // Pass base scale only (shader handles perspective)
                coreRadius3D // Pass actual 3D core radius for particle orbit distance
            );
        }

        // Calculate effective glow intensity (blink boost applied at render time, non-mutating)
        // Use multiplicative blending (1.0 + boost) so fade can still reach 0
        const blinkBoostMultiplier =
            blinkState.isBlinking && blinkState.glowBoost ? 1.0 + blinkState.glowBoost : 1.0;

        // Respect coreGlowEnabled toggle for both glass and glow modes
        // When disabled, set intensity to 0 which hides inner core and emissive glow
        // Also multiply by virtual particle opacity for fade/ghost effects
        const baseIntensity = this.coreGlowEnabled
            ? this.glowIntensity * blinkBoostMultiplier
            : 0.0;

        const virtualParticle = this.emotiveEngine?.getVirtualParticle();
        const opacity = virtualParticle?.opacity ?? 1.0;
        const effectiveGlowIntensity = baseIntensity * opacity;


        // Update element material bloom thresholds to match mascot's bloom settings
        // This prevents water/fire etc from blowing out on low-threshold geometries (crystal/heart)
        if (this.elementSpawner) {
            const elementBloomThreshold = this.geometryConfig?.crystalFamily ? 0.35 : 0.85;
            this.elementSpawner.setElementBloomThreshold('electricity', elementBloomThreshold);
        }




        // Moon: glowIntensity affects subtle emotion-colored glow (very subtle effect, * 0.02 in shader)
        // Unlike crystals, moon doesn't have a "core" that glows - it's a textured lit sphere
        if (
            (this.customMaterialType === 'moon' ||
                this.customMaterialType === 'moon-multiplexer') &&
            this.customMaterial
        ) {
            if (this.customMaterial.uniforms && this.customMaterial.uniforms.glowIntensity) {
                this.customMaterial.uniforms.glowIntensity.value = effectiveGlowIntensity;
            }
        }

        // Update crystal material if using crystal blend-layers geometry
        if (this.customMaterialType === 'crystal' && this.customMaterial) {
            // Only update uniforms if material is a ShaderMaterial with uniforms
            if (this.customMaterial.uniforms) {
                // Update time for animation (convert ms to seconds for sane speed values)
                this.customMaterial.uniforms.time.value += deltaTime / 1000;

                // Host-driven glow ramp (setGlow)
                const gr = this._glowRamp;
                if (gr && this.customMaterial.uniforms.uGlow) {
                    gr.t = Math.min(1, gr.t + deltaTime / gr.ms);
                    const e = gr.t * gr.t * (3 - 2 * gr.t);
                    this.customMaterial.uniforms.uGlow.value = gr.from + (gr.to - gr.from) * e;
                    if (gr.t >= 1) this._glowRamp = null;
                }

                // Update glow intensity - respects coreGlowEnabled toggle
                if (this.customMaterial.uniforms.glowIntensity) {
                    this.customMaterial.uniforms.glowIntensity.value = effectiveGlowIntensity;
                }

                // Smooth color transition between emotions
                // Lerp from start color to target over ~500ms (configurable via colorTransitionDuration)
                if (this._targetGlowColor && this._colorTransitionProgress < 1) {
                    const transitionDuration = this.colorTransitionDuration || 500; // ms
                    this._colorTransitionProgress += deltaTime / transitionDuration;
                    this._colorTransitionProgress = Math.min(this._colorTransitionProgress, 1);

                    // Ease-out curve for smooth deceleration
                    const tColor = 1 - Math.pow(1 - this._colorTransitionProgress, 2);

                    // Lerp each channel
                    const start = this._colorTransitionStart ||
                        this._normalizedGlowColor || [1, 1, 1];
                    const target = this._targetGlowColor;
                    this._normalizedGlowColor = [
                        start[0] + (target[0] - start[0]) * tColor,
                        start[1] + (target[1] - start[1]) * tColor,
                        start[2] + (target[2] - start[2]) * tColor,
                    ];
                }

                // Smooth SSS preset transition
                // Lerp SSS uniforms from current to target over configurable duration
                if (this._targetSSSValues && this._sssTransitionProgress < 1) {
                    const sssTransitionDuration =
                        this._sssTransitionDurationMs || this.sssTransitionDuration || 500; // ms
                    this._sssTransitionProgress += deltaTime / sssTransitionDuration;
                    this._sssTransitionProgress = Math.min(this._sssTransitionProgress, 1);

                    // Ease-out curve for smooth deceleration
                    const sssT = 1 - Math.pow(1 - this._sssTransitionProgress, 2);

                    const u = this.customMaterial.uniforms;
                    const start = this._sssTransitionStart;
                    const target = this._targetSSSValues;

                    // Lerp scalar values
                    if (u.sssStrength && start.sssStrength !== undefined) {
                        u.sssStrength.value =
                            start.sssStrength + (target.sssStrength - start.sssStrength) * sssT;
                    }
                    if (u.sssThicknessBias && start.sssThicknessBias !== undefined) {
                        u.sssThicknessBias.value =
                            start.sssThicknessBias +
                            (target.sssThicknessBias - start.sssThicknessBias) * sssT;
                    }
                    if (u.sssThicknessScale && start.sssThicknessScale !== undefined) {
                        u.sssThicknessScale.value =
                            start.sssThicknessScale +
                            (target.sssThicknessScale - start.sssThicknessScale) * sssT;
                    }
                    if (u.sssCurvatureScale && start.sssCurvatureScale !== undefined) {
                        u.sssCurvatureScale.value =
                            start.sssCurvatureScale +
                            (target.sssCurvatureScale - start.sssCurvatureScale) * sssT;
                    }
                    if (u.sssAmbient && start.sssAmbient !== undefined) {
                        u.sssAmbient.value =
                            start.sssAmbient + (target.sssAmbient - start.sssAmbient) * sssT;
                    }
                    if (u.frostiness && start.frostiness !== undefined) {
                        u.frostiness.value =
                            start.frostiness + (target.frostiness - start.frostiness) * sssT;
                    }
                    if (u.innerGlowStrength && start.innerGlowStrength !== undefined) {
                        u.innerGlowStrength.value =
                            start.innerGlowStrength +
                            (target.innerGlowStrength - start.innerGlowStrength) * sssT;
                    }
                    if (u.fresnelIntensity && start.fresnelIntensity !== undefined) {
                        u.fresnelIntensity.value =
                            start.fresnelIntensity +
                            (target.fresnelIntensity - start.fresnelIntensity) * sssT;
                    }
                    if (u.causticIntensity && start.causticIntensity !== undefined) {
                        u.causticIntensity.value =
                            start.causticIntensity +
                            (target.causticIntensity - start.causticIntensity) * sssT;
                    }
                    if (u.emotionColorBleed && start.emotionColorBleed !== undefined) {
                        u.emotionColorBleed.value =
                            start.emotionColorBleed +
                            (target.emotionColorBleed - start.emotionColorBleed) * sssT;
                    }

                    // Lerp vector values (absorption, scatter distance)
                    if (u.sssAbsorption && start.sssAbsorption) {
                        u.sssAbsorption.value.set(
                            start.sssAbsorption[0] +
                                (target.sssAbsorption[0] - start.sssAbsorption[0]) * sssT,
                            start.sssAbsorption[1] +
                                (target.sssAbsorption[1] - start.sssAbsorption[1]) * sssT,
                            start.sssAbsorption[2] +
                                (target.sssAbsorption[2] - start.sssAbsorption[2]) * sssT
                        );
                    }
                    if (u.sssScatterDistance && start.sssScatterDistance) {
                        u.sssScatterDistance.value.set(
                            start.sssScatterDistance[0] +
                                (target.sssScatterDistance[0] - start.sssScatterDistance[0]) * sssT,
                            start.sssScatterDistance[1] +
                                (target.sssScatterDistance[1] - start.sssScatterDistance[1]) * sssT,
                            start.sssScatterDistance[2] +
                                (target.sssScatterDistance[2] - start.sssScatterDistance[2]) * sssT
                        );
                    }
                }

                // Use current (lerped) normalized color
                // This ensures yellow (joy) doesn't wash out the soul while blue (sadness) stays visible
                const normalizedColor = this._normalizedGlowColor || [1, 1, 1];

                // Update emotion color on outer shell (luminance-normalized)
                this.customMaterial.uniforms.emotionColor.value.setRGB(
                    normalizedColor[0],
                    normalizedColor[1],
                    normalizedColor[2]
                );
                // Update blink intensity for energy pulse (smooth sine curve during blink)
                if (this.customMaterial.uniforms.blinkIntensity) {
                    const blinkPulse = blinkState.isBlinking
                        ? Math.sin(blinkState.progress * Math.PI)
                        : 0;
                    this.customMaterial.uniforms.blinkIntensity.value = blinkPulse;
                }
            }
            // Update inner core color and animation (also use cached normalized color)
            // Only update if core glow is enabled AND shatter system isn't managing the soul
            // During shatter/frozen/reassembly, ShatterSystem controls the soul's scale and uniforms
            if (this.coreGlowEnabled) {
                const normalizedCoreColor = this._normalizedGlowColor || [1, 1, 1];
                this.updateCrystalInnerCore(normalizedCoreColor, deltaTime);
            }
        }

        // Render with Three.js — update pre-allocated options object (avoids per-frame allocation)
        const opts = this._renderOptions;
        opts.position = this.position;
        opts.rotation = this.rotation;
        opts.scale = finalScale;
        opts.nonUniformScale = finalNonUniformScale; // [x, y, z] for squash/stretch, null for uniform
        opts.glowColor = this.glowColor;
        opts.glowColorHex = this.glowColorHex; // For bloom luminance normalization
        opts.glowIntensity = effectiveGlowIntensity;
        opts.hasActiveGesture = this.animationManager.hasActiveAnimations(); // Faster lerp during gestures
        opts.calibrationRotation = this.calibrationRotation; // Applied on top of animated rotation
        opts.cameraRoll = this._cameraRoll || 0; // Camera-relative roll for tidal-locked lean gestures
        opts.morphProgress = morphState.isTransitioning ? morphState.visualProgress : null; // For corona fade-in
        // OPTIMIZATION FLAGS: Skip render passes when not needed
        opts.hasSoul = this.customMaterialType === 'crystal' && this.crystalSoul !== null;
        // PERFORMANCE: Only run particle bloom if there are actual visible particles
        // This skips 13+ render passes when particles are enabled but idle
        opts.hasParticles =
            this.particleVisibility &&
            this.particleOrchestrator !== null &&
            this.particleOrchestrator.getParticleCount() > 0;
        // Shader-based localized vertex deformation for impacts
        opts.deformation = this._deformation;
        this.renderer.render(opts);


    }

    /**
     * Load async geometry (e.g., OBJ models) and set up mesh when ready
     * Uses GeometryCache for caching to prevent race conditions and duplicate loads
     *
     * IMPORTANT: This is fully async and completes BEFORE render() should be called.
     * Use isReady() or await waitUntilReady() before starting render loop.
     * @private
     * @returns {Promise<void>}
     */
    async _loadAsyncGeometry() {
        try {
            // Use GeometryCache for proper caching - this ensures:
            // 1. Multiple calls during React Strict Mode don't cause duplicate loads
            // 2. Preloaded geometry is reused instantly
            // 3. Race conditions are avoided
            const cached = await GeometryCache.preload(this.geometryType, {
                glowColor: this.glowColor || [1.0, 1.0, 0.95],
                glowIntensity: this.glowIntensity || 1.0,
                materialVariant: this.materialVariant,
                emotionData: getEmotion(this.emotion),
                assetBasePath: this.assetBasePath,
            });

            // CRITICAL: Check if destroyed during async load (React Strict Mode can unmount during load)
            if (this._destroyed) {
                return;
            }

            if (!cached || !cached.geometry) {
                console.warn(`[Core3DManager] Async geometry load returned null (instance ${this._instanceId})`);
                this._ready = true;
                return;
            }

            // Clone the cached geometry so each instance has its own copy
            const loadedGeometry = cached.geometry.clone();

            // Store geometry type
            loadedGeometry.userData.geometryType = this.geometryType;
            this.geometry = loadedGeometry;

            if (this._deferredMeshCreation) {
                // First time: create mesh with loaded geometry (no fallback was shown)
                this.coreMesh = this.renderer.createCoreMesh(loadedGeometry, this.customMaterial);

                // Check again - createCoreMesh could take time
                if (this._destroyed) {
                    return;
                }

                // Create inner core for crystal - do this SYNCHRONOUSLY before marking ready
                // CrystalSoul will load its inclusion geometry asynchronously, but we wait for it
                if (this.customMaterialType === 'crystal') {
                    await this._createCrystalInnerCoreAsync();
                    // Check AGAIN after async operation
                    if (this._destroyed) {
                        return;
                    }
                }

                this._deferredMeshCreation = false;
            } else if (this.coreMesh) {
                // Existing mesh: swap geometry
                const oldGeometry = this.coreMesh.geometry;
                this.coreMesh.geometry = loadedGeometry;

                // Dispose old procedural geometry
                if (oldGeometry && oldGeometry !== loadedGeometry) {
                    oldGeometry.dispose();
                }

                // Check again
                if (this._destroyed) {
                    return;
                }

                // Recreate inner core if crystal
                if (this.customMaterialType === 'crystal') {
                    await this._createCrystalInnerCoreAsync();
                    // Check AGAIN after async operation
                    if (this._destroyed) {
                        return;
                    }
                }
            }

            // Final check before marking ready - don't set ready on destroyed instance
            if (this._destroyed) {
                return;
            }

            // Initialize ElementSpawner now that coreMesh exists
            // NOTE: Models are NOT preloaded here - they load lazily on first spawn
            // This prevents GPU overhead for demos that don't use elemental gestures
            if (this.elementSpawner && this.renderer?.coreMesh && !this.elementSpawner.coreMesh) {
                this.elementSpawner.initialize(this.renderer.coreMesh, this.renderer.camera);
            }

            // NOW we're fully ready for rendering
            this._ready = true;

            // Link the core programs off the main thread, then the electric pool (after, so
            // the gem appears first and the two links do not compete).
            this._prelinkCore();
        } catch (error) {
            console.warn(`[Core3DManager] Async geometry load failed (instance ${this._instanceId}):`, error);
            // Mark ready even on failure so render doesn't hang (unless destroyed)
            if (!this._destroyed) {
                this._ready = true;
            }
        }
    }

    /**
     * Create crystal inner core and wait for its async geometry to load
     * @private
     * @returns {Promise<void>}
     */
    async _createCrystalInnerCoreAsync() {
        // Dispose existing soul if present
        if (this.crystalSoul) {
            this.crystalSoul.dispose();
            this.crystalSoul = null;
        }

        // Invalidate renderer's cached soul reference so it re-traverses on next render
        if (this.renderer) this.renderer.invalidateSoulCache();

        if (!this.coreMesh) {
            return;
        }

        // Preload the inclusion geometry BEFORE creating CrystalSoul
        // This ensures the soul mesh has its final geometry before being added to scene
        await CrystalSoul._loadInclusionGeometry(this.assetBasePath);

        // Check if destroyed during async load
        if (this._destroyed || !this.coreMesh) {
            return;
        }

        // Create new soul - geometry is already cached so it will be used immediately
        this.crystalSoul = new CrystalSoul({
            radius: 0.35,
            detail: 1,
            geometryType: this.geometryType,
            renderer: this.renderer,
            assetBasePath: this.assetBasePath,
        });

        // Attach to coreMesh - this adds soul to the scene
        this.crystalSoul.attachTo(this.coreMesh, this.renderer?.scene);

        // Shell and soul sizes come from the entry.
        this.crystalShellBaseScale = this.geometryConfig?.shellScale ?? 2.0;
        const soulScale = this.geometryConfig?.soulScale ?? 1.0;

        this.crystalSoul.baseScale = soulScale;
        this.crystalSoul.mesh.scale.setScalar(soulScale);

        // Respect coreGlowEnabled toggle state
        this.crystalSoul.setVisible(this.coreGlowEnabled);

        // Legacy references for backwards compatibility
        this.crystalInnerCore = this.crystalSoul.mesh;
        this.crystalInnerCoreMaterial = this.crystalSoul.material;
        this.crystalInnerCoreBaseScale = this.crystalSoul.baseScale;
    }

    /**
     * Handle WebGL context restoration by recreating custom materials and textures
     * Called by ThreeRenderer when the browser restores the WebGL context
     * @private
     */
    async _handleContextRestored() {
        if (this._destroyed || !this.coreMesh) {
            return;
        }

        // Recreate custom material with textures (crystal, moon, sun)
        if (this.customMaterialType) {
            const emotionData = getEmotion(this.emotion);
            const materialResult = createCustomMaterial(this.geometryType, this.geometryConfig, {
                glowColor: this.glowColor || [1.0, 1.0, 0.95],
                glowIntensity: this.glowIntensity || 1.0,
                materialVariant: this.materialVariant,
                emotionData,
                assetBasePath: this.assetBasePath,
            });

            if (materialResult) {
                // Dispose old material
                if (this.customMaterial) {
                    disposeCustomMaterial(this.customMaterial);
                }

                // Apply new material
                this.customMaterial = materialResult.material;
                this.coreMesh.material = this.customMaterial;

                // Recreate crystal soul if needed
                if (this.customMaterialType === 'crystal' && this.crystalSoul) {
                    await this._createCrystalInnerCoreAsync();
                }

                // Notify external listeners (e.g., demos applying SSS presets)
                if (this.onMaterialSwap) {
                    this.onMaterialSwap();
                }
            }
        }
    }

    /**
     * @private Link the programs the first frame needs (crystal on the canvas, soul into its
     * linear target, particles) with the off-main-thread poller; draw nothing until done.
     * Then start the element pre-link (electric pool + gem overlay).
     */
    async _prelinkCore() {
        const r = this.renderer;
        const jobs = [];
        if (this.coreMesh) jobs.push(r.compileObjectAsync(this.coreMesh));
        if (this.crystalSoul?.mesh) {
            jobs.push(r.compileObjectAsync(this.crystalSoul.mesh, { target: r.soulRenderTarget }));
        }
        const points = this.particleOrchestrator?.renderer?.getPoints?.();
        if (points) jobs.push(r.compileObjectAsync(points));
        await Promise.all(jobs);
        if (this._destroyed) return;
        this._linked = true;
        this._resolveVisible();
        this._startElementPreloading();
    }

    /**
     * @private The electric gem overlay mesh (one per instance, created on first need).
     * @param {THREE.Mesh} coreMesh
     */
    _getElectricOverlay(coreMesh) {
        if (!this._electricOverlayMesh) {
            this._electricMaterial = createElectricMaterial({ charge: 0.8, opacity: 0.7 });
            this._electricOverlayMesh = new THREE.Mesh(coreMesh.geometry, this._electricMaterial);
            this._electricOverlayMesh.scale.setScalar(1.02); // avoid z-fighting
            this._electricOverlayMesh.renderOrder = coreMesh.renderOrder + 1;
        }
        return this._electricOverlayMesh;
    }

    /**
     * Resolves once the first frame can be drawn without a synchronous shader link.
     * @returns {Promise<void>}
     */
    whenVisible() {
        return this._visiblePromise;
    }

    /**
     * Check if the manager is fully initialized and ready for rendering
     * @returns {boolean}
     */
    isReady() {
        return this._ready;
    }

    /**
     * Wait until the manager is fully initialized
     * Use this before starting your render loop for geometries with async loading (crystal, rough, heart)
     * @returns {Promise<void>}
     */
    async waitUntilReady() {
        if (this._ready) return;
        if (this._readyPromise) {
            await this._readyPromise;
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // ELEMENT PRELOADING - Opt-in and background pre-warm
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Start element preloading based on configuration
     * @private
     */
    _startElementPreloading() {
        if (this._destroyed || !this.elementSpawner) return;

        // Immediate preload of specified elements
        if (this._preloadElements.length > 0) {
            this._preloadElements.forEach(type => {
                if (ALL_ELEMENT_TYPES.includes(type)) {
                    this.elementSpawner.preloadModels(type);
                }
            });
            // The electric gem overlay: one material for the instance's lifetime, linked now.
            if (this._preloadElements.includes('electricity') && this.renderer?.coreMesh) {
                const overlay = this._getElectricOverlay(this.renderer.coreMesh);
                this.renderer.compileObjectAsync(overlay);
            }
        }

    }






    /**
     * Cleanup
     */
    destroy() {
        if (this._destroyPromise) return this._destroyPromise;
        // Stop rendering now; keep every GL object alive until in-flight shader compiles
        // settle (three's compileAsync poller reads the material's program), then tear down.
        this._destroyed = true;
        // No shader link may start after close (e.g. a pool whose GLBs land later).
        this.renderer?.beginClose();
        const settled = this.renderer ? this.renderer.whenCompilesSettled() : Promise.resolve();
        this._destroyPromise = settled.then(() => this._teardown());
        return this._destroyPromise;
    }

    /** @private GL + scene teardown, run once compiles have settled. */
    async _teardown() {

        // Clean up crystal soul FIRST - before renderer.destroy() clears the scene
        // This ensures we properly remove the mesh from scene before scene is cleared
        if (this.crystalSoul) {
            this.crystalSoul.dispose();
            this.crystalSoul = null;
            this.crystalInnerCore = null;
            this.crystalInnerCoreMaterial = null;
        }

        // Clean up particle system (remove from scene before destroying)
        if (this.particleOrchestrator) {
            // Get particle points reference before destroying
            const particleRenderer = this.particleOrchestrator.renderer;
            if (particleRenderer) {
                const points = particleRenderer.getPoints();
                if (points && this.renderer?.scene) {
                    this.renderer.scene.remove(points);
                }
            }
            this.particleOrchestrator.destroy();
            this.particleOrchestrator = null;
        }




        // Clean up element spawner
        if (this.elementSpawner) {
            this.elementSpawner.dispose();
            this.elementSpawner = null;
        }


        // Clean up behavior controller
        if (this.behaviorController) {
            this.behaviorController.dispose();
            this.behaviorController = null;
        }

        // Clean up breathing phase manager
        if (this.breathingPhaseManager) {
            this.breathingPhaseManager.dispose();
            this.breathingPhaseManager = null;
        }

        if (this._electricMaterial) {
            this._electricMaterial.dispose();
            this._electricMaterial = null;
            this._electricOverlayMesh = null;
        }

        // Dispose custom material textures if they exist
        if (this.customMaterial) {
            this.renderer.disposeMaterial(this.customMaterial);
            this.customMaterial = null;
            this.customMaterialType = null;
        }

        // Dispose facing behavior
        if (this.facingBehavior) {
            this.facingBehavior.dispose();
            this.facingBehavior = null;
        }

        // Stop animations before destroying renderer
        this.animationManager.stopAll();

        // Destroy renderer LAST (after all scene children are cleaned up)
        const rendererDone = this.renderer.destroy();

        // Clean up animation manager (includes virtual particle pool)
        this.animationManager.dispose();
        this.animationManager = null;

        // Clean up animator sub-components
        this.animator.destroy?.();
        this.breathingAnimator.destroy?.();
        this.gestureBlender.destroy?.();
        this.geometryMorpher.destroy?.();
        this.blinkAnimator.destroy?.();

        // Clean up temp THREE.js objects
        this.tempEuler = null;
        this.baseQuaternion = null;
        this.gestureQuaternion = null;

        // Clean up geometry references
        this.geometry = null;
        this.geometryConfig = null;
        this._targetGeometry = null;
        this._targetGeometryConfig = null;
        this._targetGeometryType = null;

        // Clean up canvas and options references
        this.canvas = null;
        this.options = null;

        // Clean up core mesh reference
        this.coreMesh = null;



        // Clean up emotive engine reference
        this.emotiveEngine = null;

        // Dispose texture cache (before geometry cache)
        disposeTextureCache();

        // Dispose geometry cache
        GeometryCache.dispose();
        await rendererDone;
    }


    /**
     * Spawn 3D instanced elements with signature-based dedup.
     * Prevents re-spawning the same gesture configuration on every frame.
     * @param {string} elementType - Element type ('fire', 'water', 'ice', etc.)
     * @param {Object} overlay - The blended overlay object (e.g., blended.fireOverlay)
     * @param {Object} [options] - Options
     * @param {string} [options.signatureSet='_spawnedSignatures'] - Property name for the signature Set
     * @param {string} [options.signatureKey='_elementSpawnSignature'] - Property name for tracking current signature
     * @param {string} [options.exitScope] - Element type to pass to triggerExit (undefined = exit all)
     * @param {number} [options.defaultDuration=2000] - Default gesture duration if not in overlay
     * @param {Function} [options.onBeforeSpawn] - Callback before spawning (e.g., set distortion)
     * @private
     */
    _spawnElement(elementType, overlay, options = {}) {
        if (!this.elementSpawner) return;
        const { spawnMode, animation, models, count, scale, embedDepth, duration } = overlay;
        if (!spawnMode || spawnMode === 'none') return;

        const modeSignature = Array.isArray(spawnMode)
            ? `layers:${spawnMode.length}:${spawnMode.map(l => l.type).join(',')}`
            : typeof spawnMode === 'object'
              ? spawnMode.type
              : String(spawnMode);
        const effectiveDuration = duration || overlay.duration;
        const spawnSignature = `${elementType}:${modeSignature}:${effectiveDuration}:${animation?.type || 'default'}`;

        const sigSetKey = options.signatureSet || '_spawnedSignatures';
        this[sigSetKey] = this[sigSetKey] || new Set();
        if (this[sigSetKey].has(spawnSignature)) return;

        options.onBeforeSpawn?.();

        this.elementSpawner.triggerExit(options.exitScope);
        const result = this.elementSpawner.spawn(elementType, {
            intensity: overlay.strength || 0.8,
            mode: spawnMode,
            animation,
            models,
            count,
            scale,
            embedDepth,
            gestureDuration: effectiveDuration || options.defaultDuration || 2000,
        });
        if (result?.catch) {
            result.catch(err => console.error(`[Core3DManager] ${elementType} spawn error:`, err));
        }

        this[sigSetKey].add(spawnSignature);
        const sigKey = options.signatureKey || '_elementSpawnSignature';
        this[sigKey] = spawnSignature;
    }

    /**
     * Preload all geometry assets for instant morphing
     * Call this during app initialization for best UX
     * @returns {Promise<void>}
     */
    async preloadGeometries() {
        const options = {
            glowColor: this.glowColor || [1.0, 1.0, 0.95],
            glowIntensity: this.glowIntensity || 1.0,
            materialVariant: this.materialVariant,
            emotionData: getEmotion(this.emotion),
        };

        await GeometryCache.preloadAll(options);
    }
}
