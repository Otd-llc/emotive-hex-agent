/**
 * With the fake renderer: wait until the core's off-thread link has started, finish it, and
 * resolve once the core draws (whenVisible). Returns the fake GL.
 * @param {import('../../src/3d/Core3DManager.js').Core3DManager} core
 */
export async function linkCore(core) {
    await core.waitUntilReady();
    const gl = core.renderer.renderer;
    for (let i = 0; i < 200 && core.renderer.pendingCompileCount() === 0 && !core._linked; i++) {
        await new Promise(r => setTimeout(r, 2));
    }
    gl.settleCompiles();
    await core.whenVisible();
    return gl;
}
