"use client";

import React, { useEffect, useRef, useState } from "react";

interface ModeOpts {
  [key: string]: number | undefined;
}
interface LogoPointSet {
  readonly n: number;
  readonly p: Float32Array;
  readonly e: Float32Array;
}
type SeatMap = Uint32Array;
interface LogoBinding {
  readonly points: LogoPointSet;
  readonly seats: SeatMap;
}
type ModeFrame = (size: number, t: number, opts: ModeOpts, logo?: LogoBinding) => OrbFrame;

interface Dot {
  x: number;
  y: number;
  z: number;
  r: number;
  white: number;
  a?: number;
  k?: number;
}

interface Line {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  white: number;
  a?: number;
  w: number;
}

interface OrbFrame {
  dots: Dot[];
  lines: Line[];
}

type Projector = (x: number, y: number, z: number) => [number, number, number];

function lerp(a: number, b: number, f: number): number {
  return a + (b - a) * f;
}

function vnoise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  let fx = x - xi;
  let fy = y - yi;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const a = hashD(xi, yi);
  const b = hashD(xi + 1, yi);
  const c = hashD(xi, yi + 1);
  const d = hashD(xi + 1, yi + 1);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

function hashD(a: number, b: number): number {
  const h = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return h - Math.floor(h);
}

function fibDir(i: number, n: number): [number, number, number] {
  const golden = Math.PI * (3 - Math.sqrt(5));
  const y = 1 - (2 * (i + 0.5)) / n;
  const rad = Math.sqrt(1 - y * y);
  const a = i * golden;
  return [rad * Math.cos(a), y, rad * Math.sin(a)];
}

function makeProj(yaw: number, tilt: number, cx: number, cy: number, scale: number): Projector {
  const st = Math.sin(tilt);
  const ct = Math.cos(tilt);
  const sy = Math.sin(yaw);
  const cyw = Math.cos(yaw);
  return (x, y, z) => {
    const x1 = x * cyw + z * sy;
    const z1 = -x * sy + z * cyw;
    const y1 = y * ct - z1 * st;
    const z2 = y * st + z1 * ct;
    return [cx + x1 * scale, cy - y1 * scale, z2];
  };
}

function paint(
  ctx: CanvasRenderingContext2D,
  dots: Dot[],
  dark: boolean,
  colorScheme: "green" | "grayscale" = "green"
): void {
  for (const d of dots) {
    const alpha = d.a ?? 1;
    const w = Math.min(1, Math.max(0, d.white));

    if (colorScheme === "green") {
      const depth = dark ? 1 - w : 1 - w;
      if (dark) {
        // App green in dark mode: #21E6A5
        const r = Math.round(lerp(25, 60, depth));
        const g = Math.round(lerp(185, 255, depth));
        const b = Math.round(lerp(135, 195, depth));
        const dotAlpha = alpha * (0.35 + 0.65 * depth);
        ctx.fillStyle = `rgba(${r},${g},${b},${dotAlpha})`;
      } else {
        // App green in light mode: #05B875 with emerald depth for clarity
        const r = Math.round(lerp(2, 5, depth));
        const g = Math.round(lerp(120, 184, depth));
        const b = Math.round(lerp(70, 117, depth));
        const dotAlpha = alpha * (0.45 + 0.55 * depth);
        ctx.fillStyle = `rgba(${r},${g},${b},${dotAlpha})`;
      }
    } else {
      const g = Math.round((dark ? 1 - w : w) * 255);
      ctx.fillStyle = `rgba(${g},${g},${g},${alpha})`;
    }

    ctx.beginPath();
    ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function paintLines(
  ctx: CanvasRenderingContext2D,
  lines: Line[],
  dark: boolean,
  colorScheme: "green" | "grayscale" = "green"
): void {
  for (const l of lines) {
    const alpha = l.a ?? 1;
    const w = Math.min(1, Math.max(0, l.white));
    if (colorScheme === "green") {
      const depth = dark ? 1 - w : 1 - w;
      if (dark) {
        const r = Math.round(lerp(25, 60, depth));
        const g = Math.round(lerp(185, 240, depth));
        const b = Math.round(lerp(135, 180, depth));
        ctx.strokeStyle = `rgba(${r},${g},${b},${alpha * (0.35 + 0.5 * depth)})`;
      } else {
        const r = Math.round(lerp(2, 5, depth));
        const g = Math.round(lerp(120, 184, depth));
        const b = Math.round(lerp(70, 117, depth));
        ctx.strokeStyle = `rgba(${r},${g},${b},${alpha * (0.45 + 0.5 * depth)})`;
      }
    } else {
      const g = Math.round((dark ? 1 - w : w) * 255);
      ctx.strokeStyle = `rgba(${g},${g},${g},${alpha})`;
    }
    ctx.lineWidth = l.w;
    ctx.beginPath();
    ctx.moveTo(l.x1, l.y1);
    ctx.lineTo(l.x2, l.y2);
    ctx.stroke();
  }
}

function finalizeFrame(dots: Dot[], lines: Line[], rMin = 0.3): OrbFrame {
  const visible: Dot[] = [];
  for (const d of dots) {
    if ((d.a ?? 1) < 0.02) continue;
    d.r = Math.max(rMin, d.r);
    visible.push(d);
  }
  visible.sort((a, b) => a.z - b.z);
  return { dots: visible, lines: lines.filter((l) => (l.a ?? 1) >= 0.02) };
}

function paintFrame(
  ctx: CanvasRenderingContext2D,
  frame: OrbFrame,
  dark: boolean,
  colorScheme: "green" | "grayscale" = "green"
): void {
  if (frame.lines.length) paintLines(ctx, frame.lines, dark, colorScheme);
  paint(ctx, frame.dots, dark, colorScheme);
}

function radiusScale(size: number, pow: number): number {
  return (size / 300) ** pow;
}

const TURN = Math.PI * 2;

function smoothE(x: number): number {
  return x * x * (3 - 2 * x);
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function empty(): OrbFrame {
  return { dots: [], lines: [] };
}

function inkOf(o: Record<string, number | undefined>, zx: number, edge: number): number {
  const far = o.inkFar ?? 0.6;
  const span = o.inkSpan ?? 0.5;
  const rim = o.inkRim ?? 0.16;
  return far - span * zx - rim * (1 - edge);
}

function expoInOut(x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return x < 0.5 ? 2 ** (20 * x - 10) / 2 : (2 - 2 ** (-20 * x + 10)) / 2;
}

function morphEase(x: number, expo: number): number {
  const smooth = x * x * x * (x * (x * 6 - 15) + 10);
  return smooth + (expoInOut(x) - smooth) * expo;
}

function cruise(x: number, edge: number): number {
  const a = Math.min(0.49, Math.max(0.001, edge));
  const v = 1 / (1 - a);
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  if (x < a) {
    const u = x / a;
    return v * a * (u * u * u - (u * u * u * u) / 2);
  }
  if (x > 1 - a) {
    const u = (1 - x) / a;
    return 1 - v * a * (u * u * u - (u * u * u * u) / 2);
  }
  return v * (a * 0.5 + (x - a));
}

interface Beat {
  m: number;
  turns: number;
  workT: number;
  local: number;
  cycle: number;
}

function beatAt(
  t: number,
  dwell: number,
  morph: number,
  turns: number,
  settle: number,
  expo = 0.3
): Beat {
  const cycle = dwell + morph * 2;
  const local = t % cycle;
  const spinSpan = dwell + morph * settle;
  const spun = turns * cruise(Math.min(1, local / spinSpan), 0.22);

  if (local < dwell) return { m: 0, turns: spun, workT: local, local, cycle };
  const intoMorph = local - dwell;
  if (intoMorph < morph) {
    return { m: morphEase(intoMorph / morph, expo), turns: spun, workT: -1, local, cycle };
  }
  return { m: morphEase(1 - (intoMorph - morph) / morph, expo), turns: spun, workT: -1, local, cycle };
}

function dotAssembly(i: number, m: number, stagger: number): number {
  return smoothE(clamp01(m * (1 + stagger) - hashD(i, 3.1) * stagger));
}

const frameLogoAssemble: ModeFrame = (size, t, o, logo) => {
  if (!logo) return empty();
  const { p, e, n } = logo.points;
  const seats = logo.seats;
  const cx = size / 2;
  const R = (size / 2) * 0.84;
  const rs = radiusScale(size, o.rsPow ?? 0.6);

  const b = beatAt(
    t,
    o.dwell ?? 2.5,
    o.morph ?? 1.2,
    o.turns ?? 1,
    o.settle ?? 0.2,
    o.expo ?? 0.3
  );
  const m = b.m;

  const pt = makeProj(TURN * b.turns, (o.tiltAmp ?? 0.34) * (1 - m), cx, cx, R);

  const stagger = o.stagger ?? 0;
  const arc = o.arc ?? 0;
  const churn = o.churn ?? 0.09;
  const sphereR = o.sphereR ?? 0.92;
  const share = o.haloShare ?? 0.12;

  // Stride points for small sizes so particles are individually distinct with clear negative space
  const stride = size <= 24 ? 4 : size <= 40 ? 3 : size <= 72 ? 2 : 1;
  const targetR = size <= 28 ? Math.max(0.42, 0.55 * (size / 22)) : (o.rMin ?? 0.3);

  const dots: Dot[] = [];
  for (let i = 0; i < n; i += stride) {
    const mi = stagger > 0 ? dotAssembly(i, m, stagger) : m;
    const seat = seats[i];
    const [fx, fy, fz] = fibDir(seat, n);
    const wob = sphereR * (1 + churn * (vnoise(fx * 2 + t * 0.7, fz * 2) - 0.5) * 2);

    let lx = p[i * 3];
    let ly = p[i * 3 + 1];
    let lz = p[i * 3 + 2];

    let halo = 0;
    if (hashD(i, 6.7) < share) {
      halo = m;
      const osc = Math.sin(t * (o.haloRate ?? 0.9) + hashD(i, 8.3) * TURN);
      const out = 1 + (o.haloOut ?? 0.18) * (0.5 + 0.5 * osc) * halo;
      lx *= out;
      ly *= out;
      lz += (o.haloZ ?? 0.8) * osc * halo;
    }

    let x = fx * wob + (lx - fx * wob) * mi;
    let y = fy * wob + (ly - fy * wob) * mi;
    let z3 = fz * wob + (lz - fz * wob) * mi;
    if (arc > 0) {
      const bow = 1 + arc * Math.sin(Math.PI * mi);
      x *= bow;
      y *= bow;
      z3 *= bow;
    }

    const [px, py, z] = pt(x, y, z3);
    const zx = clamp01((z + 1) / 2);
    const travel = Math.sin(Math.PI * mi);
    const calculatedR =
      ((o.rBase ?? 0.55) +
        (o.rDepth ?? 1.5) * zx +
        (o.haloR ?? 0.22) * halo) *
      rs;

    dots.push({
      x: px,
      y: py,
      z,
      r: size <= 28 ? targetR * (0.7 + 0.5 * zx) : calculatedR,
      white: inkOf(o, zx, e[i] * mi + (1 - mi)),
      a: 1 - (o.flightFade ?? 0.25) * travel
    });
  }
  return finalizeFrame(dots, [], targetR * 0.6);
};

const POINTS: LogoPointSet = {
  n: 521,
  p: Float32Array.from([0.004,0.871,0.079,-0.008,0.811,0.223,-0.076,0.777,0.176,-0.051,0.808,0.236,-0.007,0.767,0.157,-0.062,0.74,0.079,-0.134,0.813,0.208,-0.141,0.757,0.157,-0.181,0.733,0.12,0.051,0.792,0.208,-0.192,0.785,0.236,-0.064,0.85,0.136,-0.222,0.741,0.176,-0.24,0.8,0.193,0.06,0.831,0.193,-0.286,0.71,0.091,-0.175,0.825,0.157,-0.273,0.75,0.203,0.136,0.832,0.176,-0.32,0.753,0.111,0.04,0.75,0.111,-0.306,0.8,0.12,0.158,0.777,0.203,0.226,0.744,0.182,-0.143,0.853,0.111,0.078,0.758,0.136,0.089,0.797,0.223,-0.254,0.836,0.079,-0.09,0.814,0.218,0.298,0.734,0.213,0.12,0.745,0.111,0.27,0.78,0.203,0.169,0.73,0.079,0.233,0.815,0.151,0.328,0.791,0.129,-0.212,0.835,0.111,0.211,0.783,0.232,0.261,0.714,0.129,0.326,0.706,0.182,0.301,0.677,0.091,0.385,0.765,0.12,0.188,0.818,0.164,0.167,0.855,0.079,0.372,0.665,0.151,0.413,0.716,0.182,0.375,0.706,0.223,0.283,0.823,0.079,0.345,0.754,0.198,0.46,0.678,0.203,0.095,0.848,0.129,0.413,0.615,0.079,0.49,0.642,0.223,0.506,0.695,0.111,0.452,0.724,0.12,0.556,0.649,0.129,0.533,0.615,0.218,0.6,0.595,0.151,0.414,0.675,0.203,0.562,0.582,0.223,0.491,0.572,0.12,0.457,0.597,0.12,0.543,0.547,0.157,0.555,0.511,0.12,0.045,0.866,0.079,0.64,0.579,0.091,0.602,0.528,0.223,0.642,0.527,0.198,0.447,0.638,0.182,0.6,0.46,0.129,0.671,0.463,0.218,0.676,0.508,0.151,0.633,0.485,0.218,0.613,0.416,0.079,0.652,0.405,0.151,0.723,0.487,0.091,0.716,0.448,0.151,0.684,0.427,0.223,0.644,0.366,0,0.679,0.343,0.144,0.717,0.381,0.218,0.761,0.338,0.193,0.691,0.27,0.079,0.773,0.394,0.079,0.745,0.422,0.129,0.799,0.35,0.079,0.674,0.55,0.091,0.792,0.293,0.164,0.726,0.313,0.213,0.808,0.221,0.187,0.758,0.253,0.223,0.739,0.192,0.157,0.712,0.235,0.111,0.836,0.25,0.079,0.773,0.173,0.208,0.827,0.164,0.157,0.774,0.13,0.193,0.731,0.141,0.091,0.752,0.086,0.12,0.849,0.2,0,0.859,0.134,0.079,0.799,0.065,0.223,0.814,0.126,0.208,0.832,0.09,0.187,0.776,0.024,0.176,0.83,0.028,0.198,0.74,0.037,0.079,0.873,0.061,0,0.871,-0.004,0.111,0.751,-0.006,0.111,0.826,-0.016,0.208,0.815,-0.07,0.223,0.789,-0.025,0.208,0.752,-0.052,0.111,0.854,-0.044,0.136,0.788,-0.108,0.223,0.814,-0.15,0.208,0.84,-0.103,0.176,0.755,-0.129,0.157,0.795,-0.193,0.218,0.743,-0.174,0.136,0.809,-0.25,0.157,0.856,-0.144,0.079,0.749,-0.222,0.182,0.843,-0.215,0.079,0.718,-0.248,0.129,0.735,-0.286,0.203,0.786,-0.287,0.176,0.775,-0.343,0.17,0.722,-0.322,0.193,0.713,-0.208,0,0.719,-0.362,0.223,0.825,-0.289,0,0.67,-0.34,0.091,0.696,-0.283,0.091,0.681,-0.411,0.203,0.641,-0.376,0,0.748,-0.387,0.17,0.748,-0.437,0.111,0.627,-0.445,0.144,0.787,-0.382,0.079,0.707,-0.459,0.176,0.594,-0.475,0.129,0.675,-0.491,0.198,0.636,-0.496,0.223,0.699,-0.525,0.091,0.608,-0.543,0.232,0.663,-0.551,0.12,0.565,-0.54,0.176,0.579,-0.59,0.203,0.628,-0.581,0.157,0.513,-0.553,0.12,0.723,-0.496,0.079,0.563,-0.628,0.182,0.56,-0.501,0.091,0.525,-0.591,0.198,0.478,-0.631,0.193,0.517,-0.629,0.232,0.469,-0.581,0,0.428,-0.626,0.111,0.538,-0.662,0.151,0.608,-0.634,0.079,0.47,-0.672,0.223,0.413,-0.696,0.223,0.45,-0.734,0.129,0.426,-0.763,0.091,0.494,-0.71,0.129,0.373,-0.698,0.193,0.405,-0.657,0.144,0.3,-0.704,0.12,0.258,-0.725,0.144,0.381,-0.74,0.198,0.208,-0.744,0.136,0.323,-0.755,0.223,0.335,-0.669,0.079,0.284,-0.775,0.223,0.34,-0.794,0.129,0.302,-0.81,0.111,0.387,-0.783,0.111,0.237,-0.773,0.223,0.253,-0.846,0.079,0.159,-0.753,0.129,0.209,-0.851,0.079,0.207,-0.799,0.223,0.12,-0.754,0.111,0.171,-0.815,0.208,0.263,-0.809,0.157,0.111,-0.843,0.091,0.164,-0.854,0.111,0.133,-0.807,0.203,0.087,-0.793,0.079,-0.684,0.527,0.091,-0.675,0.486,0.198,-0.638,0.52,0.091,-0.617,0.467,0.136,-0.707,0.454,0.182,-0.664,0.417,0.182,-0.761,0.43,0.091,-0.694,0.381,0.198,-0.752,0.349,0.203,-0.657,0.355,0,-0.712,0.308,0.157,-0.776,0.272,0.227,-0.717,0.244,0.111,-0.622,0.421,0.091,-0.738,0.476,0.079,-0.754,0.217,0.176,-0.797,0.313,0.151,-0.791,0.368,0.091,-0.832,0.282,0.079,-0.758,0.308,0.232,-0.749,0.391,0.176,-0.803,0.239,0.187,-0.841,0.243,0.079,-0.836,0.191,0.151,-0.721,0.197,0,-0.79,0.19,0.232,-0.748,0.155,0.136,-0.816,0.157,0.193,-0.791,0.117,0.208,-0.861,0.14,0.111,-0.739,0.116,0.079,-0.841,0.099,0.17,-0.752,0.077,0.079,-0.837,0.046,0.193,-0.8,0.077,0.208,-0.853,-0.001,0.176,-0.804,0.026,0.223,-0.755,0.019,0.111,-0.753,-0.051,0.079,-0.815,-0.052,0.236,-0.859,-0.057,0.136,-0.875,0.047,0.079,-0.782,-0.017,0.176,-0.787,-0.101,0.198,-0.757,-0.158,0.151,-0.84,-0.109,0.176,-0.855,-0.164,0.12,-0.806,-0.219,0.208,-0.757,-0.198,0.17,-0.732,-0.261,0.164,-0.771,-0.27,0.232,-0.749,-0.114,0.111,-0.809,-0.174,0.208,-0.877,-0.099,0.079,-0.848,-0.202,0.091,-0.737,-0.32,0.208,-0.804,-0.342,0.111,-0.806,-0.136,0.236,-0.84,-0.241,0.079,-0.745,-0.364,0.218,-0.814,-0.304,0.12,-0.719,-0.222,0.079,-0.701,-0.295,0.111,-0.7,-0.37,0.193,-0.775,-0.402,0.111,-0.74,-0.428,0.157,-0.717,-0.46,0.17,-0.685,-0.331,0.111,-0.647,-0.416,0.129,-0.704,-0.413,0.232,-0.678,-0.451,0.232,-0.614,-0.459,0.129,-0.72,-0.511,0.091,-0.604,-0.518,0.182,-0.664,-0.504,0.203,-0.681,-0.559,0.091,-0.563,-0.529,0.129,-0.541,-0.578,0.176,-0.574,-0.491,0.091,-0.603,-0.576,0.203,-0.505,-0.561,0.091,-0.639,-0.545,0.198,-0.574,-0.637,0.151,-0.656,-0.591,0.079,-0.527,-0.69,0.151,-0.487,-0.712,0.151,-0.499,-0.63,0.203,-0.472,-0.595,0.079,-0.614,-0.639,0,-0.456,-0.664,0.203,-0.397,-0.68,0.176,-0.439,-0.741,0.151,-0.434,-0.633,0.129,-0.392,-0.781,0.111,-0.539,-0.622,0.223,-0.436,-0.7,0.218,-0.345,-0.709,0.176,-0.344,-0.668,0,-0.391,-0.739,0.198,-0.345,-0.794,0.111,-0.321,-0.74,0.193,-0.291,-0.705,0,-0.28,-0.75,0.079,-0.299,-0.787,0.079,-0.105,0.496,0.079,-0.048,0.469,0.176,-0.038,0.399,0.157,0.015,0.436,0.236,-0.091,0.439,0.223,-0.15,0.467,0.129,-0.011,0.485,0.136,-0.087,0.397,0.176,-0.125,0.395,0.198,0.057,0.453,0.208,-0.06,0.366,0.079,0.063,0.393,0.157,0.028,0.485,0.136,0.103,0.427,0.236,0.025,0.38,0.111,0.128,0.364,0.129,0.095,0.487,0.111,-0.198,0.411,0.203,-0.166,0.383,0.193,-0.195,0.456,0.12,0.126,0.461,0.157,0.147,0.422,0.223,0.169,0.358,0.151,-0.186,0.344,0.129,0.177,0.447,0.151,-0.159,0.426,0.208,-0.243,0.356,0.218,0.21,0.394,0.223,0.241,0.363,0.223,-0.307,0.334,0.218,-0.257,0.407,0.157,-0.356,0.337,0.129,-0.302,0.38,0.129,-0.266,0.318,0.182,0.274,0.308,0.182,0.21,0.319,0.12,0.221,0.438,0.12,-0.342,0.27,0.223,0.292,0.402,0.12,-0.378,0.296,0.17,-0.257,0.277,0.079,0.297,0.343,0.203,-0.308,0.244,0.12,-0.375,0.24,0.232,0.336,0.328,0.176,0.353,0.283,0.213,-0.299,0.29,0.182,-0.22,0.309,0.091,-0.428,0.264,0.091,0.302,0.278,0.198,-0.335,0.201,0.12,0.336,0.371,0.079,0.309,0.216,0.111,0.249,0.402,0.176,0.34,0.242,0.193,0.264,0.26,0.079,0.404,0.243,0.17,-0.408,0.206,0.223,0.384,0.32,0.091,-0.465,0.179,0.111,0.342,0.177,0.129,-0.373,0.145,0.144,0.233,0.288,0.079,0.369,0.217,0.218,-0.41,0.132,0.203,0.457,0.211,0.091,-0.382,0.097,0.12,0.347,0.138,0,0.404,0.163,0.236,0.391,0.109,0.176,-0.441,0.071,0.236,-0.451,0.141,0.187,-0.449,0.228,0.12,0.471,0.164,0.111,-0.496,0.134,0,-0.458,0.003,0.223,0.39,0.062,0.151,0.437,0.138,0.203,0.479,0.119,0.12,0.43,0.047,0.223,-0.424,0.035,0.193,-0.501,0.043,0.111,-0.478,0.081,0.164,-0.377,0.04,0,0.412,0.203,0.198,0.382,0.014,0.111,-0.504,-0.029,0.12,-0.441,-0.054,0.223,0.464,0.083,0.176,-0.48,-0.1,0.157,-0.455,-0.157,0.187,0.464,0.019,0.203,-0.411,-0.112,0.198,-0.423,-0.019,0.193,0.472,-0.044,0.176,-0.417,-0.162,0.227,-0.385,-0.002,0.079,-0.399,-0.057,0.136,-0.372,-0.149,0.129,0.392,-0.035,0.136,0.5,0.057,0.079,-0.371,-0.202,0.193,0.438,-0.023,0.236,0.462,-0.084,0.187,0.425,-0.071,0.213,0.503,0.002,0.111,-0.42,-0.232,0.176,-0.457,-0.197,0.129,-0.332,-0.212,0.111,-0.349,-0.264,0.218,-0.319,-0.331,0.218,-0.404,-0.279,0.151,-0.311,-0.255,0.151,-0.5,-0.132,0.079,0.398,-0.105,0.176,0.465,-0.122,0.17,-0.382,-0.331,0.12,-0.282,-0.285,0.12,0.388,-0.152,0.193,-0.356,-0.361,0.091,0.447,-0.157,0.187,-0.298,-0.377,0.182,0.344,-0.213,0.151,-0.334,-0.394,0.079,0.412,-0.185,0.218,0.352,-0.167,0.111,0.375,-0.07,0.091,0.357,-0.113,0.079,0.308,-0.27,0.17,0.379,-0.251,0.218,0.471,-0.194,0.079,0.416,-0.232,0.176,0.436,-0.268,0.079,-0.446,-0.264,0.079,-0.283,-0.435,0.079,-0.229,-0.449,0.129,0.258,-0.292,0.091,-0.244,-0.382,0.236,0.374,-0.291,0.182,-0.257,-0.331,0.176,0.454,-0.234,0.079,-0.205,-0.375,0.193,-0.191,-0.334,0.079,-0.152,-0.357,0.079,0.263,-0.346,0.218,-0.194,-0.423,0.218,-0.131,-0.412,0.213,-0.176,-0.459,0.151,0.211,-0.39,0.232,0.304,-0.312,0.218,0.304,-0.364,0.176,0.197,-0.342,0.129,0.367,-0.333,0.12,0.26,-0.396,0.182,0.221,-0.312,0.079,-0.125,-0.492,0.111,0.157,-0.398,0.203,-0.091,-0.402,0.157,0.314,-0.405,0.079,-0.048,-0.414,0.176,0.225,-0.453,0.091,0.105,-0.366,0.079,0.279,-0.43,0.079,0.151,-0.351,0.079,-0.076,-0.497,0.111,0.178,-0.44,0.198,0.347,-0.369,0.091,-0.101,-0.451,0.218,0.127,-0.444,0.213,0.1,-0.408,0.182,0.134,-0.494,0.079,-0.027,-0.447,0.236,0.098,-0.477,0.164,-0.02,-0.491,0.157,0.066,-0.447,0.236,0.06,-0.513,0,0.045,-0.385,0.079,0.019,-0.42,0.193,0.021,-0.478,0.193,0.179,-0.48,0.091,-0.013,-0.39,0.111,-0.137,0.355,0.079,-0.371,0.184,0.17,-0.059,0.137,0.079,-0.065,0.077,0.203,-0.018,0.069,0.253,-0.024,0.014,0.311,-0.033,0.104,0.193,-0.118,0.09,0.091,0.003,0.122,0.151,-0.125,0.031,0.157,0.033,0.047,0.269,0.04,0.094,0.193,0.05,0.004,0.284,-0.065,0.013,0.269,-0.074,-0.046,0.249,-0.012,-0.03,0.311,-0.138,-0.019,0.136,0.078,-0.044,0.223,-0.025,-0.072,0.265,-0.096,-0.009,0.236,-0.121,-0.056,0.157,0.051,0.132,0.079,-0.069,-0.097,0.182,0.01,-0.094,0.236,0.04,-0.068,0.24,0.079,0.065,0.198,0.103,-0.002,0.208,0.052,-0.108,0.17,0.008,-0.136,0.157,0.1,0.103,0.079,0.121,0.067,0.091,-0.126,-0.096,0.079,0.045,-0.146,0.079,-0.04,-0.129,0.164,0.133,-0.063,0.079,0.149,-0.022,0.079,0.098,-0.092,0.12,-0.078,-0.14,0,0.133,0.024,0.12,0.026,-0.026,0.308,0.426,0.09,0.236,-0.512,-0.066,0.079,0.504,-0.066,0,-0.371,-0.098,0,-0.168,-0.395,0.203,-0.574,-0.676,0.079]),
  e: Float32Array.from([0.054,0.429,0.268,0.482,0.214,0.054,0.375,0.214,0.125,0.375,0.482,0.161,0.268,0.321,0.321,0.071,0.214,0.357,0.268,0.107,0.107,0.125,0.357,0.286,0.107,0.161,0.429,0.054,0.411,0.393,0.107,0.357,0.054,0.196,0.143,0.107,0.464,0.143,0.286,0.071,0.125,0.232,0.054,0.196,0.286,0.429,0.054,0.339,0.357,0.143,0.054,0.429,0.107,0.125,0.143,0.411,0.196,0.357,0.429,0.125,0.125,0.214,0.125,0.054,0.071,0.429,0.339,0.286,0.143,0.411,0.196,0.411,0.054,0.196,0.071,0.196,0.429,0,0.179,0.411,0.321,0.054,0.054,0.143,0.054,0.071,0.232,0.393,0.304,0.429,0.214,0.107,0.054,0.375,0.214,0.321,0.071,0.125,0,0.054,0.429,0.375,0.304,0.268,0.339,0.054,0,0.107,0.107,0.375,0.429,0.375,0.107,0.161,0.429,0.375,0.268,0.214,0.411,0.161,0.214,0.054,0.286,0.054,0.143,0.357,0.268,0.25,0.321,0,0.429,0,0.071,0.071,0.357,0,0.25,0.107,0.179,0.054,0.268,0.143,0.339,0.429,0.071,0.464,0.125,0.268,0.357,0.214,0.125,0.054,0.286,0.071,0.339,0.321,0.464,0,0.107,0.196,0.054,0.429,0.429,0.143,0.071,0.143,0.321,0.179,0.125,0.179,0.339,0.161,0.429,0.054,0.429,0.143,0.107,0.107,0.429,0.054,0.143,0.054,0.429,0.107,0.375,0.214,0.071,0.107,0.357,0.054,0.071,0.339,0.071,0.161,0.286,0.286,0.071,0.339,0.357,0,0.214,0.446,0.107,0.071,0.054,0.268,0.196,0.071,0.054,0.464,0.268,0.304,0.054,0.196,0,0.464,0.161,0.321,0.375,0.107,0.054,0.25,0.054,0.321,0.375,0.268,0.429,0.107,0.054,0.482,0.161,0.054,0.268,0.339,0.196,0.268,0.125,0.375,0.25,0.232,0.464,0.107,0.375,0.054,0.071,0.375,0.107,0.482,0.054,0.411,0.125,0.054,0.107,0.321,0.107,0.214,0.25,0.107,0.143,0.464,0.464,0.143,0.071,0.286,0.357,0.071,0.143,0.268,0.071,0.357,0.071,0.339,0.196,0.054,0.196,0.196,0.357,0.054,0,0.357,0.268,0.196,0.143,0.107,0.429,0.411,0.268,0,0.339,0.107,0.321,0,0.054,0.054,0.054,0.268,0.214,0.482,0.429,0.143,0.161,0.268,0.339,0.375,0.054,0.214,0.161,0.482,0.107,0.143,0.107,0.357,0.321,0.125,0.214,0.429,0.196,0.143,0.196,0.375,0.411,0.429,0.429,0.411,0.214,0.143,0.143,0.286,0.286,0.125,0.125,0.429,0.125,0.25,0.054,0.357,0.125,0.464,0.268,0.393,0.286,0.071,0.071,0.339,0.125,0.054,0.107,0.268,0.321,0.054,0.25,0.429,0.071,0.107,0.143,0.179,0.054,0.411,0.357,0.071,0.125,0,0.482,0.268,0.482,0.304,0.125,0.107,0,0.429,0.196,0.357,0.125,0.429,0.321,0.107,0.232,0,0.339,0.107,0.125,0.429,0.268,0.214,0.304,0.357,0.339,0.321,0.268,0.446,0.054,0.161,0.143,0.161,0.054,0.321,0.482,0.304,0.393,0.107,0.268,0.143,0.107,0.411,0.411,0.196,0.196,0.054,0.268,0.25,0.125,0.125,0.321,0.071,0.304,0.286,0.196,0.054,0.411,0.107,0.071,0.054,0.25,0.411,0.054,0.268,0.054,0.054,0.054,0.143,0.071,0.482,0.286,0.268,0.054,0.321,0.054,0.054,0.411,0.411,0.393,0.196,0.464,0.411,0.268,0.143,0.125,0.286,0.054,0.107,0.357,0.214,0.054,0.268,0.071,0.054,0.054,0.054,0.107,0.339,0.071,0.411,0.393,0.286,0.054,0.482,0.232,0.214,0.482,0,0.054,0.321,0.321,0.071,0.107,0.054,0.25,0.054,0.357,0.554,0.839,0.321,0.071,0.196,0.214,0.625,0.321,0.696,0.625,0.536,0.839,0.161,0.429,0.607,0.482,0.214,0.054,0.286,0.482,0.5,0.339,0.375,0.25,0.214,0.054,0.071,0.054,0.054,0.232,0.054,0.054,0.125,0,0.125,0.821,0.482,0.054,0,0,0.357,0.054])
};

const OPTS: ModeOpts = {
  dwell: 2,
  turns: 1,
  morph: 1.0,
  expo: 0.3,
  settle: 0.15,
  tiltAmp: 0.34,
  stagger: 0,
  arc: 0,
  churn: 0.09,
  sphereR: 0.92,
  flightFade: 0.25,
  haloShare: 0.12,
  haloOut: 0.18,
  haloZ: 0.8,
  haloRate: 0.9,
  haloR: 0.22,
  rBase: 0.55,
  rDepth: 1.5,
  inkFar: 0.6,
  inkSpan: 0.5,
  inkRim: 0.16,
  rsPow: 0.6,
  rMin: 0.3
};

function seatMap(points: LogoPointSet): SeatMap {
  const n = points.n;
  const byLogo = new Uint32Array(n);
  const bySeat = new Uint32Array(n);
  const logoAng = new Float32Array(n);
  const seatAng = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    byLogo[i] = i;
    bySeat[i] = i;
    logoAng[i] = Math.atan2(points.p[i * 3 + 1], points.p[i * 3]);
    const [sx, sy] = fibDir(i, n);
    seatAng[i] = Math.atan2(sy, sx);
  }
  byLogo.sort((a, b) => logoAng[a] - logoAng[b]);
  bySeat.sort((a, b) => seatAng[a] - seatAng[b]);
  const seats = new Uint32Array(n);
  for (let k = 0; k < n; k++) seats[byLogo[k]] = bySeat[k];
  return seats;
}

const BINDING: LogoBinding = { points: POINTS, seats: seatMap(POINTS) };

function useDark(): boolean {
  const [dark, setDark] = useState(true);

  useEffect(() => {
    const resolve = () => {
      const isLight = document.documentElement.dataset.theme === "light";
      setDark(!isLight);
    };

    resolve();

    const mo = new MutationObserver(resolve);
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "class"],
    });

    return () => {
      mo.disconnect();
    };
  }, []);

  return dark;
}

export interface ThinkingLogoProps {
  size?: number;
  colorScheme?: "green" | "grayscale";
  className?: string;
  style?: React.CSSProperties;
}

export function ThinkingLogo({
  size = 20,
  colorScheme = "green",
  className = "",
  style,
}: ThinkingLogoProps) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const dark = useDark();

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = Math.min(2, (typeof window !== "undefined" && window.devicePixelRatio) || 1);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const render = (t: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);
      const frame = frameLogoAssemble(size, t, OPTS, BINDING);
      paintFrame(ctx, frame, dark, colorScheme);
    };

    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      render(4.2);
      return;
    }

    let raf = 0;
    let running = true;

    const loop = () => {
      render(performance.now() / 1000);
      if (running) {
        raf = requestAnimationFrame(loop);
      }
    };

    raf = requestAnimationFrame(loop);

    const onVis = () => {
      if (document.visibilityState === "hidden") {
        running = false;
        cancelAnimationFrame(raf);
      } else if (!running) {
        running = true;
        raf = requestAnimationFrame(loop);
      }
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [size, dark, colorScheme]);

  return (
    <canvas
      ref={ref}
      role="img"
      aria-label="AI Thinking Animation"
      className={className}
      style={{
        width: `${size}px`,
        height: `${size}px`,
        display: "inline-block",
        verticalAlign: "middle",
        flexShrink: 0,
        ...style,
      }}
    />
  );
}

export const logolight = ThinkingLogo;
