// Size gate for dist/emotive-hex-agent.js: prints raw, gzip -9 and brotli (q11) as JSON and
// exits 1 when gzip -9 exceeds the ceiling (150 KB = 153,600 bytes; plan Revision 2).
// SIZE_CEILING_KB overrides the ceiling (e.g. to demonstrate the gate failing).
// Usage: node scripts/size.mjs [file]
import { readFileSync, existsSync } from 'fs';
import { gzipSync, brotliCompressSync, constants } from 'zlib';

const CEILING_KB = Number(process.env.SIZE_CEILING_KB ?? 150);
const f = process.argv[2] ?? 'dist/emotive-hex-agent.js';
if (!existsSync(f)) {
    console.error(`[size] ${f} missing: run npm run build`);
    process.exit(2);
}
const b = readFileSync(f);
const gz = gzipSync(b, { level: 9 }).length;
const br = brotliCompressSync(b, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length;
const kb = n => +(n / 1024).toFixed(1);
const ok = gz <= CEILING_KB * 1024;
console.log(
    JSON.stringify({ file: f, raw: b.length, gzip9: gz, brotli: br, rawKB: kb(b.length), gzipKB: kb(gz), brotliKB: kb(br), ceilingKB: CEILING_KB, result: ok ? 'PASS' : 'FAIL' })
);
process.exit(ok ? 0 : 1);
