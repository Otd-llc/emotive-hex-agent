# emotive-hex-agent

An extreme-lean build of the [Emotive Engine](https://github.com/joshtol/emotive-engine) made for
one job: the agent in the Hex Cluster configurator. A small gem crystal that floats over the build,
windowless, and shows what the build agent is doing: listening, thinking, placing parts, being
refused, finishing.

**Status:** working build. One sapphire cut-glass crystal that lives in the configurator's 3D
scene: it flies to each part, shows the part's ghost and places it, changes its core colour with
its emotion, splits on a refusal (shock and a slow ruby shift) and becomes a star on a finished
build. 121 KB gzip, 276 unit tests, browser gates (GL, states, flash safety, teardown) that each
fail on a planted fault.

## What it keeps and what it drops

Kept: the 3D crystal path, the crystal shader and its inner light, the gem colour presets, the
particles (restyled), the electric element for two moments only (`shock` on a refusal,
`electricflourish` on a finished build), a short list of everyday motions, and morphing between
purpose-made Blender geometries.

Dropped: the 2D engine, music, rhythm, BPM, dance and groove systems, every other element, the
moon/sun/eclipse geometry, orbit controls, the profiler, shatter and cracks, screen-space bloom,
motion blur, ambient occlusion, the HDRI path, and every stock asset. The engine loads only
the Blender-made agent assets (seven crystal shapes, the soul inclusion, five electric meshes,
one detail map); a copy lives under `test/fixtures/agent/`, hashed against its `sha256.json`
(the source of truth is the host app's `public/agent/`).

The engine exposes primitives (emotion, undertone, gesture, gem colour, morph, particles); the
host app owns the agent's state table, timing and copy.

## Where it came from

Derived from the Emotive Engine, Copyright (c) 2025-2026 Joshua Tollette, MIT. Source taken at
engine commit `56e0bcaf` (branch `fix/site-audit-2026-10-22`, dated 2026-10-23, before the event)
and imported without history on 2026-11-02 as this repository's first commit, `5c14213`.
Everything after that commit is new work by One Thousand Drones LLC, built during the Meta Global
AI Dev Hackathon (2026-10-27 to 2026-11-04). See `NOTICE`.

## License

MIT. See `LICENSE.md` and `NOTICE`.
