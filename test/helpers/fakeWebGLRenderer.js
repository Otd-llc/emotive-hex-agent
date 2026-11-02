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
            this.extensions = { get: () => null, has: () => false };
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
                    if (typeof k === 'symbol') return undefined;
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
        compile() {
            return new Set();
        }
        compileAsync() {
            let resolve;
            const p = new Promise(r => (resolve = r));
            this._pending.push(resolve);
            this._rec('compileAsync', []);
            return p;
        }
        /** test helper: settle every pending compileAsync */
        settleCompiles() {
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
