/*
 * "spaCR field phenomena": WebGL port of spaCR's spaceout field
 * (spacr/qt/widgets/ambient.py, _SpaceoutFieldEngine).
 *
 * The ordinary spaCR field (lens, pointer dimple, bursts, click waves; see
 * field.js) at the theme's own 10 % density (25 px lattice), plus two seeded
 * lanes of phenomena. Lane 0 (29 s epochs) alternates attractors and
 * vortices; lane 1 (43 s epochs) picks density pulses, density waves, colour
 * waves or spirals, or rests. Each event starts 4-18 % into its epoch, lasts
 * 40-68 %, eases in, then relaxes or releases elastically, so calm intervals
 * fall between. Regions add a relief that is lit, density events fade dots by
 * a per-dot rank, and colour events walk the dots through every palette
 * colour. The CPU works out the 1-2 active events per frame from the epoch
 * rule and uploads them; the vertex shader does the rest per dot.
 */
(function () {
  "use strict";
  if (!window.spacrFx) return;

  var MAX_IMP = 24, MAX_WAVE = 6, NR = 5, TAU = Math.PI * 2;

  var VERT = [
    "precision highp float;",
    "attribute vec3 a;",
    "uniform float t, radius, psize, bent, relit, hueAmt, npal;",
    "uniform vec2 asp, lens;",
    "uniform vec3 ptr, ink;",
    "uniform vec4 imp[" + MAX_IMP + "];",
    "uniform vec3 wave[" + MAX_WAVE + "];",
    "uniform vec4 ev[2], sp[2], reg[" + 2 * NR + "], rb[" + 2 * NR + "];",
    "uniform vec3 pal[4];",
    "varying float lit;",
    "varying vec3 col;",
    "float edge(vec2 q) { vec2 s = sin(clamp(q, 0.0, 1.0) * 3.14159265); s *= s; return s.x * s.y; }",
    "vec3 relief(vec2 q) {",
    "  vec3 r = vec3(0.0);",
    "  for (int i = 0; i < " + 2 * NR + "; i++) {",
    "    float amp = rb[i].x;",
    "    if (amp == 0.0) continue;",
    "    vec2 d = (q - reg[i].xy) * asp;",
    "    float r2 = reg[i].z * reg[i].z;",
    "    float k = max(0.0, 1.0 - dot(d, d) / r2);",
    "    r += vec3(amp * k * k * k, d * (-6.0 * amp * k * k / r2));",
    "  }",
    "  return r * edge(q);",
    "}",
    "vec3 hueCol(float h) {",
    "  float q = floor(fract(0.11 + h) * 128.0) / 128.0 * npal;",
    "  float i = floor(q), f = q - i, j = mod(i + 1.0, npal);",
    "  vec3 c0 = i < 0.5 ? pal[0] : i < 1.5 ? pal[1] : i < 2.5 ? pal[2] : pal[3];",
    "  vec3 c1 = j < 0.5 ? pal[0] : j < 1.5 ? pal[1] : j < 2.5 ? pal[2] : pal[3];",
    "  return mix(c0, c1, f);",
    "}",
    "void main() {",
    "  vec2 d = (a.xy - lens) * asp;",
    "  float r = sqrt(dot(d, d) + 1e-6);",
    "  float env = exp(-(r / 0.34) * (r / 0.34));",
    "  vec2 p = a.xy + d / asp * (-0.052 * env / sqrt(r * r + 0.013));",
    "  if (bent > 0.5) {",
    "    vec2 u = p * asp, s = vec2(0.0);",
    "    for (int e = 0; e < 2; e++) {",
    "      vec4 E = ev[e];",
    "      if (E.x == 3.0) s += 0.025 * E.y * sin(E.z * 0.45 + E.w) * sin(p * 6.2831853);",
    "      if (E.x == 4.0) {",
    "        float an = E.w + 0.12 * sin(E.z * 0.13);",
    "        vec2 dd = vec2(cos(an), sin(an));",
    "        s += dd * (0.022 * E.y * sin((dot(u, dd) - E.z * 0.025) * 13.0 + E.w));",
    "      }",
    "    }",
    "    for (int i = 0; i < " + 2 * NR + "; i++) {",
    "      vec4 B = rb[i];",
    "      if (B.y == 0.0 && B.z == 0.0) continue;",
    "      vec2 g = u - reg[i].xy * asp;",
    "      float sq = dot(g, g);",
    "      float k = max(0.0, 1.0 - sq / (reg[i].z * reg[i].z));",
    "      k = k * k * k;",
    "      float tw = B.z * k, c = cos(tw) - 1.0, sn = sin(tw);",
    "      s += vec2(g.x * c - g.y * sn, g.x * sn + g.y * c) + g * (B.y * k / sqrt(sq + 0.018));",
    "    }",
    "    float dep = relief(p).x;",
    "    s -= vec2(0.18, 0.65) * dep;",
    "    p += s * min(1.0, 0.14 / max(length(s), 1e-9)) * edge(p) / asp;",
    "  }",
    "  if (ptr.z > 0.0) {",
    "    vec2 m = (p - ptr.xy) * asp;",
    "    float sq = dot(m, m);",
    "    float w = max(0.0, 1.0 - sq / (radius * radius));",
    "    p += m / asp * (-0.055 * w * w * w / sqrt(sq + 0.013) * ptr.z);",
    "  }",
    "  float energy = env * 0.12;",
    "  for (int i = 0; i < " + MAX_IMP + "; i++) {",
    "    vec4 I = imp[i];",
    "    float age = t - I.z;",
    "    if (I.w == 0.0 || age < 0.0 || age >= 5.0) continue;",
    "    vec2 e = (a.xy - I.xy) * asp;",
    "    float dist = sqrt(dot(e, e) + 1e-6);",
    "    if (dist >= radius) continue;",
    "    float q = 1.0 - (dist / radius) * (dist / radius);",
    "    float reach = q * q * q;",
    "    float decay = exp(-age * 0.90) * abs(I.w);",
    "    float burst = -0.12 * decay * exp(-age * 3.0) * reach * exp(-(dist / 0.32) * (dist / 0.32)) / sqrt(dist * dist + 0.02);",
    "    float front = dist - age * 0.26;",
    "    float packet = exp(-(front / 0.075) * (front / 0.075)) * reach;",
    "    float ripple = I.w > 0.0 ? 0.045 * decay * packet * sin(front * 58.0) : 0.0;",
    "    p += e / asp * (burst + ripple / max(dist, 0.055));",
    "    if (I.w > 0.0) energy += decay * packet * 0.40;",
    "  }",
    "  for (int j = 0; j < " + MAX_WAVE + "; j++) {",
    "    vec3 W = wave[j];",
    "    float age = t - W.z;",
    "    if (age < 0.0 || age >= 5.0) continue;",
    "    vec2 e = (a.xy - W.xy) * asp;",
    "    float dist = sqrt(dot(e, e) + 1e-6);",
    "    float front = dist - age * 0.26;",
    "    float packet = exp(-(front / 0.06) * (front / 0.06));",
    "    float decay = exp(-age * 0.65);",
    "    p += e / asp * (0.025 * decay * packet * sin(front * 58.0) / max(dist, 0.055));",
    "    energy += decay * packet * 0.30;",
    "  }",
    "  float L = clamp(0.57 + energy, 0.48, 1.0);",
    "  if (relit > 0.5) {",
    "    vec3 R = relief(p);",
    "    float dif = (0.8 - 0.5 * R.y - 0.65 * R.z) / sqrt(1.0 + dot(R.yz, R.yz));",
    "    L *= clamp(0.45 + dif * 0.6875 + R.x * 1.2, 0.2, 1.5);",
    "  }",
    "  vec2 u = p * asp;",
    "  float h = 0.0;",
    "  for (int e = 0; e < 2; e++) {",
    "    vec4 E = ev[e];",
    "    vec2 dir = vec2(cos(E.w), sin(E.w));",
    "    if (E.x == 3.0 || E.x == 4.0) {",
    "      float tr = E.z * 0.45 + E.w;",
    "      if (E.x == 4.0) {",
    "        tr = dot(u, dir) * 9.0 - E.z * 0.24 + E.w;",
    "        for (int i = 0; i < " + NR + "; i++) {",
    "          vec4 R = e == 0 ? reg[i] : reg[i + " + NR + "];",
    "          float gf = e == 0 ? rb[i].w : rb[i + " + NR + "].w;",
    "          vec2 g = u - R.xy * asp;",
    "          float k = R.z > 0.0 ? max(0.0, 1.0 - dot(g, g) / (R.z * R.z)) : 0.0;",
    "          tr += k * k * gf;",
    "        }",
    "      }",
    "      float fr = 1.0 - abs(E.y) * (0.28 - 0.25 * sin(tr));",
    "      float fd = clamp((fr + 0.12 - a.z) / 0.12, 0.0, 1.0);",
    "      L *= fd * fd * (3.0 - 2.0 * fd);",
    "    }",
    "    if (E.x == 5.0) h += E.y * 0.75 * sin(dot(u, dir) * 9.0 - E.z * 0.35 + E.w);",
    "    if (E.x == 6.0) {",
    "      vec2 g = u - sp[e].xy * asp;",
    "      float ds = length(g);",
    "      float k = max(0.0, 1.0 - ds / (sp[e].z * 3.0));",
    "      h += E.y * 0.75 * k * k * sin(atan(g.y, g.x + 1e-9) * 3.0 + ds * 23.0 - E.z * 0.42 + sp[e].w);",
    "    }",
    "  }",
    "  lit = min(L, 1.0);",
    "  col = hueAmt > 0.0 ? mix(ink, hueCol(h), hueAmt) : ink;",
    "  gl_PointSize = psize;",
    "  gl_Position = vec4(p.x * 2.0 - 1.0, 1.0 - p.y * 2.0, 0.0, 1.0);",
    "}"
  ].join("\n");
  var FRAG = [
    "precision mediump float;",
    "uniform float gain, dark, px;",
    "varying float lit;",
    "varying vec3 col;",
    "void main() {",
    "  vec2 q = (gl_PointCoord - 0.5) * px;",
    "  float m = exp(-dot(q, q) * 0.62);",
    "  if (m < 0.02) discard;",
    "  float L = lit * gain * m;",
    "  gl_FragColor = dark > 0.5 ? vec4(col * L, 1.0) : vec4(1.0 - (1.0 - col) * L, 1.0);",
    "}"
  ].join("\n");

  window.spacrFx.register("field_phenomena", function (env) {
    var gl = env.gl;
    var prog = env.program(VERT, FRAG);
    var u = {};
    ["t", "radius", "psize", "bent", "relit", "hueAmt", "npal", "asp", "lens", "ptr", "ink", "imp", "wave",
      "ev", "sp", "reg", "rb", "pal", "gain", "dark", "px"].forEach(function (n) { u[n] = gl.getUniformLocation(prog, n); });
    var la = gl.getAttribLocation(prog, "a");
    var buf = env.buffer();
    var minmax = env.ext("EXT_blend_minmax");
    var SEED = 20261012;
    var rng = env.rng(SEED);
    var anchor = [rng(), rng()];
    var count = 0, dark = true;
    var SPACING = Math.max(3.5, 8 / Math.sqrt(0.1));
    var RADIUS = 0.15, PERIODS = [29, 43];

    function laneEvent(epoch, lane) {
      var P = PERIODS[lane], r = env.rng((Math.imul(epoch * 3 + lane + 1, 0x9e3779b1) ^ SEED) >>> 0), kind;
      if (lane === 1 && r() < 0.08) return null;
      if (lane === 0) {
        var flip = env.rng((Math.imul(Math.floor(epoch / 2) + 7, 0x85ebca6b) ^ SEED) >>> 0)() < 0.5;
        kind = (epoch % 2 === 0) !== flip ? 1 : 2;
      } else kind = 3 + Math.floor(r() * 4);
      var start = epoch * P + (0.04 + 0.14 * r()) * P, dur = (0.40 + 0.28 * r()) * P;
      var n = 2 + Math.floor(r() * 4), regs = [];
      for (var i = 0; i < n; i++) {
        regs.push([0.12 + 0.76 * r(), 0.12 + 0.76 * r(), 0.16 + 0.17 * r(), (i % 2 ? -1 : 1) * (0.65 + 0.35 * r()), r() * TAU]);
      }
      return { kind: kind, start: start, dur: dur, regs: regs, phase: r() * TAU };
    }
    var cache = {};
    function events(t) {
      var out = [];
      for (var lane = 0; lane < 2; lane++) {
        var ep = Math.floor(t / PERIODS[lane]), key = lane + ":" + ep;
        if (!(key in cache)) cache[key] = laneEvent(ep, lane);
        var e = cache[key];
        if (e && t - e.start > 0 && t - e.start < e.dur) out.push(e);
      }
      return out;
    }
    function strength(e, t) {
      var age = (t - e.start) / e.dur;
      if (!(age > 0 && age < 1)) return 0;
      if (age < 0.3) { var s = Math.sin(age / 0.3 * Math.PI / 2); return s * s; }
      var tail = (age - 0.3) / 0.7, v = 1 - tail * tail * (3 - 2 * tail);
      if (Math.cos(e.phase) < 0) v *= Math.cos(tail * TAU * 1.25) * Math.exp(-tail * tail * 0.65);
      return v;
    }

    var t0 = 0, best = -1;
    for (var tt = 20; tt < 700; tt += 0.5) {
      var es = events(tt), sc = 0, hasRelief = false;
      es.forEach(function (e) {
        var s = Math.abs(strength(e, tt));
        if (e.kind <= 2) hasRelief = true;
        sc += s * [0, 1.0, 1.2, 0.6, 0.6, 1.3, 1.1][e.kind];
      });
      if (hasRelief && sc > best) { best = sc; t0 = tt; }
      if (Object.keys(cache).length > 80) cache = {};
    }
    cache = {};

    var imps = [], waves = [];
    var impData = new Float32Array(MAX_IMP * 4), waveData = new Float32Array(MAX_WAVE * 3);
    var evData = new Float32Array(8), spData = new Float32Array(8);
    var regData = new Float32Array(2 * NR * 4), rbData = new Float32Array(2 * NR * 4);
    var lastImpT = -1e9, lastImpAt = null, seenClick = -1e9;

    function lattice(cssW, cssH) {
      var s = SPACING, xs = [], ys = [], x, y;
      for (x = -s; x < cssW + s; x += s) xs.push(x / cssW);
      for (y = -s; y < cssH + s; y += s) ys.push(y / cssH);
      var data = new Float32Array(xs.length * ys.length * 3), o = 0, id = 0;
      for (var j = 0; j < ys.length; j++) for (var i = 0; i < xs.length; i++) {
        var m = (Math.imul(id++, 0x9e3779b1) + SEED) >>> 0;
        m = (m ^ (m >>> 16)) >>> 0;
        data[o++] = xs[i]; data[o++] = ys[j]; data[o++] = m / 4294967296;
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      count = xs.length * ys.length;
    }
    function tint(c, d) { return d ? c : c.map(function (v) { return v + (1 - v) * 0.3; }); }
    function addImpulse(x, y, t, s, ripple) {
      imps = imps.filter(function (e) { return t - e[2] < 5 && t >= e[2]; });
      imps.push([x, y, t, ripple ? s : -s]);
      if (imps.length > MAX_IMP) imps.shift();
    }
    function input(t, dt, inp) {
      if (dt > 0 && inp.pull > 0.5) {
        var moved = !lastImpAt || Math.hypot(inp.x - lastImpAt[0], inp.y - lastImpAt[1]) > 0.006;
        if (moved && t - lastImpT >= 0.06) { addImpulse(inp.x, inp.y, t, 0.24, true); lastImpT = t; lastImpAt = [inp.x, inp.y]; }
      }
      inp.clicks.forEach(function (c) {
        if (c.t <= seenClick) return;
        seenClick = c.t;
        addImpulse(c.x, c.y, c.t, 1.0, false);
        waves.push([c.x, c.y, c.t]);
        if (waves.length > MAX_WAVE) waves.shift();
      });
      waves = waves.filter(function (w) { return t - w[2] < 5 && t >= w[2]; });
    }
    function phenomena(t) {
      var es = events(t), relit = 0, hue = 0;
      evData.fill(0); spData.fill(0); regData.fill(0); rbData.fill(0);
      es.forEach(function (e, k) {
        var s = strength(e, t), el = t - e.start, kind = e.kind;
        evData.set([kind, s, el, e.phase], k * 4);
        var r0 = e.regs[0];
        spData.set([r0[0], r0[1], r0[2], r0[4]], k * 4);
        if (kind <= 2 || kind === 4 || kind === 6) relit = 1;
        if (kind >= 5) hue = Math.max(hue, Math.abs(s));
        e.regs.forEach(function (R, i) {
          var o = (k * NR + i) * 4, lp = R[4];
          regData.set([R[0] + 0.022 * Math.sin(el * 0.12 + lp), R[1] + 0.022 * Math.cos(el * 0.09 + lp), R[2], R[3]], o);
          var amp = 0.14 * R[3] * s * (kind !== 1 ? Math.sin(el * 0.42 + lp) : 1);
          var pull = -0.026 * R[3] * s * (kind === 4 ? Math.sin(el * (0.38 + R[2]) + lp) : 1);
          rbData.set([kind === 3 || kind === 5 ? 0 : amp, kind === 1 || kind === 4 ? pull : 0,
            kind === 2 ? s * R[3] * 2.4 : 0, kind === 4 ? Math.sin(el * (0.3 + R[2]) + lp) : 0], o);
        });
      });
      gl.uniform4fv(u.ev, evData); gl.uniform4fv(u.sp, spData);
      gl.uniform4fv(u.reg, regData); gl.uniform4fv(u.rb, rbData);
      gl.uniform1f(u.bent, es.length ? 1 : 0);
      gl.uniform1f(u.relit, relit);
      gl.uniform1f(u.hueAmt, Math.min(1, Math.round(hue * 255) / 255));
    }

    return {
      t0: t0,
      resize: function (w, h, dpr) {
        lattice(w / dpr, h / dpr);
        var sh = Math.min(w, h);
        gl.useProgram(prog);
        gl.uniform2f(u.asp, w / sh, h / sh);
        var size = Math.max(3, Math.round(4 * dpr));
        gl.uniform1f(u.psize, size);
        gl.uniform1f(u.px, size / dpr);
        gl.uniform1f(u.radius, RADIUS);
      },
      restyle: function (d) {
        dark = d;
        var cols = env.palette.slice(0, 4).map(function (hx) { return tint(env.rgb(hx), d); });
        var c1 = cols[Math.min(1, cols.length - 1)], pal = new Float32Array(12);
        cols.forEach(function (c, i) { pal.set(c, i * 3); });
        gl.useProgram(prog);
        gl.uniform3fv(u.ink, [0, 1, 2].map(function (k) { return 0.78 * cols[0][k] + 0.22 * c1[k]; }));
        gl.uniform3fv(u.pal, pal);
        gl.uniform1f(u.npal, cols.length);
        gl.uniform1f(u.dark, d ? 1 : 0);
        gl.uniform1f(u.gain, d ? 1.0 : 1.25);
      },
      frame: function (t, dt, inp) {
        input(t, dt, inp);
        var bg = env.bg();
        gl.clearColor(bg[0], bg[1], bg[2], 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.useProgram(prog);
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.enableVertexAttribArray(la);
        gl.vertexAttribPointer(la, 3, gl.FLOAT, false, 0, 0);
        gl.enable(gl.BLEND);
        if (minmax) {
          gl.blendEquation(dark ? minmax.MAX_EXT : minmax.MIN_EXT);
          gl.blendFunc(gl.ONE, gl.ONE);
        } else if (dark) {
          gl.blendEquation(gl.FUNC_ADD); gl.blendFunc(gl.ONE, gl.ONE);
        } else {
          gl.blendEquation(gl.FUNC_ADD); gl.blendFunc(gl.DST_COLOR, gl.ZERO);
        }
        impData.fill(0);
        imps.forEach(function (e, i) { impData.set(e, i * 4); });
        waveData.fill(0);
        for (var k = 0; k < MAX_WAVE; k++) waveData[k * 3 + 2] = -1e6;
        waves.forEach(function (w, i) { waveData.set(w, i * 3); });
        if (Object.keys(cache).length > 16) cache = {};
        phenomena(t);
        gl.uniform1f(u.t, t);
        gl.uniform2f(u.lens, 0.5 + 0.20 * Math.sin(t * 0.10 + anchor[0]), 0.5 + 0.18 * Math.cos(t * 0.083 + anchor[1]));
        gl.uniform3f(u.ptr, inp.x, inp.y, inp.pull);
        gl.uniform4fv(u.imp, impData);
        gl.uniform3fv(u.wave, waveData);
        gl.drawArrays(gl.POINTS, 0, count);
        gl.blendEquation(gl.FUNC_ADD);
      },
      degrade: function () { return false; }
    };
  });
})();
