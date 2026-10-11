/*
 * "spaCR waves": WebGL port of spaCR's point-atlas ambient theme
 * (spacr/qt/widgets/ambient.py, _DataArtEngine._frame_point_atlas).
 *
 * A jittered grid of round grains over (-0.33..1.33) x (-0.43..1.43) of the
 * screen, spaced as in the app (4.6 * size / sqrt(3) buffer px, thinned by
 * sqrt(density / 3) at the default density 0.1). Three warped travelling
 * sines lift each grain into a crest and shear it sideways along the slope;
 * the slope's normal against a fixed light gives its brightness
 * (clip(0.30 + 0.62 n, 0.20, 0.95)). The pointer pushes grains outward
 * (+0.055 w / sqrt(d^2 + 0.013), cubic reach 0.15 of the shorter edge).
 * Grains snap to buffer pixels and stamp a 3x3 kernel (1, 0.68, 0.24) in one
 * ink, 0.78 palette[0] + 0.22 palette[1], combined by max on dark pages and
 * by min (multiply ink) on light ones. The vertex shader does all of it.
 */
(function () {
  "use strict";
  if (!window.spacrFx) return;

  var VERT = [
    "precision highp float;",
    "attribute vec2 a;",
    "uniform float t;",
    "uniform float seed;",
    "uniform vec2 buf;",
    "uniform vec2 asp;",
    "uniform vec3 ptr;",
    "uniform float radius;",
    "uniform float psize;",
    "varying float lit;",
    "void main() {",
    "  float xx = a.x; float zz = a.y;",
    "  float ba = 9.0 * xx + 6.1 * zz;",
    "  float bb = 12.3 * zz - 4.2 * xx;",
    "  float bc = 18.0 * xx + 8.0 * zz + seed;",
    "  float wa = bb - t * 0.11;",
    "  float wb = bc + t * 0.09;",
    "  float pa = ba + t * 0.25 + 0.32 * sin(wa);",
    "  float pb = bb - t * 0.17 + 0.24 * sin(wb);",
    "  float pc = bc + t * 0.12;",
    "  float aa = 0.085 * (0.80 + 0.20 * sin(t * 0.21));",
    "  float ab = 0.060 * (0.78 + 0.22 * cos(t * 0.17));",
    "  float sb = sin(pb); float cc = cos(pc); float ca = cos(pa);",
    "  float crest = aa * sin(pa) + ab * cos(pb) + 0.016 * sin(pc);",
    "  float cwa = cos(wa); float cwb = cos(wb);",
    "  float sx = aa * ca * (9.0 - 1.344 * cwa) - ab * sb * (-4.2 + 4.32 * cwb) + 0.288 * cc;",
    "  float sz = aa * ca * (6.1 + 3.936 * cwa) - ab * sb * (12.3 + 1.92 * cwb) + 0.128 * cc;",
    "  float n = (0.90 - 0.30 * sx - 0.48 * sz) / sqrt(1.0 + sx * sx + sz * sz);",
    "  lit = clamp(0.30 + 0.62 * n, 0.20, 0.95);",
    "  vec2 p = vec2(xx + 0.034 * sz, zz + crest);",
    "  if (ptr.z > 0.0) {",
    "    vec2 m = (p - ptr.xy) * asp;",
    "    float sq = dot(m, m);",
    "    float w = max(0.0, 1.0 - sq / (radius * radius));",
    "    p += m / asp * (0.055 * w * w * w / sqrt(sq + 0.013) * ptr.z);",
    "  }",
    "  p = (floor(p * buf) + 0.5) / buf;",
    "  gl_PointSize = psize;",
    "  gl_Position = vec4(p.x * 2.0 - 1.0, 1.0 - p.y * 2.0, 0.0, 1.0);",
    "}"
  ].join("\n");
  var FRAG = [
    "precision mediump float;",
    "uniform vec3 ink;",
    "uniform vec3 bg;",
    "uniform float gain;",
    "uniform float mode;",
    "varying float lit;",
    "void main() {",
    "  vec2 c = abs(floor(gl_PointCoord * 3.0) - 1.0);",
    "  float k = c.x + c.y < 0.5 ? 1.0 : (c.x * c.y > 0.5 ? 0.24 : 0.68);",
    "  float L = lit * gain * k;",
    "  vec3 o;",
    "  if (mode < 0.5) o = bg + ink * L;",
    "  else if (mode < 1.5) o = bg * (1.0 - (1.0 - ink) * L);",
    "  else if (mode < 2.5) o = ink * L;",
    "  else o = 1.0 - (1.0 - ink) * L;",
    "  gl_FragColor = vec4(o, 1.0);",
    "}"
  ].join("\n");

  window.spacrFx.register("waves", function (env) {
    var gl = env.gl;
    var prog = env.program(VERT, FRAG);
    function U(n) { return gl.getUniformLocation(prog, n); }
    var u = {
      t: U("t"), seed: U("seed"), buf: U("buf"), asp: U("asp"), ptr: U("ptr"), radius: U("radius"),
      psize: U("psize"), ink: U("ink"), bg: U("bg"), gain: U("gain"), mode: U("mode")
    };
    var la = gl.getAttribLocation(prog, "a");
    var vbo = env.buffer();
    var minmax = env.ext("EXT_blend_minmax");
    var seed = env.rng(20261012)() * Math.PI * 2;
    var count = 0, dark = true, gain = 1;
    var DENSITY = 0.1, DMAX = 3.0, SIZE = 1.0, RADIUS = 0.15, BUDGET = 1920 * 1080;

    function grains(bw, bh) {
      var spacing = Math.max(2.4, 4.6 * SIZE / Math.sqrt(DMAX));
      var pop = Math.sqrt(DENSITY / DMAX);
      var cols = Math.max(3, Math.ceil(Math.min(900, Math.max(48, Math.ceil(bw * 1.65 / spacing))) * pop));
      var rows = Math.max(3, Math.ceil(Math.min(520, Math.max(32, Math.ceil(bh * 1.85 / spacing))) * pop));
      var sh = Math.min(bw, bh);
      var mx = 0.06237 + 1 / bw + 0.055 * sh / bw, mz = 0.161001 + 1 / bh + 0.055 * sh / bh;
      var rng = env.rng(20261013);
      var data = new Float32Array(cols * rows * 2), o = 0;
      for (var j = 0; j < rows; j++) {
        var z0 = -0.43 + 1.86 * j / (rows - 1);
        for (var i = 0; i < cols; i++) {
          var x = -0.33 + 1.66 * i / (cols - 1) + (rng() - 0.5) * 0.34 / cols;
          var z = z0 + (rng() - 0.5) * 0.34 / rows;
          if (x < -mx || x > 1 + mx || z < -mz || z > 1 + mz) continue;
          data[o++] = x; data[o++] = z;
        }
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, o), gl.STATIC_DRAW);
      count = o / 2;
    }
    function inkFor(d) {
      var cols = env.palette.slice(0, 2).map(env.rgb);
      if (!d) cols = cols.map(function (c) { return c.map(function (v) { return v + (1 - v) * 0.55; }); });
      return [0, 1, 2].map(function (k) { return 0.78 * cols[0][k] + 0.22 * cols[1][k]; });
    }

    return {
      t0: 0,
      resize: function (w, h, dpr) {
        var cw = w / dpr, ch = h / dpr;
        var s = Math.min(1, Math.sqrt(BUDGET / (cw * ch)));
        var bw = Math.max(1, Math.floor(cw * s)), bh = Math.max(1, Math.floor(ch * s));
        grains(bw, bh);
        var sh = Math.min(w, h);
        gl.useProgram(prog);
        gl.uniform2f(u.buf, bw, bh);
        gl.uniform2f(u.asp, w / sh, h / sh);
        gl.uniform1f(u.psize, Math.max(3, Math.round(3 * w / bw)));
        gl.uniform1f(u.radius, RADIUS);
        gl.uniform1f(u.seed, seed);
      },
      restyle: function (d) {
        dark = d;
        gain = d ? 0.8 : 1.0;
        gl.useProgram(prog);
        gl.uniform3fv(u.ink, inkFor(d));
        gl.uniform1f(u.gain, gain);
      },
      frame: function (t, dt, inp) {
        var bg = env.bg();
        gl.clearColor(bg[0], bg[1], bg[2], 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.useProgram(prog);
        gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
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
        gl.uniform1f(u.mode, (minmax ? 0 : 2) + (dark ? 0 : 1));
        gl.uniform3f(u.bg, bg[0], bg[1], bg[2]);
        gl.uniform1f(u.t, t);
        gl.uniform3f(u.ptr, inp.x, inp.y, inp.pull);
        gl.drawArrays(gl.POINTS, 0, count);
        gl.blendEquation(gl.FUNC_ADD);
      },
      degrade: function () { return false; }
    };
  });
})();
