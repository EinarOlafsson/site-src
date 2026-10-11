/*
 * "spaCR field": WebGL port of spaCR's default ambient theme
 * (spacr/qt/widgets/ambient.py, _DataArtEngine._frame_impulse_lens).
 *
 * A square lattice of round dots, spaced max(3.5, 8 * size / sqrt(density))
 * px; the app ships this theme at 25 % density, so 16 px. A slow
 * gravitational lens wanders round the middle of the screen and pulls the
 * lattice in (Gaussian envelope of 0.34 shorter edges), the pointer makes a
 * local dimple (cubic reach, 0.15 shorter edges), pointer motion leaves
 * small gravity bursts with expanding ripples, and a click sends a strong
 * burst plus a wave. Dots near the lens and on wave fronts brighten. The
 * vertex shader evaluates all of it per dot; the CPU uploads at most 24
 * bursts and 6 waves per frame. An overscroll bounce at the top or bottom of
 * the page sends a wave from that edge up or down through the lattice, shaped
 * like the app's column waves (eased in and out, no hole at the source).
 */
(function () {
  "use strict";
  if (!window.spacrFx) return;

  var MAX_IMP = 24, MAX_WAVE = 6;

  var VERT = [
    "precision highp float;",
    "attribute vec2 a;",
    "uniform float t;",
    "uniform vec2 asp;",
    "uniform vec2 lens;",
    "uniform vec3 ptr;",
    "uniform float radius;",
    "uniform vec4 imp[" + MAX_IMP + "];",
    "uniform vec3 wave[" + MAX_WAVE + "];",
    "uniform vec4 edge[2];",
    "uniform float psize;",
    "varying float lit;",
    "void main() {",
    "  vec2 d = (a - lens) * asp;",
    "  float r = sqrt(dot(d, d) + 1e-6);",
    "  float env = exp(-(r / 0.34) * (r / 0.34));",
    "  vec2 p = a + d / asp * (-0.052 * env / sqrt(r * r + 0.013));",
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
    "    vec2 e = (a - I.xy) * asp;",
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
    "    vec2 e = (a - W.xy) * asp;",
    "    float dist = sqrt(dot(e, e) + 1e-6);",
    "    float front = dist - age * 0.26;",
    "    float packet = exp(-(front / 0.06) * (front / 0.06));",
    "    float decay = exp(-age * 0.65);",
    "    p += e / asp * (0.025 * decay * packet * sin(front * 58.0) / max(dist, 0.055));",
    "    energy += decay * packet * 0.30;",
    "  }",
    "  for (int k = 0; k < 2; k++) {",
    "    vec4 E = edge[k];",
    "    float age = t - E.y;",
    "    if (E.w == 0.0 || age < 0.0 || age >= 5.0) continue;",
    "    float off = (a.y - E.x) * asp.y;",
    "    float dist = abs(off) + 1e-6;",
    "    float ease = smoothstep(0.0, 0.30, age) * (1.0 - smoothstep(2.25, 5.0, age));",
    "    float trav = age * 0.26;",
    "    float gain = E.z * ease / sqrt(1.0 + trav / 0.18);",
    "    float front = dist - trav;",
    "    float env2 = gain * exp(-(front / 0.10) * (front / 0.10)) * smoothstep(0.0, 0.10, dist);",
    "    float ph = front * 44.0;",
    "    p.y += sign(off) * 0.0045 * 1.6 * env2 * sin(ph) / asp.y;",
    "    energy += 0.07 * 1.6 * env2 * cos(ph);",
    "  }",
    "  lit = clamp(0.57 + energy, 0.48, 1.0);",
    "  gl_PointSize = psize;",
    "  gl_Position = vec4(p.x * 2.0 - 1.0, 1.0 - p.y * 2.0, 0.0, 1.0);",
    "}"
  ].join("\n");
  var FRAG = [
    "precision mediump float;",
    "uniform vec3 ink;",
    "uniform float gain;",
    "uniform float dark;",
    "uniform float px;",
    "varying float lit;",
    "void main() {",
    "  vec2 q = (gl_PointCoord - 0.5) * px;",
    "  float m = exp(-dot(q, q) * 0.62);",
    "  if (m < 0.02) discard;",
    "  float L = lit * gain * m;",
    "  gl_FragColor = dark > 0.5 ? vec4(ink * L, 1.0) : vec4(1.0 - (1.0 - ink) * L, 1.0);",
    "}"
  ].join("\n");

  window.spacrFx.register("field", function (env) {
    var gl = env.gl;
    var prog = env.program(VERT, FRAG);
    function U(n) { return gl.getUniformLocation(prog, n); }
    var u = {
      t: U("t"), asp: U("asp"), lens: U("lens"), ptr: U("ptr"), radius: U("radius"), imp: U("imp"),
      wave: U("wave"), edge: U("edge"), psize: U("psize"), ink: U("ink"), gain: U("gain"), dark: U("dark"), px: U("px")
    };
    var la = gl.getAttribLocation(prog, "a");
    var buf = env.buffer();
    var minmax = env.ext("EXT_blend_minmax");
    var rng = env.rng(20261011);
    var anchor = [rng(), rng()];
    var count = 0, W = 1, H = 1, dark = true;
    var SPACING = Math.max(3.5, 8 / Math.sqrt(0.25));
    var RADIUS = 0.15;

    var imps = [], waves = [];
    var impData = new Float32Array(MAX_IMP * 4), waveData = new Float32Array(MAX_WAVE * 3);
    var lastImpT = -1e9, lastImpAt = null, seenClick = -1e9, seenBounce = -1e9, edges = [], edgeData = new Float32Array(8);

    function lattice(cssW, cssH) {
      var s = SPACING, xs = [], ys = [], x, y;
      for (x = -s; x < cssW + s; x += s) xs.push(x / cssW);
      for (y = -s; y < cssH + s; y += s) ys.push(y / cssH);
      var data = new Float32Array(xs.length * ys.length * 2), o = 0;
      for (var j = 0; j < ys.length; j++) for (var i = 0; i < xs.length; i++) { data[o++] = xs[i]; data[o++] = ys[j]; }
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      count = xs.length * ys.length;
    }
    function inkFor(d) {
      var cols = env.palette.slice(0, 2).map(env.rgb);
      if (!d) cols = cols.map(function (c) { return c.map(function (v) { return v + (1 - v) * 0.55; }); });
      return [0, 1, 2].map(function (k) { return 0.78 * cols[0][k] + 0.22 * cols[1][k]; });
    }
    function addImpulse(x, y, t, strength, ripple) {
      imps = imps.filter(function (e) { return t - e[2] < 5 && t >= e[2]; });
      imps.push([x, y, t, ripple ? strength : -strength]);
      if (imps.length > MAX_IMP) imps.shift();
    }
    function input(t, dt, inp) {
      if (dt > 0 && inp.pull > 0.5) {
        var moved = !lastImpAt || Math.hypot(inp.x - lastImpAt[0], inp.y - lastImpAt[1]) > 0.006;
        if (moved && t - lastImpT >= 0.06) {
          addImpulse(inp.x, inp.y, t, 0.24, true);
          lastImpT = t; lastImpAt = [inp.x, inp.y];
        }
      }
      inp.clicks.forEach(function (c) {
        if (c.t <= seenClick) return;
        seenClick = c.t;
        addImpulse(c.x, c.y, c.t, 1.0, false);
        waves.push([c.x, c.y, c.t]);
        if (waves.length > MAX_WAVE) waves.shift();
      });
      (inp.bounces || []).forEach(function (b) {
        if (b.t <= seenBounce) return;
        seenBounce = b.t;
        edges.push([b.edge ? 1 : 0, b.t, b.s, 1]);
        if (edges.length > 2) edges.shift();
      });
      edges = edges.filter(function (w) { return t - w[1] < 5 && t >= w[1]; });
      waves = waves.filter(function (w) { return t - w[2] < 5 && t >= w[2]; });
    }

    return {
      t0: 0,
      resize: function (w, h, dpr) {
        W = w; H = h;
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
        gl.useProgram(prog);
        gl.uniform3fv(u.ink, inkFor(d));
        gl.uniform1f(u.dark, d ? 1 : 0);
        gl.uniform1f(u.gain, 1.0);
      },
      frame: function (t, dt, inp) {
        input(t, dt, inp);
        var bg = env.bg();
        gl.clearColor(bg[0], bg[1], bg[2], 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.useProgram(prog);
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.enableVertexAttribArray(la);
        gl.vertexAttribPointer(la, 2, gl.FLOAT, false, 0, 0);
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
        gl.uniform1f(u.t, t);
        gl.uniform2f(u.lens, 0.5 + 0.20 * Math.sin(t * 0.10 + anchor[0]), 0.5 + 0.18 * Math.cos(t * 0.083 + anchor[1]));
        gl.uniform3f(u.ptr, inp.x, inp.y, inp.pull);
        gl.uniform4fv(u.imp, impData);
        gl.uniform3fv(u.wave, waveData);
        edgeData.fill(0);
        edges.forEach(function (w, i) { edgeData.set(w, i * 4); });
        gl.uniform4fv(u.edge, edgeData);
        gl.drawArrays(gl.POINTS, 0, count);
        gl.blendEquation(gl.FUNC_ADD);
      },
      degrade: function () { return false; }
    };
  });
})();
