import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { createHash } from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

// The agent assets under test/fixtures/agent/ are a COPY of the Blender outputs whose source
// of truth is bs-premades public/agent/ (sha256.json + PROVENANCE.json copied alongside).
// Every fixture must hash to its manifest entry, and the folder holds nothing unlisted.
const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/agent');
const MANIFESTS = new Set(['sha256.json', 'PROVENANCE.json']);

const manifest = JSON.parse(readFileSync(path.join(DIR, 'sha256.json'), 'utf8'));

describe('agent fixtures match sha256.json', () => {
    for (const [name, { sha256, bytes }] of Object.entries(manifest)) {
        it(name, () => {
            const buf = readFileSync(path.join(DIR, name));
            expect(buf.length, `${name} byte length`).toBe(bytes);
            expect(createHash('sha256').update(buf).digest('hex'), `${name} sha256`).toBe(sha256);
        });
    }

    it('the folder holds exactly the manifest files', () => {
        const files = readdirSync(DIR).filter(f => !MANIFESTS.has(f)).sort();
        expect(files).toEqual(Object.keys(manifest).sort());
    });

    it('every fixture has a provenance + licence line', () => {
        const prov = JSON.parse(readFileSync(path.join(DIR, 'PROVENANCE.json'), 'utf8'));
        for (const name of Object.keys(manifest)) {
            expect(prov[name]?.licence, `${name} licence`).toMatch(/MIT/);
        }
    });
});
