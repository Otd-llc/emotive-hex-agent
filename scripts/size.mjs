// Size of dist/emotive-hex-agent.js: raw, gzip -9, brotli (q11). Prints JSON.
import { readFileSync } from 'fs';
import { gzipSync, brotliCompressSync, constants } from 'zlib';
const f = process.argv[2] ?? 'dist/emotive-hex-agent.js';
const b = readFileSync(f);
const gz = gzipSync(b, { level: 9 }).length;
const br = brotliCompressSync(b, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length;
const kb = (n) => +(n / 1024).toFixed(1);
console.log(JSON.stringify({ file: f, raw: b.length, gzip9: gz, brotli: br, rawKB: kb(b.length), gzipKB: kb(gz), brotliKB: kb(br) }));
