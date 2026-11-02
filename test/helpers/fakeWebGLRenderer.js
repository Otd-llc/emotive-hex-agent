/**
 * A recording stand-in for THREE.WebGLRenderer (no GL). Every method call is appended to
 * `log` as { fn, args, layers, target }; unknown methods are no-ops. Use with vi.mock('three').
 */
export function makeFakeRendererClass(THREE, { bufferW = 300, bufferH = 200 } = {}) {
    return class FakeWebGLRenderer {
        static instances = [];
        constructor(params = {}) {
            const canvas = params.canvas ?? { width: bufferW, height: bufferH };
            canvas.addEventListener ??= () => {};
            canvas.removeEventListener ??= () => {};
            canvas.style ??= {};
            this.domElement = canvas;
            this.log = [];
            this._target = null;
            this._pending = [];
            this.debug = { checkShaderErrors: false };
            this.shadowMap = { enabled: false };
            this.state = { reset: () => {} };
            this.info = { programs: [] };
            this.capabilities = { isWebGL2: true, maxSamples: 4 };
            // KHR_parallel_shader_compile on by default; tests flip `parallelCompile`.
            this.parallelCompile = true;
            this.extensions = {
                get: name => (name === 'KHR_parallel_shader_compile' && this.parallelCompile ? {} : null),
                has: name => name === 'KHR_parallel_shader_compile' && this.parallelCompile,
            };
            // Program link state for compile(): isReady() counts as a completion-status query.
            this._programs = new Map();
            this.readyChecks = 0;
            this.properties = { get: m => ({ currentProgram: this._programs.get(m) }) };
            this.outputColorSpace = THREE.SRGBColorSpace;
            this.toneMapping = THREE.NoToneMapping;
            this.toneMappingExposure = 1;
            this.autoClear = true;
            this._gl = {
                isContextLost: () => false,
                getExtension: () => null,
                getParameter: () => 0,
            };
            FakeWebGLRenderer.instances.push(this);
            return new Proxy(this, {
                get: (t, k) => {
                    if (k in t) return t[k];
                    if (typeof k === 'symbol' || k === 'then') return undefined; // not a thenable
                    return (...args) => {
                        t.log.push({ fn: k, args });
                        return undefined;
                    };
                },
            });
        }
        _rec(fn, args) {
            this.log.push({ fn, args, target: this._target });
        }
        setRenderTarget(t) {
            this._target = t;
            this._rec('setRenderTarget', [t]);
        }
        getRenderTarget() {
            return this._target;
        }
        render(scene, camera) {
            this.log.push({ fn: 'render', target: this._target, layers: camera.layers.mask, override: !!scene.overrideMaterial });
        }
        clear() {
            this._rec('clear', []);
        }
        getContext() {
            return this._gl;
        }
        getPixelRatio() {
            return 1;
        }
        setPixelRatio() {}
        setSize() {}
        setClearColor() {}
        getClearColor(c) {
            return c;
        }
        getClearAlpha() {
            return 0;
        }
        getSize(v) {
            return v.set(bufferW, bufferH);
        }
        getDrawingBufferSize(v) {
            return v.set(bufferW, bufferH);
        }
        /** Like three: returns the Set of materials whose programs were (re)built. */
        compile(object) {
            this._rec('compile', []);
            const set = new Set();
            object?.traverse?.(o => {
                if (o.material) set.add(o.material);
            });
            for (const m of set) {
                const prog = { linked: false, isReady: () => (this.readyChecks++, prog.linked) };
                this._programs.set(m, prog);
            }
            return set;
        }
        compileAsync() {
            let resolve;
            const p = new Promise(r => (resolve = r));
            this._pending.push(resolve);
            this._rec('compileAsync', []);
            return p;
        }
        /** test helper: every program compiled SO FAR finishes linking (+ pending compileAsync) */
        settleCompiles() {
            for (const p of this._programs.values()) p.linked = true;
            this._pending.splice(0).forEach(r => r());
        }
        dispose() {
            this._rec('dispose', []);
        }
        forceContextLoss() {
            this._rec('forceContextLoss', []);
        }
    };
}
