/**
 * A fetch() stand-in that serves test/fixtures/agent/ for any URL ending in a fixture name.
 * Records every requested URL in `fetchFixture.urls`.
 */
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export const FIXTURE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/agent');

/** @returns {ArrayBuffer} */
export function fixtureBuffer(name) {
    const b = readFileSync(path.join(FIXTURE_DIR, name));
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}

export function fetchFixture(url) {
    fetchFixture.urls.push(String(url));
    const name = String(url).split('/').pop();
    const file = path.join(FIXTURE_DIR, name);
    if (!existsSync(file)) return Promise.resolve({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) });
    return Promise.resolve({ ok: true, status: 200, arrayBuffer: async () => fixtureBuffer(name) });
}
fetchFixture.urls = [];
