// Lists src/ files the hex-agent build does NOT reach (candidates for deletion).
// Stubbed modules count as reached (source still imports them).
// Usage: node scripts/reachable.mjs [--unreached|--reached]
import { rollup } from 'rollup';
import path from 'path';
import fs from 'fs';
import config, { STUBS } from '../rollup.config.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '..');
const bundle = await rollup({ ...config, plugins: config.plugins.filter(p => p.name !== 'terser' && !(process.env.REAL && p.name === 'hex-agent-stubs')), onwarn: () => {} });
const reached = new Set();
for (const id of bundle.cache.modules.map(m => m.id)) {
    const real = id.startsWith('\0stub:') ? id.slice(6) : id;
    if (!real.startsWith('\0')) reached.add(path.resolve(real));
}
for (const s of STUBS) reached.add(path.resolve(s));
await bundle.close();
const all = [];
const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); e.isDirectory() ? walk(p) : all.push(path.resolve(p)); } };
walk(path.join(ROOT, 'src'));
const mode = process.argv[2] ?? '--unreached';
const out = all.filter(f => (mode === '--reached') === reached.has(f)).map(f => path.relative(ROOT, f).split(path.sep).join('/')).sort();
console.log(out.join('\n'));
