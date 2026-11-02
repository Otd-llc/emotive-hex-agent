/**
 * The engine loads its models and textures from assetBasePath; there is no default, so a
 * host can never fetch from a guessed '/assets' path (fix e).
 * @param {unknown} p
 * @throws {Error} when p is not a non-empty string
 */
export function assertAssetBasePath(p) {
    if (typeof p !== 'string' || p.length === 0) {
        throw new Error(
            '[emotive-hex-agent] assetBasePath is required (the URL prefix of models/ and textures/)'
        );
    }
}
