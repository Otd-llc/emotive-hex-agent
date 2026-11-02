/**
 * ThreeRenderer, hex-agent edition.
 *
 * Derived from the Emotive Engine ThreeRenderer (MIT, Joshua Tollette). ONE render path, no
 * post-processing: the soul (layer 2) is drawn into its own render target sized to the
 * drawing buffer, the camera goes back to layer 0, then the scene (layer 0) and the particles
 * (layer 1) are drawn straight to the canvas. The crystal and electric shaders apply three's
 * tone mapping and sRGB output themselves, so nothing depends on a composer.
 *
 * Deleted from the engine version: EffectComposer, bloom, AO, motion blur, distortion pass,
 * glow halo layer, crack layer, particle bloom, ice refraction, HDRI/env map/glass material,
 * OrbitControls and camera presets.
 */

import * as THREE from 'three';
import { PARTICLE_STAGE_EXP } from './particles/Particle3DRenderer.js';

// Link-completion poll interval (three's compileAsync uses the same).
const LINK_POLL_MS = 10;
// Safety cap for whenCompilesSettled(); pollers stop at beginClose(), so it is never reached.
const COMPILE_TIMEOUT_MS = 20000;

/** Default camera distance: the crystal fills ~half the stage height. */
export const DEFAULT_CAMERA_DISTANCE = 1.3;
/** In-scene mode: the fixed square (drawing-buffer px) the 2D particle sim spawns in. */
export const FOLLOW_SPAWN_STAGE = 400;

export class ThreeRenderer {
    /**
     * @param {HTMLCanvasElement} canvas
     * @param {Object} [options]
     * @param {number} [options.maxPixelRatio=2]
     * @param {boolean} [options.debugShaders=false] - check shader compile errors (sync, slow)
     * @param {number} [options.cameraDistance=1.3]
     * @param {number} [options.fov=45]
     */
    constructor(canvas, options = {}) {
        this.canvas = canvas;
        this.options = options;
        this._destroyed = false;
        // Link pollers still running (fix a); beginClose() stops them, teardown never waits.
        this._pendingCompiles = new Set();
        this._pollers = new Set();

        this.scene = new THREE.Scene();
        this.scene.background = null;

        this.renderer = new THREE.WebGLRenderer({
            canvas,
            alpha: true,
            premultipliedAlpha: true,
            antialias: false,
            powerPreference: 'high-performance',
            preserveDrawingBuffer: false,
            precision: 'highp',
            stencil: false,
        });
        this.renderer.debug.checkShaderErrors = options.debugShaders === true;
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.0;
        this.renderer.setClearColor(0x000000, 0);
        this.renderer.clear();
        this.renderer.autoClear = false;

        const maxPixelRatio = options.maxPixelRatio > 0 ? options.maxPixelRatio : 2.0;
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxPixelRatio));
        this.renderer.setSize(canvas.width, canvas.height, false);

        this._contextLost = false;
        this._boundHandleContextLost = this.handleContextLost.bind(this);
        this._boundHandleContextRestored = this.handleContextRestored.bind(this);
        this.renderer.domElement.addEventListener('webglcontextlost', this._boundHandleContextLost, false);
        this.renderer.domElement.addEventListener(
            'webglcontextrestored',
            this._boundHandleContextRestored,
            false
        );

        const fov = options.fov !== undefined ? options.fov : 45;
        this.camera = new THREE.PerspectiveCamera(fov, canvas.width / canvas.height, 0.1, 100);
        // 1.3: the gem fills about half the stage height (the host sizes the canvas).
        this.cameraDistance = options.cameraDistance !== undefined ? options.cameraDistance : DEFAULT_CAMERA_DISTANCE;
        this.camera.position.set(0, 0, this.cameraDistance);
        this.camera.lookAt(0, 0, 0);

        this.setupLights();

        // Soul render target: full drawing buffer so screen-space refraction UVs line up.
        this._drawingBufferSize = new THREE.Vector2();
        this.renderer.getDrawingBufferSize(this._drawingBufferSize);
        this.soulRenderTarget = new THREE.WebGLRenderTarget(
            Math.max(1, this._drawingBufferSize.x),
            Math.max(1, this._drawingBufferSize.y),
            {
                format: THREE.RGBAFormat,
                type: THREE.HalfFloatType,
                minFilter: THREE.LinearFilter,
                magFilter: THREE.LinearFilter,
                stencilBuffer: false,
                depthBuffer: true,
            }
        );

        this.coreMesh = null;
        this.materialMode = 'glow';
        this.glowMaterial = null;

        this._tempColor = new THREE.Color();
        this._tempColor2 = new THREE.Color();
        this._white = new THREE.Color(1, 1, 1);
        this._tempQuat = new THREE.Quaternion();
        this._tempEuler = new THREE.Euler();
        this._quatX = new THREE.Quaternion();
        this._quatY = new THREE.Quaternion();
        this._quatZ = new THREE.Quaternion();
        this._rollQuat = new THREE.Quaternion();
        this._meshQuat = new THREE.Quaternion();
        this._xAxis = new THREE.Vector3(1, 0, 0);
        this._yAxis = new THREE.Vector3(0, 1, 0);
        this._cameraToMesh = new THREE.Vector3();
        this._cameraDir = new THREE.Vector3();
        this._soulPosTemp = new THREE.Vector3();
        this._cachedSoulMesh = null;
    }

    /**
     * IN-SCENE MODE (hex agent D20): draw the gem as if it stood in a HOST scene.
     *
     * The gem never leaves the origin of its own scene, so the soul, the particles and the
     * electric arcs keep their local frame. Instead, every frame the camera becomes the host
     * camera seen from the gem's anchor: position (host - anchor) / scale, the host quaternion,
     * fov, aspect, zoom, and near/far divided by the scale. The gem then lands on the canvas
     * exactly where a gem `scale` host units tall-per-engine-unit at `anchor.position` would.
     * The canvas must cover the same rectangle as the host canvas.
     *
     * `anchor` is read every frame, so a host moves the gem by mutating it.
     *
     * @param {THREE.PerspectiveCamera|null} source - host camera; null returns to the self-framed camera
     * @param {{ position?: number[], scale?: number }} [anchor] - host-world position, host units per engine unit
     */
    syncCamera(source, anchor = {}) {
        if (!source) {
            if (!this._follow) return;
            this._follow = null;
            const fov = this.options.fov !== undefined ? this.options.fov : 45;
            this.camera.fov = fov;
            this.camera.zoom = 1;
            this.camera.near = 0.1;
            this.camera.far = 100;
            this.camera.aspect = this._drawingBufferSize.x / Math.max(1, this._drawingBufferSize.y);
            this.camera.position.set(0, 0, this.cameraDistance);
            this.camera.quaternion.identity();
            this.camera.lookAt(0, 0, 0);
            this.camera.updateProjectionMatrix();
            return;
        }
        this._follow = { source, anchor };
        this._applyFollow();
    }

    /** True while the camera follows a host camera (syncCamera). */
    isFollowing() {
        return Boolean(this._follow);
    }

    /** @private copy the host camera into the gem's frame (once per frame). */
    _applyFollow() {
        const f = this._follow;
        if (!f) return;
        const src = f.source;
        const a = f.anchor || {};
        const p = a.position || [0, 0, 0];
        const s = a.scale > 0 ? a.scale : 1;
        const cam = this.camera;
        if (src.updateMatrixWorld) src.updateMatrixWorld();
        // World pose, so a camera parented under a rig still works.
        src.getWorldPosition ? src.getWorldPosition(cam.position) : cam.position.copy(src.position);
        cam.position.set((cam.position.x - p[0]) / s, (cam.position.y - p[1]) / s, (cam.position.z - p[2]) / s);
        src.getWorldQuaternion ? src.getWorldQuaternion(cam.quaternion) : cam.quaternion.copy(src.quaternion);
        cam.fov = src.fov;
        cam.aspect = src.aspect;
        cam.zoom = src.zoom ?? 1;
        cam.near = Math.max(1e-4, src.near / s);
        cam.far = Math.max(cam.near * 2, src.far / s);
        cam.updateProjectionMatrix();
        cam.updateMatrixWorld(true);
    }

    /**
     * The stage the particle system should think it is drawing on, while following a host camera.
     * Sparks are tuned for the self-framed stage (gem at 1.3, about half the stage tall); in a
     * full-viewport canvas the gem is a small part of the frame, so the 2D spawn space stays a
     * fixed square and the sprite size follows the stage the gem WOULD fill at its on-screen
     * size. Null when self-framed (the real canvas is the stage).
     * @returns {{width:number,height:number,pointHeight:number}|null}
     */
    particleStage() {
        if (!this._follow) return null;
        const d = Math.max(1e-3, this.camera.position.length());
        const fov0 = this.options.fov !== undefined ? this.options.fov : 45;
        const k = Math.tan((fov0 * Math.PI) / 360) / Math.tan((this.camera.fov * Math.PI) / 360);
        // Drawing-buffer px of the stage the gem would fill self-framed at its current size.
        const stage = Math.max(1, this._drawingBufferSize.y * (DEFAULT_CAMERA_DISTANCE / d) * k * (this.camera.zoom || 1));
        // The sprite shader divides by distance (75 / len) and raises the stage to STAGE_EXP;
        // this height puts the sprite at the size it has on that self-framed stage.
        const pointHeight = stage * Math.pow(d / DEFAULT_CAMERA_DISTANCE, 1 / PARTICLE_STAGE_EXP);
        return { width: FOLLOW_SPAWN_STAGE, height: FOLLOW_SPAWN_STAGE, pointHeight };
    }

    /** Forget the cached soul mesh (call when the soul is disposed or recreated). */
    invalidateSoulCache() {
        this._cachedSoulMesh = null;
    }

    /** Key/fill/rim + ambient. The crystal and electric shaders are self-lit. */
    setupLights() {
        this.ambientLight = new THREE.AmbientLight(0xffffff, 0.3);
        this.scene.add(this.ambientLight);
        this.keyLight = new THREE.DirectionalLight(0xffffff, 0.8);
        this.keyLight.position.set(2, 2, 2);
        this.scene.add(this.keyLight);
        this.fillLight = new THREE.DirectionalLight(0xffffff, 0.5);
        this.fillLight.position.set(-2, 1, 1);
        this.scene.add(this.fillLight);
        this.rimLight = new THREE.DirectionalLight(0xffffff, 0.7);
        this.rimLight.position.set(0, 1, -2);
        this.scene.add(this.rimLight);
    }

    /** @param {Event} event */
    handleContextLost(event) {
        event.preventDefault();
        this._contextLost = true;
        console.warn('[ThreeRenderer] WebGL context lost - rendering paused');
    }

    handleContextRestored() {
        this._contextLost = false;
        if (this.materialMode === 'glow' && this.coreMesh && this.coreMesh.material === this.glowMaterial) {
            this.glowMaterial = this.createGlowMaterial();
            this.coreMesh.material = this.glowMaterial;
        }
        if (this.onContextRestored) this.onContextRestored();
    }

    /**
     * Create the core mesh.
     * @param {THREE.BufferGeometry} geometry
     * @param {THREE.Material} [customMaterial] - the crystal material; glow material if absent
     * @returns {THREE.Mesh}
     */
    createCoreMesh(geometry, customMaterial = null) {
        if (this.coreMesh) {
            this.scene.remove(this.coreMesh);
            if (this.coreMesh.geometry) this.coreMesh.geometry.dispose();
            if (this.coreMesh.material) this.disposeMaterial(this.coreMesh.material);
            this.coreMesh = null;
        }
        let material = customMaterial;
        if (!material) {
            if (!this.glowMaterial) this.glowMaterial = this.createGlowMaterial();
            material = this.glowMaterial;
        }
        this.coreMesh = new THREE.Mesh(geometry, material);
        this.coreMesh.name = 'coreMascot';
        // Crystal first among transparent objects so arcs depth-test against it.
        if (material.transparent) this.coreMesh.renderOrder = -1;
        this.scene.add(this.coreMesh);
        return this.coreMesh;
    }

    /**
     * Swap geometry (and optionally material) on the existing core mesh.
     * @param {THREE.BufferGeometry} newGeometry
     * @param {THREE.Material} [customMaterial]
     */
    swapGeometry(newGeometry, customMaterial = null) {
        if (!this.coreMesh) return;
        if (this.coreMesh.geometry) this.coreMesh.geometry.dispose();
        this.coreMesh.geometry = newGeometry;

        if (customMaterial) {
            const old = this.coreMesh.material;
            // A reused material (crystal to crystal morph) stays alive: disposing it would
            // release its program and force a relink.
            if (old && old !== this.glowMaterial && old !== customMaterial) this.disposeMaterial(old);
            this.coreMesh.material = customMaterial;
            if (customMaterial.uniforms?.resolution) {
                this.renderer.getDrawingBufferSize(this._drawingBufferSize);
                customMaterial.uniforms.resolution.value.set(
                    this._drawingBufferSize.x,
                    this._drawingBufferSize.y
                );
            }
        } else {
            if (!this.glowMaterial) this.glowMaterial = this.createGlowMaterial();
            if (this.coreMesh.material !== this.glowMaterial) {
                if (this.coreMesh.material) this.disposeMaterial(this.coreMesh.material);
                this.coreMesh.material = this.glowMaterial;
            }
        }
    }

    /** Fresnel glow material for non-crystal geometry (sphere fallback). */
    createGlowMaterial() {
        return new THREE.ShaderMaterial({
            uniforms: {
                glowColor: { value: new THREE.Color(1, 1, 1) },
                glowIntensity: { value: 1.0 },
                coreColor: { value: new THREE.Color(1, 1, 1) },
                fresnelPower: { value: 3.0 },
                uOpacity: { value: 1.0 },
            },
            vertexShader: /* glsl */ `
                varying vec3 vNormal;
                varying vec3 vViewPosition;
                void main() {
                    vNormal = normalize(normalMatrix * normal);
                    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                    vViewPosition = -mvPosition.xyz;
                    gl_Position = projectionMatrix * mvPosition;
                }
            `,
            fragmentShader: /* glsl */ `
                uniform vec3 glowColor;
                uniform vec3 coreColor;
                uniform float glowIntensity;
                uniform float fresnelPower;
                uniform float uOpacity;
                varying vec3 vNormal;
                varying vec3 vViewPosition;
                void main() {
                    if (uOpacity < 0.01) discard;
                    vec3 viewDir = normalize(vViewPosition);
                    float fresnel = pow(1.0 - abs(dot(vNormal, viewDir)), fresnelPower);
                    vec3 finalColor = (coreColor * glowIntensity) + (glowColor * glowIntensity * fresnel);
                    gl_FragColor = vec4(finalColor, uOpacity);
                    #include <tonemapping_fragment>
                    #include <colorspace_fragment>
                }
            `,
            transparent: true,
            side: THREE.FrontSide,
        });
    }

    /** Only 'glow' exists in this build (the glass material path is deleted). */
    setMaterialMode(mode) {
        this.materialMode = 'glow';
        if (mode !== 'glow') console.warn(`[ThreeRenderer] material mode "${mode}" is not in this build`);
    }

    /**
     * Tint the lights toward the emotion colour.
     * @param {string} emotion
     * @param {Object} emotionData
     * @param {number} [transitionSpeed=0.15]
     */
    updateLighting(emotion, emotionData, transitionSpeed = 0.15) {
        if (!emotionData || !emotionData.visual) return;
        this._tempColor.set(emotionData.visual.glowColor || '#FFFFFF');
        const targetIntensity = emotionData.visual.glowIntensity || 1.0;
        if (this.keyLight) {
            this.keyLight.color.lerp(this._tempColor, transitionSpeed);
            this.keyLight.intensity += (0.8 * targetIntensity - this.keyLight.intensity) * transitionSpeed;
        }
        if (this.fillLight) {
            this._tempColor2.copy(this._tempColor).lerp(this._white, 0.7);
            this.fillLight.color.lerp(this._tempColor2, transitionSpeed * 0.5);
            this.fillLight.intensity += (0.3 * targetIntensity - this.fillLight.intensity) * transitionSpeed;
        }
        if (this.ambientLight) {
            this.ambientLight.intensity += (0.4 * targetIntensity - this.ambientLight.intensity) * transitionSpeed;
        }
    }

    /**
     * Compress a wide intensity range (0.3-10) to 0.8-1.2.
     * @param {number} intensity
     */
    normalizeIntensity(intensity) {
        const normalized = Math.log(intensity + 1) / Math.log(11);
        return 0.8 + normalized * 0.4;
    }

    /** No screen-space bloom in this build; glow lives in the shaders. */
    updateBloom() {}

    /** No refraction pass in this build (electric does not refract). */
    addRefractionMesh() {}

    /** No refraction pass in this build. */
    removeRefractionMesh() {}

    /**
     * Draw one frame.
     * @param {Object} [params]
     * @param {number[]} [params.position]
     * @param {number[]} [params.rotation]
     * @param {number} [params.scale]
     * @param {number[]|null} [params.nonUniformScale]
     * @param {number[]} [params.glowColor]
     * @param {number} [params.glowIntensity]
     * @param {boolean} [params.hasActiveGesture]
     * @param {number[]} [params.calibrationRotation]
     * @param {number} [params.cameraRoll]
     * @param {boolean} [params.hasSoul] - draw the soul pass
     * @param {boolean} [params.hasParticles] - draw layer 1
     * @param {Object} [params.deformation]
     */
    render(params = {}) {
        if (this._destroyed || this._contextLost) return;
        if (!this.scene || !this.camera || !this.renderer || !this.coreMesh) return;

        // First frame only clears: uninitialised GPU buffers can show garbage.
        if (!this._firstFrameRendered) {
            this._firstFrameRendered = true;
            this.renderer.setRenderTarget(null);
            this.renderer.setClearColor(0x000000, 0);
            this.renderer.clear();
            return;
        }

        const {
            position = [0, 0, 0],
            rotation = [0, 0, 0],
            scale = 1.0,
            nonUniformScale = null,
            glowColor = [1, 1, 1],
            glowIntensity = 1.0,
            hasActiveGesture = false,
            calibrationRotation = [0, 0, 0],
            cameraRoll = 0,
            hasSoul = false,
            hasParticles = true,
        } = params;

        // In-scene mode: the host camera, read now, so the gem tracks an orbit frame by frame.
        if (this._follow) this._applyFollow();

        this._updateCoreMesh(
            position,
            rotation,
            scale,
            nonUniformScale,
            glowColor,
            glowIntensity,
            hasActiveGesture,
            calibrationRotation,
            cameraRoll,
            params.deformation
        );

        const gl = this.renderer;

        // 1. Soul (layer 2) into its own target, sampled by the crystal shader.
        if (hasSoul && this.soulRenderTarget) {
            if (!this._cachedSoulMesh) {
                this.scene.traverse(obj => {
                    if (obj.name === 'crystalSoul') this._cachedSoulMesh = obj;
                });
            }
            const soulMesh = this._cachedSoulMesh;
            gl.setRenderTarget(this.soulRenderTarget);
            gl.setClearColor(0x000000, 0);
            gl.clear();
            this.camera.layers.set(2);
            gl.render(this.scene, this.camera);

            const u = this.coreMesh.material?.uniforms;
            if (u?.soulTexture) {
                u.soulTexture.value = this.soulRenderTarget.texture;
                if (u.soulTextureSize) {
                    u.soulTextureSize.value.set(this.soulRenderTarget.width, this.soulRenderTarget.height);
                }
                if (u.soulScreenCenter && soulMesh) {
                    this._soulPosTemp.copy(soulMesh.position).project(this.camera);
                    u.soulScreenCenter.value.set(
                        (this._soulPosTemp.x + 1.0) * 0.5,
                        (this._soulPosTemp.y + 1.0) * 0.5
                    );
                }
            }
        }

        // 2. Scene (layer 0) to the canvas.
        gl.setRenderTarget(null);
        gl.setClearColor(0x000000, 0);
        gl.clear();
        this.camera.layers.set(0);
        gl.render(this.scene, this.camera);

        // 3. Particles (layer 1) on top, depth-tested against the scene's depth.
        if (hasParticles) {
            this.camera.layers.set(1);
            gl.render(this.scene, this.camera);
        }

        this.camera.layers.set(0);
    }

    /** @private */
    _updateCoreMesh(
        position,
        rotation,
        scale,
        nonUniformScale,
        glowColor,
        glowIntensity,
        hasActiveGesture,
        calibrationRotation,
        cameraRoll,
        deformation
    ) {
        const mesh = this.coreMesh;
        mesh.position.set(...position);

        this._tempEuler.set(rotation[0], rotation[1], rotation[2], 'XYZ');
        this._tempQuat.setFromEuler(this._tempEuler);
        this._quatX.setFromAxisAngle(this._xAxis, calibrationRotation[0]);
        this._quatY.setFromAxisAngle(this._yAxis, calibrationRotation[1]);
        this._cameraToMesh.subVectors(mesh.position, this.camera.position).normalize();
        this._quatZ.setFromAxisAngle(this._cameraToMesh, calibrationRotation[2]);
        this._tempQuat.multiply(this._quatX).multiply(this._quatY).multiply(this._quatZ);
        mesh.rotation.setFromQuaternion(this._tempQuat);

        if (cameraRoll !== 0) {
            this._cameraDir.subVectors(mesh.position, this.camera.position).normalize();
            this._rollQuat.setFromAxisAngle(this._cameraDir, cameraRoll);
            this._meshQuat.setFromEuler(mesh.rotation);
            this._meshQuat.premultiply(this._rollQuat);
            mesh.rotation.setFromQuaternion(this._meshQuat);
        }

        if (nonUniformScale) mesh.scale.set(nonUniformScale[0], nonUniformScale[1], nonUniformScale[2]);
        else mesh.scale.setScalar(scale);

        const u = mesh.material?.uniforms;
        if (!u) return;
        if (u.glowColor) {
            this._tempColor.setRGB(...glowColor);
            const c = u.glowColor.value;
            if (Math.abs(this._tempColor.r - c.r) + Math.abs(this._tempColor.g - c.g) + Math.abs(this._tempColor.b - c.b) > 0.001) {
                c.lerp(this._tempColor, 0.15);
            }
        }
        if (u.glowIntensity) {
            const target =
                glowIntensity === 0 ? 0 : hasActiveGesture ? glowIntensity : this.normalizeIntensity(glowIntensity);
            const cur = u.glowIntensity.value;
            if (Math.abs(target - cur) > 0.001) u.glowIntensity.value += (target - cur) * (hasActiveGesture ? 0.5 : 0.15);
        }
        if (u.deformationStrength !== undefined) {
            const d = deformation;
            if (d && d.enabled && d.strength > 0.001) {
                u.deformationStrength.value = d.strength;
                if (d.impactPoint && u.impactPoint) u.impactPoint.value.set(d.impactPoint[0], d.impactPoint[1], d.impactPoint[2]);
                if (d.falloffRadius !== undefined && u.deformationFalloff) u.deformationFalloff.value = d.falloffRadius;
            } else {
                u.deformationStrength.value = 0;
            }
        }
    }

    /**
     * Pre-link an object's shader programs off the main thread (KHR_parallel_shader_compile).
     * Uses renderer.compile() plus OUR OWN completion poller instead of three's compileAsync:
     * the poller stops the moment close begins, so no completion-status query can follow a
     * close and teardown never waits on a link (no timeout hole). Without the extension the
     * link is synchronous and there is nothing to poll.
     * @param {THREE.Object3D} object
     * @param {{ target?: THREE.WebGLRenderTarget|null }} [opts] - the target the object is
     *   drawn into (the program variant differs between the canvas and a linear target)
     * @returns {Promise<boolean>} true once linked, false if cancelled or failed
     */
    async compileObjectAsync(object, { target = null } = {}) {
        if (!object || !this.renderer || !this.camera || this._contextLost || this._closing) return false;
        const gl = this.renderer;
        const savedTarget = gl.getRenderTarget();
        let materials;
        try {
            gl.setRenderTarget(target);
            materials = gl.compile(object, this.camera, this.scene);
        } catch (error) {
            console.warn('[ThreeRenderer] shader compile failed, falling back to lazy compile', error);
            return false;
        } finally {
            if (!this._destroyed) gl.setRenderTarget(savedTarget);
        }
        if (!gl.extensions.has('KHR_parallel_shader_compile') || !materials?.size) return true;

        const poll = { timer: null, finish: null };
        const raw = new Promise(resolve => {
            poll.finish = ok => {
                clearTimeout(poll.timer);
                this._pollers.delete(poll);
                resolve(ok);
            };
            const check = () => {
                if (this._closing || this._destroyed || this._contextLost) return poll.finish(false);
                for (const m of materials) {
                    const program = gl.properties.get(m)?.currentProgram;
                    if (!program || program.isReady()) materials.delete(m);
                }
                if (materials.size === 0) return poll.finish(true);
                poll.timer = setTimeout(check, LINK_POLL_MS);
            };
            this._pollers.add(poll);
            check();
        });
        this._trackCompile(raw);
        return raw;
    }

    /**
     * Refuse new shader compiles from now on (teardown has begun) and stop every link poller
     * at once (they resolve false).
     */
    beginClose() {
        this._closing = true;
        for (const poll of [...this._pollers]) poll.finish(false);
    }

    /** @private */
    _trackCompile(raw) {
        this._pendingCompiles.add(raw);
        const done = () => this._pendingCompiles.delete(raw);
        raw.then(done, done);
    }

    /** @returns {number} raw compileAsync promises not yet settled */
    pendingCompileCount() {
        return this._pendingCompiles.size;
    }

    /**
     * Resolves once every link poller has settled (they stop at beginClose()).
     * @returns {Promise<void>}
     */
    async whenCompilesSettled() {
        const deadline = Date.now() + COMPILE_TIMEOUT_MS;
        while (this._pendingCompiles.size > 0) {
            const left = deadline - Date.now();
            if (left <= 0) {
                console.warn('[ThreeRenderer] shader compiles still pending at teardown; releasing anyway');
                return;
            }
            let timer;
            await Promise.race([
                Promise.allSettled([...this._pendingCompiles]),
                new Promise(resolve => (timer = setTimeout(resolve, left))),
            ]);
            clearTimeout(timer);
        }
    }

    /**
     * @param {number} width - CSS px
     * @param {number} height - CSS px
     */
    resize(width, height) {
        if (!this.renderer) return;
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height, false);
        this.renderer.getDrawingBufferSize(this._drawingBufferSize);
        if (this.soulRenderTarget) {
            this.soulRenderTarget.setSize(this._drawingBufferSize.x, this._drawingBufferSize.y);
        }
        if (this.coreMesh?.material?.uniforms?.resolution) {
            this.coreMesh.material.uniforms.resolution.value.set(
                this._drawingBufferSize.x,
                this._drawingBufferSize.y
            );
        }
    }

    /**
     * Dispose a material and every texture it owns.
     * @param {THREE.Material} material
     */
    disposeMaterial(material) {
        if (!material) return;
        for (const prop of ['map', 'normalMap', 'envMap', 'alphaMap', 'emissiveMap']) {
            if (material[prop]) material[prop].dispose();
        }
        if (material.uniforms) {
            for (const uniform of Object.values(material.uniforms)) {
                const v = uniform.value;
                if (!v) continue;
                // The soul target's texture is owned by the render target, not the material.
                if (v.isTexture && v !== this.soulRenderTarget?.texture) {
                    v.dispose();
                    uniform.value = null;
                } else if (v.isColor || v.isVector2 || v.isVector3 || v.isVector4) {
                    uniform.value = null;
                }
            }
        }
        material.dispose();
    }

    /**
     * Release every GPU resource and the context. GL teardown waits for in-flight shader
     * compiles (three polls the program until it links), then dispose() + forceContextLoss().
     * @returns {Promise<void>}
     */
    destroy() {
        if (this._destroyPromise) return this._destroyPromise;
        this._destroyed = true;
        this.beginClose();
        this._destroyPromise = this.whenCompilesSettled().then(() => this._disposeGL());
        return this._destroyPromise;
    }

    /** @private */
    _disposeGL() {
        if (this.renderer?.domElement) {
            this.renderer.domElement.removeEventListener('webglcontextlost', this._boundHandleContextLost, false);
            this.renderer.domElement.removeEventListener(
                'webglcontextrestored',
                this._boundHandleContextRestored,
                false
            );
        }
        if (this.coreMesh) {
            this.scene.remove(this.coreMesh);
            this.coreMesh.geometry?.dispose();
            this.disposeMaterial(this.coreMesh.material);
            this.coreMesh = null;
        }
        if (this.glowMaterial) {
            this.disposeMaterial(this.glowMaterial);
            this.glowMaterial = null;
        }
        if (this.soulRenderTarget) {
            this.soulRenderTarget.dispose();
            this.soulRenderTarget = null;
        }
        if (this.renderer) {
            this.renderer.dispose();
            // Free the context now instead of at GC: browsers cap live contexts and drop the
            // OLDEST, which would be the host page's (root cause 7.2).
            this.renderer.forceContextLoss();
            this.renderer = null;
        }
        this.scene.clear();
        this.keyLight = this.fillLight = this.rimLight = this.ambientLight = null;
        this.camera = null;
        this._cachedSoulMesh = null;
    }
}
