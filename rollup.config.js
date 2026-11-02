/**
 * emotive-hex-agent: ONE build.
 *   src/3d/index-hex-agent.js -> dist/emotive-hex-agent.js (ESM, three external)
 *
 * STUBS (temporary, shrinks to empty as modules are deleted from the repo): a module listed
 * here is replaced at build time by a no-op module that keeps its export names.
 */
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import terser from '@rollup/plugin-terser';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const S = (p) => path.resolve(ROOT, 'src', p);

/** Source modules stubbed at build time (paths relative to src/). Empty once deletion is done. */
export const STUBS = [
    '3d/effects/SmokeParticleSystem.js', '3d/effects/ParticleAtmosphericsManager.js',
    '3d/AmbientOcclusionPass.js', '3d/effects/VelocityMotionBlurPass.js', '3d/UnrealBloomPassAlpha.js',
    '3d/effects/CrackLayer.js',
    '3d/materials/overlays/WaterMaterial.js', '3d/materials/overlays/FireMaterial.js',
    '3d/materials/overlays/VoidMaterial.js', '3d/materials/overlays/IceMaterial.js',
    '3d/materials/overlays/LightMaterial.js', '3d/materials/overlays/EarthMaterial.js',
    '3d/materials/overlays/NatureMaterial.js',
].map(S);

const isStubbed = (abs) => STUBS.includes(abs);

function stubPlugin() {
    return {
        name: 'hex-agent-stubs',
        async resolveId(source, importer, opts) {
            if (!importer || !source.startsWith('.')) return null;
            const r = await this.resolve(source, importer, { ...opts, skipSelf: true });
            if (r && !r.external && isStubbed(r.id)) return '\0stub:' + r.id;
            return null;
        },
        load(id) {
            if (!id.startsWith('\0stub:')) return null;
            const ast = this.parse(fs.readFileSync(id.slice(6), 'utf8'));
            const names = new Set();
            let hasDefault = false;
            for (const n of ast.body) {
                if (n.type === 'ExportDefaultDeclaration') hasDefault = true;
                if (n.type !== 'ExportNamedDeclaration') continue;
                for (const d of n.declaration?.declarations ?? []) if (d.id.name) names.add(d.id.name);
                if (n.declaration?.id?.name) names.add(n.declaration.id.name);
                for (const s of n.specifiers ?? []) {
                    const nm = s.exported.name ?? s.exported.value;
                    if (nm === 'default') hasDefault = true;
                    else names.add(nm);
                }
            }
            const noop =
                'const __n=new Proxy(function(){},{get:(t,k)=>k===Symbol.toPrimitive?()=>0:__n,apply:()=>__n,construct:()=>__n});';
            return noop + [...names].map((n) => `export const ${n}=__n;`).join('') + (hasDefault ? 'export default __n;' : '');
        },
    };
}

const BANNER = `/*! emotive-hex-agent | MIT License
 * Copyright (c) 2025-2026 Joshua Tollette (Emotive Engine)
 * Copyright (c) 2026 One Thousand Drones LLC
 * Derived from the Emotive Engine, https://github.com/joshtol/emotive-engine */`;

export default {
    input: 'src/3d/index-hex-agent.js',
    output: {
        file: 'dist/emotive-hex-agent.js',
        format: 'es',
        banner: BANNER,
        inlineDynamicImports: true,
        sourcemap: true,
    },
    external: (id) => /^three(\/|$)/.test(id),
    treeshake: { moduleSideEffects: true },
    plugins: [
        stubPlugin(),
        resolve({ browser: true, preferBuiltins: false }),
        commonjs(),
        terser({
            compress: { drop_console: false, pure_funcs: ['console.log'], drop_debugger: true, passes: 2 },
            mangle: { properties: false },
            // License banners only (/*! ... */, @license, @preserve).
            format: { comments: 'some' },
        }),
    ],
};
