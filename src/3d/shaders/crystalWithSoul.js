/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  ╔═○─┐ emotive
 *    ●●  ENGINE - Crystal Shader with Soul Inside
 *  └─○═╝
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * @fileoverview Frosted crystal shader with inner glowing soul effect
 * @author Emotive Engine Team
 * @module 3d/shaders/crystalWithSoul
 *
 * Creates a semi-transparent frosted crystal shell that allows an inner "soul"
 * (glowing core) to show through with diffusion. The soul color is driven by
 * emotional state.
 *
 * Visual characteristics based on reference image:
 * - Frosted/milky translucency (not clear glass)
 * - Strong fresnel effect at edges
 * - Inner glow diffuses through the crystal body
 * - Subtle surface texture variation
 *
 * ## Shader Utilities
 *
 * - **deformation.js**: Localized vertex displacement for impact effects
 *
 * ## Deformation System
 *
 * The deformation module provides localized "dent" effects for punch impacts:
 * - Vertex shader: `calculateDeformation(position)` displaces vertices inward
 * - Fragment shader: `calculateImpactGlow(fragPos, color)` adds bright spot
 *
 * The impactPoint uniform is in MESH-LOCAL space (pre-transformed by
 * Core3DManager for tidal locking). See deformation.js for details.
 */

import {
    deformationUniformsGLSL,
    deformationVertexGLSL,
    deformationFragmentGLSL,
} from './utils/deformation.js';
import { crackUniformsGLSL, crackFragmentGLSL } from './utils/objectSpaceCracks.js';

/**
 * Vertex shader for frosted crystal
 */
export const crystalVertexShader = `
varying vec3 vPosition;
varying vec3 vNormal;
varying vec3 vViewPosition;
varying vec2 vUv;
varying vec3 vObjView;   // object-space vector from the fragment to the camera
varying vec3 vObjNormal;
varying vec3 vNX;        // object -> view basis (normalMatrix columns)
varying vec3 vNY;
varying vec3 vNZ;

${deformationUniformsGLSL}

${deformationVertexGLSL}

void main() {
    vUv = uv;

    // Apply deformation to position (impactPoint pre-transformed by JS for tidal locking)
    vec3 deformedPosition = position + calculateDeformation(position);

    vPosition = deformedPosition;
    vNormal = normalize(normalMatrix * normal);
    vObjNormal = normal;
    vNX = normalMatrix[0];
    vNY = normalMatrix[1];
    vNZ = normalMatrix[2];

    vec4 mvPosition = modelViewMatrix * vec4(deformedPosition, 1.0);
    vViewPosition = -mvPosition.xyz;
    vObjView = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz - deformedPosition;

    gl_Position = projectionMatrix * mvPosition;
}
`;

/**
 * Fragment shader: cut glass with a lit core (hex-agent look model).
 *
 * Per fragment, from outside in:
 *  - REFLECTION: the view ray reflected off the facet samples a procedural studio (two
 *    softboxes, a strip light, a floor/sky gradient), weighted by Schlick fresnel. Flat facets
 *    give each facet one crisp value, so the gem reads as cut, not moulded.
 *  - BRILLIANCE: the refracted ray bounces off the mirrored back facet and samples the same
 *    studio: light coming back out through the stone.
 *  - BODY: Beer-law transmission through a path that is longer face-on and through the middle;
 *    the gem hue (normalised sssAbsorption) is what survives, so thick reads deep, thin pale.
 *  - CORE: the refracted ray's closest approach to the gem's long axis (object space) lights a
 *    volumetric core in uCore (the look's core colour), plus the refracted soul inclusion.
 *  - DETAIL MAP (never a colour): R edge thickness -> bevel catch on facet borders,
 *    G honeycomb -> normal offset for the internal bounce, B noise -> micro normal + path jitter.
 */
export const crystalFragmentShader = `
uniform float time;
uniform vec3 emotionColor;
uniform float glowIntensity;
uniform float opacity;
uniform float uSurface;        // 0 = dark page, 1 = light page (setSurface)
uniform float uGlow;           // host-driven inner glow level (setGlow), 1 = rest
uniform float uRim;            // rim (fresnel) level, 1 = rest
uniform vec3 uRimInk;          // light surface: the dark rim colour that holds on cream

// Look (setLook): environment, body, core
uniform float uEnv;            // reflection + brilliance strength
uniform float uBody;           // body light floor (keeps a deep stone from going black)
uniform float uDepth;          // optical path scale (colour depth)
uniform vec3 uCore;            // core colour
uniform float uCoreMix;        // 0 = core follows the gem hue, 1 = pure uCore
uniform float uClarity;        // 0 = solid stone, 1 = clear glass (page shows through)

uniform float frostiness;
uniform float fresnelPower;
uniform float fresnelIntensity;
uniform float innerGlowStrength;
uniform float specularIntensity;
uniform float minBrightness;

uniform float causticIntensity;
uniform float causticScale;
uniform float causticSpeed;

uniform sampler2D crystalTexture;
uniform float textureStrength;

uniform sampler2D soulTexture;
uniform vec2 soulTextureSize;
uniform vec2 soulScreenCenter;
uniform float refractionIndex;
uniform float refractionStrength;

uniform float sssStrength;
uniform vec3 sssAbsorption;
uniform vec3 sssLightDir;
uniform float emotionColorBleed;

${deformationUniformsGLSL}

${crackUniformsGLSL}

varying vec3 vPosition;
varying vec3 vNormal;
varying vec3 vViewPosition;
varying vec2 vUv;
varying vec3 vObjView;
varying vec3 vObjNormal;
varying vec3 vNX;
varying vec3 vNY;
varying vec3 vNZ;

const vec3 LUM = vec3(0.2126, 0.7152, 0.0722);

// Procedural studio, view space (x right, y up, z toward the viewer).
vec3 studio(vec3 d) {
    float sky = smoothstep(-0.5, 0.9, d.y);
    vec3 c = mix(vec3(0.03, 0.035, 0.05), vec3(0.20, 0.22, 0.27), sky);
    // A light page is a bright room: the studio's ambient lifts toward the cream it sits in.
    c = mix(c, vec3(0.62, 0.61, 0.58) * (0.6 + 0.4 * sky), uSurface * 0.55);
    float key = smoothstep(-0.80, -0.74, d.x) * (1.0 - smoothstep(-0.16, -0.10, d.x))
              * smoothstep(0.28, 0.34, d.y) * (1.0 - smoothstep(0.90, 0.96, d.y));
    float strip = smoothstep(0.52, 0.56, d.x) * (1.0 - smoothstep(0.74, 0.78, d.x))
                * smoothstep(-0.60, -0.40, d.y) * (1.0 - smoothstep(0.70, 0.80, d.y));
    float top = smoothstep(0.90, 0.95, d.y);
    float floorB = 1.0 - smoothstep(-0.90, -0.65, d.y);
    return c + vec3(1.0, 0.985, 0.96) * (key * 2.1 + strip * 1.3 + top * 0.9) + vec3(0.30, 0.32, 0.36) * floorB * 0.5;
}

${deformationFragmentGLSL}

${crackFragmentGLSL}

void main() {
    vec3 N = normalize(vNormal);
    vec3 V = normalize(vViewPosition);
    vec4 det = texture2D(crystalTexture, vUv);
    float ts = textureStrength;

    // Micro normal from the noise channel (B): breaks perfect mirror flats a little.
    vec3 Nm = normalize(N + vec3(det.b - 0.5, 0.5 - det.b, 0.0) * 0.06 * ts);
    float NdV = clamp(abs(dot(Nm, V)), 0.0, 1.0);

    // Gem hue from the preset (normalised absorption), as before; it lerps with setGemColor.
    vec3 hue = sssAbsorption / max(max(max(sssAbsorption.r, sssAbsorption.g), sssAbsorption.b), 0.001);

    // ── reflection ──
    float fresnel = pow(1.0 - NdV, max(fresnelPower, 1.0));
    float F = clamp(0.04 + 0.96 * fresnel * fresnelIntensity, 0.0, 1.0);
    vec3 refl = studio(reflect(-V, Nm));

    // ── interior: refract in (object space), find where the ray leaves a hex-prism stone ──
    vec3 dIn = -normalize(vObjView);
    vec3 nO = normalize(vObjNormal);
    nO = dot(nO, dIn) > 0.0 ? -nO : nO;
    vec3 d = refract(dIn, nO, 1.0 / max(refractionIndex, 1.01));
    vec2 pq = vPosition.xz;
    float qa = max(dot(d.xz, d.xz), 1e-4);
    float qb = dot(pq, d.xz);
    float R = max(length(pq), 0.12);
    float chord = clamp((-qb + sqrt(max(qb * qb - qa * (dot(pq, pq) - R * R), 0.0))) / qa, 0.0, 2.0);
    vec3 ex = vPosition + d * chord;
    // Back facet at the exit: the hexagon's flat (vertex on +X, flats at 30 + k*60 deg), tilted
    // toward the tip it is near; the G honeycomb nudges it so the flats are not perfect mirrors.
    float sector = atan(ex.z, ex.x) / 1.0471976;
    float th = (floor(sector) + 0.5) * 1.0471976;
    float tip = smoothstep(0.30, 0.45, abs(ex.y)) * sign(ex.y);
    vec3 nb = normalize(vec3(cos(th), tip * 1.3, sin(th)) + vec3(det.g - 0.35) * 0.02 * ts);
    vec3 bo = reflect(d, -nb);
    vec3 brill = studio(normalize(bo.x * vNX + bo.y * vNY + bo.z * vNZ)) * (0.8 + 0.4 * det.b);
    // The back edges (between flats) show through as fine lines.
    float backEdge = smoothstep(0.88, 0.97, abs(fract(sector) - 0.5) * 2.0);
    vec3 T = refract(-V, Nm, 1.0 / max(refractionIndex, 1.01));

    // ── body: Beer-law transmission along the chord ──
    float path = uDepth * (0.35 + chord * 1.1) * (0.85 + 0.3 * det.b);
    vec3 trans = exp(-(1.0 - hue) * max(sssStrength, 0.0) * path * 2.4);

    // ── core: closest approach of the refracted ray to the centre (object space) ──
    float tq = clamp(-dot(vPosition, d), 0.0, chord);
    vec3 closest = vPosition + d * tq;
    float r2 = dot(closest.xz, closest.xz) + closest.y * closest.y * 0.3;
    float coreMask = exp(-r2 * 90.0);
    float halo = exp(-r2 * 28.0);
    float pulse = 0.9 + 0.1 * sin(time * 0.8);
    vec3 coreHue = mix(hue, uCore, uCoreMix);
    coreHue = mix(coreHue, emotionColor, emotionColorBleed * 0.35);
    float glow = uGlow * glowIntensity * innerGlowStrength;
    vec3 core = (coreHue * (coreMask * 1.5 + halo * 0.35) + vec3(coreMask * coreMask * 0.3)) * pulse * glow;

    // Soul inclusion, refracted (screen-space sample of the soul pass).
    if (soulTextureSize.x > 0.0 && soulScreenCenter.x >= 0.0) {
        vec2 suv = clamp(gl_FragCoord.xy / soulTextureSize + T.xy * refractionStrength * 0.1, 0.0, 1.0);
        vec4 ss = texture2D(soulTexture, suv);
        float sl = dot(ss.rgb, LUM);
        core += coreHue * sl * ss.a * 0.9 * uGlow * smoothstep(0.0, 0.3, NdV);
    }

    // Caustic drift: slow light pools inside, in the gem hue.
    vec3 cp = vPosition * causticScale + T * 1.5 + vec3(0.3, 0.2, 0.1) * time * causticSpeed;
    float wave = (sin(cp.x * 2.0 + cp.y * 1.5 + cp.z) + sin(cp.y * 2.3 - cp.x * 1.2 + cp.z * 1.8)) * 0.5;
    float caustic = smoothstep(0.35, 0.9, wave) * causticIntensity * 0.18 * NdV;

    // Inside light: brilliance + a floor of body light + caustics, all through the body; core on top.
    // Bright light comes back paler than the body (no HDR pure-blue, which tone mapping turns violet).
    vec3 inside = (brill * uEnv * mix(trans, vec3(1.0), 0.1) + vec3(uBody) + caustic * mix(vec3(1.0), hue, 0.5)) * trans * (1.0 - frostiness * 0.3);
    inside += backEdge * (0.06 + 0.25 * dot(brill, LUM)) * mix(vec3(1.0), hue, 0.6) * uEnv;
    inside += vec3(frostiness * 0.12) * mix(vec3(1.0), hue, 0.5);
    inside += core;

    vec3 finalColor = mix(inside, refl * uEnv * mix(vec3(1.0), hue, 0.12), F);

    // Bevel catch on facet borders: detail R (edge thickness) and the facet-normal derivative.
    vec3 L = normalize(sssLightDir);
    float facetEdge = smoothstep(0.03, 0.12, length(fwidth(N)));
    float bevel = max(smoothstep(0.55, 0.95, det.r) * ts, facetEdge);
    finalColor += bevel * (0.10 + 0.35 * max(dot(N, L), 0.0)) * uEnv * mix(vec3(1.0), hue, 0.3) * uRim;

    // Fire: pinpoint dispersion sparkles on facets that face the key light.
    vec3 H1 = normalize(L + V);
    float fire = pow(max(dot(Nm, H1), 0.0), 220.0) + 0.6 * pow(max(dot(reflect(-normalize(vec3(-0.4, 0.8, 0.5)), Nm), V), 0.0), 140.0);
    finalColor += vec3(1.0, 0.98, 0.95) * min(fire, 1.5) * specularIntensity * 0.9;

    finalColor = max(finalColor, vec3(minBrightness));

    // Alpha: a clear look lets the page through face-on; rims, light and core stay solid.
    float lit = clamp(dot(finalColor, LUM), 0.0, 1.0);
    float finalAlpha = 1.0 - uClarity * 0.55 * NdV * (1.0 - coreMask) * (1.0 - lit * 0.6);
    finalAlpha = clamp(finalAlpha, 0.0, 1.0) * opacity;

    finalColor += calculateImpactGlow(vPosition, emotionColor);
    vec4 crackContrib = calculateObjectSpaceCracks(vPosition, N);
    if (crackContrib.a > 0.001) {
        finalColor = mix(finalColor, crackContrib.rgb, crackContrib.a * 0.8);
        finalAlpha = max(finalAlpha, crackContrib.a * 0.5);
    }

    // Light page: an ink rim at the silhouette (no screen-space bloom), so the stone holds on
    // cream; a little less additive sparkle so it does not read as a hole.
    float inkRim = clamp(smoothstep(0.55, 0.95, fresnel) * 1.1 * uRim, 0.0, 0.9) * uSurface;
    finalColor = mix(finalColor, uRimInk, inkRim);
    finalAlpha = max(finalAlpha, inkRim);
    // Own tone curve (the material opts out of the renderer's ACES): luminance Reinhard keeps
    // the hue, then the brightest light whitens a little, as real highlights do.
    float lumIn = dot(finalColor, LUM);
    finalColor *= (1.0 + lumIn / 6.0) / (1.0 + lumIn);
    float peak = max(max(finalColor.r, finalColor.g), finalColor.b);
    finalColor = mix(finalColor, vec3(peak), smoothstep(0.75, 1.3, peak) * 0.45);
    finalColor = min(finalColor, vec3(1.0));
    gl_FragColor = vec4(finalColor, finalAlpha);
    // Encode here: there is no post pass to tone-map and sRGB-encode (fix c).
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}
`;

/**
 * Get crystal shaders
 * @returns {Object} { vertexShader, fragmentShader }
 */
export function getCrystalShaders() {
    return {
        vertexShader: crystalVertexShader,
        fragmentShader: crystalFragmentShader,
    };
}

/**
 * Default crystal uniform values
 * These create the frosted appearance matching the reference image
 */
export const CRYSTAL_DEFAULT_UNIFORMS = {
    time: 0,
    emotionColor: [0.0, 0.8, 1.0], // Default cyan
    glowIntensity: 1.0,
    opacity: 1.0,
    uGlow: 1.0,
    uRim: 1.0,
    // The look uniforms (uEnv, uBody, uDepth, uCore, uCoreMix, uClarity, uRimInk) start from
    // LOOKS[BASE_LOOK] (presets/looks.js), their one source.

    // Crystal appearance (tuned for the stock crystal; the look round retunes for hexgem)
    frostiness: 0.55, // Frosted translucency (slightly less opaque)
    fresnelPower: 2.8, // Edge brightness falloff (slightly sharper)
    fresnelIntensity: 0.25, // Edge brightness strength (subtle rim, less bloom blowout)
    innerGlowStrength: 0.55, // How much soul shows through (boosted)
    surfaceRoughness: 0.12, // Surface texture variation (subtler)

    // Enhanced lighting
    shadowDarkness: 0.6, // How dark shadows can get (0-1) - strong shadows
    specularIntensity: 0.5, // Edge highlight brightness (reduced to prevent bloom blowout)
    specularPower: 28.0, // Specular falloff sharpness
    transmissionContrast: 1.0, // Thin/thick brightness ratio
    minBrightness: 0.005, // Minimum brightness floor (near-black for gemstones)

    // Noise scales
    surfaceNoiseScale: 1.5, // Scale of surface frost pattern
    noiseFrequency: 1.33, // Frequency of hash noise pattern

    // Internal caustics
    causticIntensity: 0.8, // Brightness of internal caustic hot spots
    causticScale: 2.0, // Scale of caustic pattern
    causticSpeed: 0.12, // Animation speed of caustics

    // Texture
    textureStrength: 0.55, // How much texture affects appearance

    // Soul refraction - optical lensing of inner soul through crystal
    refractionIndex: 1.5, // Index of refraction (1.5 glass, 2.4 diamond)
    refractionStrength: 0.15, // Distortion magnitude — kept low to avoid facet-normal jitter
    resolution: [1920, 1080], // Screen resolution (updated at runtime)
    soulTextureSize: [1920, 1080], // Soul render target size (updated at runtime)
    soulScreenCenter: [0.5, 0.5], // Soul center in screen UV (updated at runtime)

    // Physically-based subsurface scattering (crystal preset as default)
    sssStrength: 0.65, // Overall SSS intensity (boosted)
    sssAbsorption: [2.4, 2.5, 2.8], // Absorption coefficients RGB (crystal - cool blue tint)
    sssScatterDistance: [0.35, 0.4, 0.45], // Mean free path / scatter radius RGB (increased)
    sssThicknessBias: 0.18, // Base thickness value
    sssThicknessScale: 0.6, // Thickness multiplier
    sssCurvatureScale: 1.8, // Curvature influence on SSS
    sssAmbient: 0.3, // Ambient SSS contribution (boosted for visibility)
    sssLightDir: [0.5, 1.0, 0.8], // Primary light direction
    sssLightColor: [1.0, 0.98, 0.95], // Light color (warm white)

    // Emotion color bleed - how much soul color tints gem material
    emotionColorBleed: 0.0, // 0 = gem color only, 1 = full emotion tint
};
