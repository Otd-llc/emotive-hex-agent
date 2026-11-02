// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

// In-scene mode (D20): the gem's camera follows a host camera relative to an anchor, so the gem
// lands on the canvas where a gem at the anchor would stand in the host scene.
vi.mock('three', async importOriginal => {
    const THREE = await importOriginal();
    const { makeFakeRendererClass } = await import('../../helpers/fakeWebGLRenderer.js');
    return { ...THREE, WebGLRenderer: makeFakeRendererClass(THREE, { bufferW: 800, bufferH: 600 }) };
});

const THREE = await import('three');
const { ThreeRenderer, DEFAULT_CAMERA_DISTANCE, FOLLOW_SPAWN_STAGE } = await import('../../../src/3d/ThreeRenderer.js');
const { EmotiveMascot3D } = await import('../../../src/3d/index.js');

function makeRenderer() {
    const canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 600;
    const r = new ThreeRenderer(canvas, { assetBasePath: '/x/' });
    r.createCoreMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    return r;
}

function hostCamera() {
    const cam = new THREE.PerspectiveCamera(38, 800 / 600, 0.01, 50);
    cam.position.set(0.4, 0.35, 0.6);
    cam.lookAt(0.05, 0.02, -0.03);
    cam.updateMatrixWorld(true);
    return cam;
}

/** NDC of a point seen by a camera. */
const ndc = (cam, p) => new THREE.Vector3(...p).project(cam);

describe('syncCamera (in-scene mode)', () => {
    let r;
    beforeEach(() => {
        r = makeRenderer();
        r.render({}); // the first frame only clears
    });

    it('starts self-framed: no particle stage override', () => {
        expect(r.isFollowing()).toBe(false);
        expect(r.particleStage()).toBeNull();
        expect(r.camera.position.toArray()).toEqual([0, 0, DEFAULT_CAMERA_DISTANCE]);
    });

    it('copies the host camera relative to the anchor, scaled', () => {
        const host = hostCamera();
        const anchor = { position: [0.1, 0.05, -0.02], scale: 0.04 };
        r.syncCamera(host, anchor);
        r.render({});
        const c = r.camera;
        expect(c.position.x).toBeCloseTo((0.4 - 0.1) / 0.04, 6);
        expect(c.position.y).toBeCloseTo((0.35 - 0.05) / 0.04, 6);
        expect(c.position.z).toBeCloseTo((0.6 + 0.02) / 0.04, 6);
        expect(c.quaternion.angleTo(host.quaternion)).toBeLessThan(1e-6);
        expect(c.fov).toBe(38);
        expect(c.aspect).toBeCloseTo(800 / 600, 9);
        expect(c.near).toBeCloseTo(0.01 / 0.04, 9);
        expect(c.far).toBeCloseTo(50 / 0.04, 9);
    });

    it('puts the gem where the anchor projects in the host view, at host scale', () => {
        const host = hostCamera();
        const anchor = { position: [0.1, 0.05, -0.02], scale: 0.04 };
        r.syncCamera(host, anchor);
        r.render({});
        const o = ndc(r.camera, [0, 0, 0]);
        const h = ndc(host, anchor.position);
        expect(o.x).toBeCloseTo(h.x, 6);
        expect(o.y).toBeCloseTo(h.y, 6);
        // One engine unit up is `scale` host units up.
        const top = ndc(r.camera, [0, 1, 0]);
        const hostTop = ndc(host, [0.1, 0.05 + 0.04, -0.02]);
        expect(top.x).toBeCloseTo(hostTop.x, 6);
        expect(top.y).toBeCloseTo(hostTop.y, 6);
    });

    it('reads the anchor every frame (a host moves the gem by mutating it)', () => {
        const host = hostCamera();
        const anchor = { position: [0, 0, 0], scale: 0.05 };
        r.syncCamera(host, anchor);
        r.render({});
        anchor.position = [0.2, 0, 0];
        r.render({});
        const o = ndc(r.camera, [0, 0, 0]);
        const h = ndc(host, [0.2, 0, 0]);
        expect(o.x).toBeCloseTo(h.x, 6);
        expect(o.y).toBeCloseTo(h.y, 6);
    });

    it('follows an orbit of the host camera on the next frame', () => {
        const host = hostCamera();
        const anchor = { position: [0, 0, 0], scale: 0.05 };
        r.syncCamera(host, anchor);
        r.render({});
        host.position.set(-0.5, 0.2, 0.3);
        host.lookAt(0, 0, 0);
        r.render({});
        expect(r.camera.quaternion.angleTo(host.quaternion)).toBeLessThan(1e-6);
        expect(r.camera.position.x).toBeCloseTo(-0.5 / 0.05, 6);
    });

    it('sizes sparks for the stage the gem would fill: a farther gem gets a smaller stage', () => {
        const host = hostCamera();
        const anchor = { position: [0, 0, 0], scale: 0.05 };
        r.syncCamera(host, anchor);
        r.render({});
        const near = r.particleStage();
        anchor.scale = 0.025; // the same host distance is twice as far in gem units
        r.render({});
        const far = r.particleStage();
        expect(near.width).toBe(FOLLOW_SPAWN_STAGE);
        expect(near.height).toBe(FOLLOW_SPAWN_STAGE);
        expect(far.pointHeight).toBeGreaterThan(0);
        // Sprite px = 75/d * (pointHeight/600)^0.6: the farther gem's sprites are smaller.
        const px = (s, d) => (75 / d) * Math.pow(s.pointHeight / 600, 0.6);
        const dNear = r.camera.position.length() / 2;
        const dFar = r.camera.position.length();
        expect(px(far, dFar)).toBeLessThan(px(near, dNear));
    });

    it('syncCamera(null) returns to the self-framed camera', () => {
        r.syncCamera(hostCamera(), { position: [1, 1, 1], scale: 0.1 });
        r.render({});
        r.syncCamera(null);
        expect(r.isFollowing()).toBe(false);
        expect(r.particleStage()).toBeNull();
        expect(r.camera.position.toArray()).toEqual([0, 0, DEFAULT_CAMERA_DISTANCE]);
        expect(r.camera.fov).toBe(45);
        expect(r.camera.near).toBe(0.1);
        expect(r.camera.far).toBe(100);
        expect(r.camera.aspect).toBeCloseTo(800 / 600, 9);
        r.render({});
        expect(r.camera.position.toArray()).toEqual([0, 0, DEFAULT_CAMERA_DISTANCE]);
    });
});

describe('EmotiveMascot3D.syncCamera', () => {
    function mascotWith(renderer) {
        const m = new EmotiveMascot3D({ assetBasePath: '/x/' });
        const ps = { canvasWidth: 300, canvasHeight: 300 };
        m.core3D = {
            renderer,
            particleOrchestrator: { particleSystem: ps },
            animationManager: { hasActiveAnimations: () => false },
            isMorphing: () => false,
        };
        return { m, ps };
    }

    it('keeps the active frame rate and a fixed spawn square while in the scene, and restores both', () => {
        const r = makeRenderer();
        const { m, ps } = mascotWith(r);
        expect(m._isActive()).toBe(false);
        m.syncCamera(hostCamera(), { position: [0, 0, 0], scale: 0.05 });
        expect(m.isInScene()).toBe(true);
        expect(m._isActive()).toBe(true);
        expect([ps.canvasWidth, ps.canvasHeight]).toEqual([FOLLOW_SPAWN_STAGE, FOLLOW_SPAWN_STAGE]);
        m.syncCamera(null);
        expect(m.isInScene()).toBe(false);
        expect(m._isActive()).toBe(false);
        expect([ps.canvasWidth, ps.canvasHeight]).toEqual([300, 300]);
    });

    it('is a no-op without a core (no WebGL 2)', () => {
        const m = new EmotiveMascot3D({ assetBasePath: '/x/' });
        expect(m.syncCamera(hostCamera())).toBe(m);
        expect(m.isInScene()).toBe(false);
    });
});
