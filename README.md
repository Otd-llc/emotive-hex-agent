# emotive-hex-agent

An extreme-lean build of the [Emotive Engine](https://github.com/joshtol/emotive-engine) made for
one job: the agent in the Hex Cluster configurator. A small gem crystal that floats over the build,
windowless, and shows what the build agent is doing: listening, thinking, placing parts, being
refused, finishing.

**Status: work in progress (phase P1).** Not yet usable.

## What it keeps and what it drops

Kept: the 3D crystal path, the crystal shader and its inner light, the gem colour presets, the
particles (restyled), the electric element for two moments only (`shock` on a refusal,
`electricflourish` on a finished build), a short list of everyday motions, and morphing between
purpose-made Blender geometries.

Dropped: the 2D engine, music, rhythm, BPM, dance and groove systems, every other element, the
moon/sun/eclipse geometry, orbit controls, the profiler, shatter and cracks, screen-space bloom,
motion blur, ambient occlusion, the HDRI path, and every stock asset. The stock crystal and
electric meshes under `test/fixtures/stock/` are test fixtures only, removed once the new
Blender-made assets land.

The engine exposes primitives (emotion, undertone, gesture, gem colour, morph, particles); the
host app owns the agent's state table, timing and copy.

## Where it came from

Derived from the Emotive Engine, Copyright (c) 2025-2026 Joshua Tollette, MIT. Source taken at
engine commit `56e0bcaf` (branch `fix/site-audit-2026-10-22`) on 2026-11-02 and imported without
history. Everything after the first commit is new work by One Thousand Drones LLC, built during
the Meta Global AI Dev Hackathon (November 2026). See `NOTICE`.

## License

MIT. See `LICENSE.md` and `NOTICE`.
