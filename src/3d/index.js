/**
 * @fileoverview EmotiveMascot3D, hex-agent edition.
 *
 * Derived from the Emotive Engine 3D mascot (MIT, Joshua Tollette). This edition keeps only
 * what the hex agent uses: one WebGL canvas, the crystal + soul, emotions/undertones, the
 * curated gestures, morphTo, SSS gem presets and setSurface. No 2D canvas or 2D particle
 * overlay, no audio/rhythm/dance, no feel() phrase parser, no eclipse, no camera controls,
 * no element positioning helpers.
 *
 * @module EmotiveEngine3D
 */

import { Core3DManager } from './Core3DManager.js';
import { assertAssetBasePath } from './utils/assetBasePath.js';
import { EventManager } from '../core/events/EventManager.js';
import { listEmotions, hasEmotion } from '../core/emotions/index.js';
import { getGesture, listGestures } from '../core/gestures/index.js';
import { applySSSPreset as applySSS, SSSPresets, BASE_GEM, GEM_SHIFT_MIN_MS } from './presets/SSSPresets.js';
import { ResizeObserverManager } from './managers/ResizeObserverManager.js';
import { setSurface } from './materials/surface.js';
import { FRAME_TIMING, ACCESSIBILITY } from '../core/config/defaults.js';
import { THREE_GEOMETRIES } from './geometries/ThreeGeometries.js';

/** Geometry names morphTo() accepts. */
const VALID_GEOMETRIES = Object.keys(THREE_GEOMETRIES);

/**
 * EmotiveMascot3D: the gem.
 *
 * @example
 * const mascot = new EmotiveMascot3D({ coreGeometry: 'hexgem', assetBasePath: '/agent/' });
 * mascot.init(container);
 * await mascot.start();
 * mascot.setEmotion('joy');
 * mascot.express('nod');
 */
export class EmotiveMascot3D {
    /**
     * @param {Object} [config={}]
     * @param {string} [config.canvasId='emotive-canvas'] - id prefix of the WebGL canvas
     * @param {string} [config.coreGeometry='hexgem'] - geometry name (see CRYSTAL_SHAPES)
     * @param {boolean} [config.enableParticles=true]
     * @param {string} [config.defaultEmotion='neutral']
     * @param {string} config.assetBasePath - base URL of the agent assets (GLBs + detail map)
     * @param {'dark'|'light'} [config.surface] - what the transparent canvas sits on
     */
    constructor(config = {}) {
        assertAssetBasePath(config.assetBasePath);
        this.config = {
            canvasId: config.canvasId || 'emotive-canvas',
            coreGeometry: config.coreGeometry || 'hexgem',
            enableParticles: config.enableParticles !== false,
            defaultEmotion: config.defaultEmotion || 'neutral',
            ...config,
        };

        this.container = null;
        this.webglCanvas = null;
        this._resizeObserver = null;
        this._canvasAppended = false;

        this.core3D = null;

        this.isRunning = false;
        this._destroyed = false;
        this.animationFrameId = null;
        this.lastFrameTime = 0;
        this.gestureTimeouts = [];

        this.eventManager = new EventManager();
        if (!this.eventManager.emit) {
            this.eventManager._listeners = {};
            this.eventManager.emit = (event, data) => {
                const listeners = this.eventManager._listeners?.[event];
                if (listeners) listeners.forEach(listener => listener(data));
            };
            this.eventManager.on = (event, listener) => {
                if (!this.eventManager._listeners[event]) this.eventManager._listeners[event] = [];
                this.eventManager._listeners[event].push(listener);
            };
            this.eventManager.off = (event, listener) => {
                const listeners = this.eventManager._listeners?.[event];
                if (!listeners) return;
                const index = listeners.indexOf(listener);
                if (index > -1) listeners.splice(index, 1);
            };
        }

        this.emotion = 'neutral';
        this.undertone = null;

        this._prefersReducedMotion = ACCESSIBILITY.prefersReducedMotion();
        this._reducedMotionMediaQuery = null;

        this._boundAnimate = time => this.animate(time);

        // Frame limiter (fix b): render at idleFPS, or activeFPS while a gesture or morph runs.
        // Animation time still advances by the whole elapsed time.
        this.idleFPS = config.idleFPS > 0 ? config.idleFPS : 30;
        this.activeFPS = config.activeFPS > 0 ? config.activeFPS : 60;
        this._frameAccum = 0;

        // Pause while the page is hidden; resume only what the visibility pause stopped.
        this._pausedByVisibility = false;
        this._onVisibilityChange = () => {
            if (this._destroyed) return;
            if (document.hidden) {
                if (this.isRunning) {
                    this.stop();
                    this._pausedByVisibility = true;
                }
            } else if (this._pausedByVisibility) {
                this._pausedByVisibility = false;
                this.start();
            }
        };
        if (typeof document !== 'undefined') {
            document.addEventListener('visibilitychange', this._onVisibilityChange);
        }
    }

    /** @private true while something moves fast enough to deserve activeFPS */
    _isActive() {
        const c = this.core3D;
        if (!c) return false;
        return Boolean(c.animationManager?.hasActiveAnimations?.() || c.isMorphing?.());
    }

    /** @returns {boolean} */
    prefersReducedMotion() {
        return this._prefersReducedMotion;
    }

    /**
     * @param {boolean} enabled
     * @returns {EmotiveMascot3D}
     */
    setReducedMotion(enabled) {
        this._prefersReducedMotion = enabled;
        if (enabled) {
            if (ACCESSIBILITY.REDUCED_MOTION_DISABLE_AUTO_ROTATE) this.disableAutoRotate();
            if (ACCESSIBILITY.REDUCED_MOTION_DISABLE_PARTICLES) this.disableParticles();
        }
        this.eventManager.emit('accessibility:reducedMotion', { enabled });
        return this;
    }

    /** @private */
    _setupReducedMotionListener() {
        if (typeof window === 'undefined' || !window.matchMedia) return;
        this._reducedMotionMediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
        this._reducedMotionHandler = event => this.setReducedMotion(event.matches);
        this._reducedMotionMediaQuery.addEventListener?.('change', this._reducedMotionHandler);
    }

    /** @private */
    _isDestroyed() {
        return this._destroyed || !this.eventManager || !this.eventManager._listeners;
    }

    /**
     * Mount into a container element: one WebGL canvas filling it.
     * @param {HTMLElement} container
     * @returns {EmotiveMascot3D}
     */
    init(container) {
        if (this.config.surface) setSurface(this.config.surface);
        if (typeof window === 'undefined') {
            throw new Error('EmotiveMascot3D.init() requires a browser environment.');
        }
        const probeGl = document.createElement('canvas').getContext('webgl2');
        if (!probeGl) {
            console.warn('[EmotiveMascot3D] WebGL2 is not supported in this browser');
            return this;
        }
        // Release the probe context now; left alone it counts against the browser's live
        // context cap until GC.
        probeGl.getExtension('WEBGL_lose_context')?.loseContext();

        this.container = container;
        if (!container.style.position || container.style.position === 'static') {
            container.style.position = 'relative';
        }
        const canvas = document.createElement('canvas');
        canvas.id = `${this.config.canvasId}-3d`;
        canvas.width = container.offsetWidth || 400;
        canvas.height = container.offsetHeight || 400;
        canvas.style.cssText =
            'position:absolute;top:0;left:0;width:100%;height:100%;background:transparent;pointer-events:none;';
        canvas.setAttribute('role', 'img');
        canvas.setAttribute('aria-label', 'Animated agent gem');
        this.webglCanvas = canvas;

        this.core3D = new Core3DManager(canvas, {
            geometry: this.config.coreGeometry,
            emotion: this.config.defaultEmotion,
            enableParticles: this.config.enableParticles,
            enableBlinking: this.config.enableBlinking,
            enableBreathing: this.config.enableBreathing,
            autoRotate: this.config.autoRotate,
            cameraDistance: this.config.cameraDistance,
            fov: this.config.fov,
            materialVariant: this.config.materialVariant,
            assetBasePath: this.config.assetBasePath,
            maxPixelRatio: this.config.maxPixelRatio,
            debugShaders: this.config.debugShaders,
            preloadElements: this.config.preloadElements,
        });

        this._wireCore();

        this._resizeObserver = new ResizeObserverManager(container, (width, height) => {
            this.core3D?.renderer?.resize(width, height);
        });

        this._setupReducedMotionListener();
        if (this._prefersReducedMotion) this.setReducedMotion(true);
        return this;
    }

    /**
     * Start the animation loop once the geometry has loaded.
     * @returns {Promise<void>}
     */
    async start() {
        if (this.isRunning || this._destroyed) return;
        if (this.core3D) await this.core3D.waitUntilReady();
        if (this._destroyed) return;
        this.isRunning = true;
        this.lastFrameTime = null;
        this.animationFrameId = requestAnimationFrame(this._boundAnimate);
    }

    /** Stop the animation loop. */
    stop() {
        this.isRunning = false;
        this._frameAccum = 0;
        this._pausedByVisibility = false;
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
    }

    /**
     * @private
     * @param {number} currentTime
     */
    animate(currentTime) {
        if (!this.isRunning || this._destroyed) return;
        if (this.lastFrameTime === null) {
            this.lastFrameTime = currentTime;
            this.animationFrameId = requestAnimationFrame(this._boundAnimate);
            return;
        }
        this._frameAccum += currentTime - this.lastFrameTime;
        this.lastFrameTime = currentTime;
        const interval = 1000 / (this._isActive() ? this.activeFPS : this.idleFPS);
        // 1 ms tolerance so a 60 Hz display is not halved by rounding at a 60 cap.
        if (this._frameAccum + 1 < interval) {
            this.animationFrameId = requestAnimationFrame(this._boundAnimate);
            return;
        }
        const deltaTime = Math.min(this._frameAccum, FRAME_TIMING.RENDER_DELTA_CAP);
        this._frameAccum = 0;

        if (this.core3D) {
            this.core3D.render(deltaTime);
            if (!this._canvasAppended && this.container && this.webglCanvas) {
                this.container.appendChild(this.webglCanvas);
                this._canvasAppended = true;
            }
        }
        this.animationFrameId = requestAnimationFrame(this._boundAnimate);
    }

    /**
     * @param {string} emotion
     * @param {string|number|Object|null} [undertoneOrOptions] - undertone, or { undertone }
     * @returns {EmotiveMascot3D}
     */
    setEmotion(emotion, undertoneOrOptions) {
        if (this._isDestroyed()) return this;
        if (!emotion || typeof emotion !== 'string') {
            console.warn(`[EmotiveMascot3D] setEmotion: Invalid emotion "${emotion}".`);
            return this;
        }
        if (!hasEmotion(emotion)) {
            console.warn(
                `[EmotiveMascot3D] Unknown emotion "${emotion}". Valid emotions: ${listEmotions().join(', ')}`
            );
        }
        this.emotion = emotion;
        if (typeof undertoneOrOptions === 'string') this.undertone = undertoneOrOptions;
        else if (undertoneOrOptions === null) this.undertone = null;
        else if (undertoneOrOptions && typeof undertoneOrOptions === 'object') {
            this.undertone = undertoneOrOptions.undertone || null;
        }

        if (this.core3D) this.core3D.setEmotion(emotion, this.undertone);
        this.eventManager.emit('emotion:change', { emotion, undertone: this.undertone });
        return this;
    }

    /**
     * @param {string|null} undertone
     * @returns {EmotiveMascot3D}
     */
    updateUndertone(undertone) {
        if (this._isDestroyed()) return this;
        this.undertone = undertone;
        if (this.core3D && this.emotion) this.core3D.setEmotion(this.emotion, undertone);
        this.eventManager.emit('undertone:change', { undertone });
        return this;
    }

    /** Alias of updateUndertone. */
    setUndertone(undertone) {
        return this.updateUndertone(undertone);
    }

    /**
     * Play a gesture by name.
     * @param {string} gestureName
     * @returns {EmotiveMascot3D}
     */
    express(gestureName) {
        if (this._isDestroyed()) return this;
        if (!gestureName || typeof gestureName !== 'string') {
            console.warn(`[EmotiveMascot3D] express: Invalid gesture "${gestureName}".`);
            return this;
        }
        const gesture = getGesture(gestureName);
        if (!gesture) {
            const names = listGestures().map(g => g.name);
            console.warn(
                `[EmotiveMascot3D] Unknown gesture "${gestureName}". Valid gestures: ${names.join(', ')}`
            );
            return this;
        }
        if (this.core3D) this.core3D.playGesture(gestureName);

        const duration = gesture.config?.duration || 800;
        this.currentGesture = { name: gestureName, startTime: performance.now(), duration };
        const timeoutId = setTimeout(() => {
            this.gestureTimeouts = this.gestureTimeouts.filter(id => id !== timeoutId);
            if (this.currentGesture?.name === gestureName) this.currentGesture = null;
        }, duration);
        this.gestureTimeouts.push(timeoutId);

        this.eventManager.emit('gesture:trigger', { gesture: gestureName });
        return this;
    }

    /** Alias of express. */
    gesture(gestureName) {
        return this.express(gestureName);
    }

    /**
     * Morph to another geometry (shrink, swap, grow).
     * @param {string} shapeName
     * @param {Object} [options]
     * @param {number} [options.duration=800]
     * @param {Function} [options.onMaterialSwap] - one-shot callback at the swap
     * @returns {EmotiveMascot3D}
     */
    morphTo(shapeName, options = {}) {
        if (this._isDestroyed()) return this;
        if (!shapeName || typeof shapeName !== 'string') {
            console.warn(`[EmotiveMascot3D] morphTo: Invalid shape "${shapeName}".`);
            return this;
        }
        if (!VALID_GEOMETRIES.includes(shapeName)) {
            console.warn(
                `[EmotiveMascot3D] Unknown geometry "${shapeName}". Valid geometries: ${VALID_GEOMETRIES.join(', ')}`
            );
        }
        if (this.core3D) {
            if (options.materialVariant !== undefined) {
                this.core3D.setMaterialVariant(options.materialVariant);
            }
            if (options.onMaterialSwap) {
                const existing = this.core3D.onMaterialSwap;
                this.core3D.onMaterialSwap = info => {
                    if (existing) existing(info);
                    options.onMaterialSwap(info);
                    this.core3D.onMaterialSwap = existing;
                };
            }
            this.core3D.morphToShape(shapeName, options.duration || 800);
        }
        this.eventManager.emit('shape:morph', { shape: shapeName });
        return this;
    }

    /** @returns {boolean} */
    isMorphing() {
        return this.core3D ? this.core3D.isMorphing() : false;
    }

    /** @returns {Object|null} */
    getMorphState() {
        return this.core3D ? this.core3D.getMorphState() : null;
    }

    /**
     * Grow in from scale 0.
     * @param {number} [duration=500]
     */
    growIn(duration = 500) {
        if (this.core3D) this.core3D.growIn(duration);
        this.eventManager.emit('animation:growIn', { duration });
    }

    /**
     * What the transparent canvas sits on. 'light' draws electric arcs as ink.
     * @param {'dark'|'light'} mode
     */
    setSurface(mode) {
        setSurface(mode);
    }

    /** @param {boolean} enabled - show or hide the inner soul */
    setCoreGlowEnabled(enabled) {
        if (this.core3D) this.core3D.setCoreGlowEnabled(enabled);
        this.eventManager.emit('coreGlow:toggle', { enabled });
    }

    /** @returns {boolean} */
    isCoreGlowEnabled() {
        return this.core3D ? this.core3D.coreGlowEnabled : true;
    }

    /** Restore emotion-driven rotation. */
    enableAutoRotate() {
        if (!this.core3D) return;
        this.core3D.rotationDisabled = false;
        if (this.core3D.behaviorController) this.core3D.behaviorController.rotationDisabled = false;
        this.setEmotion(this.core3D.emotion, this.undertone);
    }

    /** Stop emotion-driven rotation. */
    disableAutoRotate() {
        if (!this.core3D) return;
        this.core3D.rotationDisabled = true;
        if (this.core3D.behaviorController) {
            this.core3D.behaviorController.rotationDisabled = true;
            this.core3D.behaviorController.rotationBehavior = null;
        }
    }

    /** @type {boolean} */
    get autoRotateEnabled() {
        return this.core3D?.rotationDisabled === false;
    }

    enableParticles() {
        const orch = this.core3D?.particleOrchestrator;
        if (orch?.renderer) {
            this.core3D.particleVisibility = true;
            orch.renderer.setVisible(true);
            orch.setEmotion(this.core3D.emotion, this.core3D.undertone);
        }
    }

    disableParticles() {
        const orch = this.core3D?.particleOrchestrator;
        if (orch?.renderer) {
            this.core3D.particleVisibility = false;
            orch.renderer.setVisible(false);
            orch.clear();
        }
    }

    /** @type {boolean} */
    get particlesEnabled() {
        return this.core3D?.particleVisibility === true;
    }

    enableBlinking() {
        if (!this.core3D) return;
        this.core3D.blinkingManuallyDisabled = false;
        this.core3D.blinkAnimator?.resume();
    }

    disableBlinking() {
        if (!this.core3D) return;
        this.core3D.blinkingManuallyDisabled = true;
        this.core3D.blinkAnimator?.pause();
    }

    /** @type {boolean} */
    get blinkingEnabled() {
        return this.core3D?.blinkAnimator ? this.core3D.blinkAnimator.enabled : false;
    }

    enableBreathing() {
        if (this.core3D) this.core3D.breathingEnabled = true;
    }

    disableBreathing() {
        if (this.core3D) this.core3D.breathingEnabled = false;
    }

    /** @type {boolean} */
    get breathingEnabled() {
        return this.core3D ? this.core3D.breathingEnabled !== false : true;
    }

    /** @returns {string[]} */
    getAvailableEmotions() {
        return listEmotions();
    }

    /** @returns {Array<{name: string, type: string, category: string}>} */
    getAvailableGestures() {
        return listGestures();
    }

    /** @returns {string[]} */
    getAvailableGeometries() {
        return [...VALID_GEOMETRIES];
    }

    /**
     * @private Hook the core: the base gem is the current preset from mount on, and every
     * material swap (morph) re-applies the current preset synchronously.
     */
    _wireCore() {
        const core = this.core3D;
        if (!core) return;
        this._currentSSSPreset = BASE_GEM;
        core._targetSSSValues = { ...SSSPresets[BASE_GEM] };
        core._sssTransitionProgress = 1;
        core.onMaterialSwap = () => {
            if (this._currentSSSPreset) applySSS(this, this._currentSSSPreset);
        };
    }

    /**
     * Shift the gem colour to a preset over `ms` (never faster than GEM_SHIFT_MIN_MS, a flash
     * safety rule), or back to the base gem with `preset = null`.
     * @param {string|null} preset - SSSPresets name, or null for the base gem
     * @param {number} [ms=GEM_SHIFT_MIN_MS]
     * @returns {boolean} false for an unknown preset (nothing changes)
     */
    setGemColor(preset, ms = GEM_SHIFT_MIN_MS) {
        const name = preset ?? BASE_GEM;
        if (!SSSPresets[name] || !this.core3D) return false;
        const durationMs = Math.max(GEM_SHIFT_MIN_MS, Number(ms) || 0);
        this.core3D._sssTransitionDurationMs = durationMs;
        return this.setSSSPreset(name, { durationMs });
    }

    /** @returns {string} the current (or target) gem preset */
    getGemColor() {
        return this._currentSSSPreset ?? BASE_GEM;
    }

    /**
     * Apply a gem (SSS) preset to the crystal material.
     * @param {string} presetName - quartz, emerald, ruby, sapphire, amethyst, topaz, citrine, diamond
     * @param {Object} [options]
     * @param {boolean} [options.immediate=false] - skip the transition
     * @returns {boolean} true if applied
     */
    setSSSPreset(presetName, options = {}) {
        const preset = SSSPresets[presetName];
        if (!preset) return false;
        // Re-applied synchronously at every material swap (fix d), see _wireCore().
        if (this.core3D && !this.core3D.onMaterialSwap) this._wireCore();
        this._currentSSSPreset = presetName;
        if (!this.core3D?.customMaterial?.uniforms) return false;
        const u = this.core3D.customMaterial.uniforms;

        if (options.immediate || !this.core3D._targetSSSValues) {
            this.core3D._sssTransitionDurationMs = null;
            const success = applySSS(this, presetName);
            if (success) {
                this.core3D._targetSSSValues = { ...preset };
                this.core3D._sssTransitionProgress = 1;
                this.eventManager.emit('sss:presetChanged', { preset: presetName });
            }
            return success;
        }

        const v3 = (uni, fallback) => (uni?.value ? [uni.value.x, uni.value.y, uni.value.z] : [...fallback]);
        this.core3D._sssTransitionStart = {
            sssStrength: u.sssStrength?.value ?? preset.sssStrength,
            sssAbsorption: v3(u.sssAbsorption, preset.sssAbsorption),
            sssScatterDistance: v3(u.sssScatterDistance, preset.sssScatterDistance),
            sssThicknessBias: u.sssThicknessBias?.value ?? preset.sssThicknessBias,
            sssThicknessScale: u.sssThicknessScale?.value ?? preset.sssThicknessScale,
            sssCurvatureScale: u.sssCurvatureScale?.value ?? preset.sssCurvatureScale,
            sssAmbient: u.sssAmbient?.value ?? preset.sssAmbient,
            frostiness: u.frostiness?.value ?? preset.frostiness,
            innerGlowStrength: u.innerGlowStrength?.value ?? preset.innerGlowStrength,
            fresnelIntensity: u.fresnelIntensity?.value ?? preset.fresnelIntensity,
            causticIntensity: u.causticIntensity?.value ?? preset.causticIntensity,
            emotionColorBleed: u.emotionColorBleed?.value ?? preset.emotionColorBleed,
        };
        this.core3D._targetSSSValues = {
            ...preset,
            sssAbsorption: [...preset.sssAbsorption],
            sssScatterDistance: [...preset.sssScatterDistance],
        };
        this.core3D._sssTransitionProgress = 0;
        if (options.durationMs === undefined) this.core3D._sssTransitionDurationMs = null;
        const durationMs = this.core3D._sssTransitionDurationMs || this.core3D.sssTransitionDuration || 500;
        this.eventManager.emit('sss:presetChanged', { preset: presetName, transitioning: true, durationMs });
        return true;
    }

    /**
     * @param {number} durationMs - emotion colour transition
     * @returns {EmotiveMascot3D}
     */
    setColorTransitionDuration(durationMs) {
        if (this.core3D) this.core3D.colorTransitionDuration = durationMs;
        return this;
    }

    /**
     * @param {number} durationMs - SSS preset transition
     * @returns {EmotiveMascot3D}
     */
    setSSSTransitionDuration(durationMs) {
        if (this.core3D) this.core3D.sssTransitionDuration = durationMs;
        return this;
    }

    /**
     * Tear down. Rendering stops and the canvas leaves the page at once; GL resources and
     * the WebGL context are released once in-flight shader compiles settle.
     * @returns {Promise<void>} resolves when the context has been released
     */
    destroy() {
        if (this._destroyPromise) return this._destroyPromise;
        this._destroyed = true;
        this.stop();

        if (typeof document !== 'undefined') {
            document.removeEventListener('visibilitychange', this._onVisibilityChange);
        }
        if (this._reducedMotionMediaQuery && this._reducedMotionHandler) {
            this._reducedMotionMediaQuery.removeEventListener?.('change', this._reducedMotionHandler);
            this._reducedMotionMediaQuery = null;
            this._reducedMotionHandler = null;
        }

        this.gestureTimeouts.forEach(id => clearTimeout(id));
        this.gestureTimeouts = [];

        if (this.eventManager?._listeners) {
            Object.keys(this.eventManager._listeners).forEach(key => {
                this.eventManager._listeners[key] = [];
            });
            this.eventManager._listeners = null;
        }

        if (this._resizeObserver) {
            this._resizeObserver.destroy();
            this._resizeObserver = null;
        }

        this._destroyPromise = this.core3D ? this.core3D.destroy() : Promise.resolve();

        if (this.webglCanvas?.parentNode) this.webglCanvas.parentNode.removeChild(this.webglCanvas);
        this.container = null;
        this.webglCanvas = null;
        this.config = null;
        this.currentGesture = null;
        return this._destroyPromise;
    }
}

export default EmotiveMascot3D;
