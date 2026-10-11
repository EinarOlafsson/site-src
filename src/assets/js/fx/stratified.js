/*
 * "spaCR stratified": port of DriftEngine (spacr/qt/widgets/ambient.py), a
 * slow starfield in three parallax layers drifting up.
 *
 * Particle i sits on layer i % 3 and takes palette colour i % 3. Its
 * position is a closed form of time, evaluated in the vertex shader:
 *   x = fract(x0 + sway * sin(swayRate * t + swayPhase))
 *   y = fract(y0 - speed * t)
 * with speed = layer speed * U(0.8, 1.25), sway U(0.01, 0.05) of the width,
 * sway period U(18, 52) s. Each layer breathes: alpha * (0.75 + 0.25 *
 * (0.5 + 0.5 sin(rate t + phase))), period U(9, 17) s, quantised to 8 steps
 * as in the app. Dark page: additive. Light page: colours mixed 35 % toward
 * black, alpha * 1.25, multiplied onto the page. The app's count is
 * area / 9500 logical px, clamped to 40..240, times the density. The theme
 * does not react to the pointer.
 */
(function () {
  "use strict";
  if (!window.spacrFx) return;

  var POOL = 240;
  var AREA_PER_PARTICLE = 9500;
  var MIN_PARTICLES = 40;
  var DENSITY = 1.0;
  var LAYERS = [[1.4, 0.35, 0.006], [2.4, 0.55, 0.011], [3.6, 0.80, 0.018]];
  var SWAY = [0.01, 0.05], SWAY_PERIOD = [18, 52];
  var TWINKLE = 0.25, TWINKLE_PERIOD = [9, 17], ALPHA_STEPS = 8;
  var DARKEN_ON_LIGHT = 0.35, LIGHT_BOOST = 1.25;
  var TAU = Math.PI * 2;

  var VERT = [
    "precision highp float;",
    "attribute vec4 a;",
    "attribute vec3 b;",
    "uniform float t;",
    "uniform float dpr;",
    "uniform vec3 alpha;",
    "uniform vec3 col[3];",
    "varying vec4 vc;",
    "varying float rad;",
    "varying float ps;",
    "void main() {",
    "  float x = fract(a.x + b.x * sin(b.y * t + b.z));",
    "  float y = fract(a.y - a.z * t);",
    "  float L = a.w;",
    "  float dia = (L < 0.5 ? 1.4 : (L < 1.5 ? 2.4 : 3.6)) * dpr;",
    "  float al = L < 0.5 ? alpha.x : (L < 1.5 ? alpha.y : alpha.z);",
    "  vec3 c = L < 0.5 ? col[0] : (L < 1.5 ? col[1] : col[2]);",
    "  vc = vec4(c * al, al);",
    "  rad = 0.5 * dia;",
    "  ps = dia + 2.0;",
    "  gl_PointSize = ps;",
    "  gl_Position = vec4(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);",
    "}"
  ].join("\n");
  var FRAG = [
    "precision mediump float;",
    "varying vec4 vc;",
    "varying float rad;",
    "varying float ps;",
    "void main() {",
    "  float d = length(gl_PointCoord - 0.5) * ps;",
    "  float m = clamp(rad - d + 0.5, 0.0, 1.0);",
    "  gl_FragColor = vc * m;",
    "}"
  ].join("\n");

  function uni(rng, r) { return r[0] + (r[1] - r[0]) * rng(); }

  window.spacrFx.register("stratified", function (env) {
    var gl = env.gl;
    var prog = env.program(VERT, FRAG);
    function U(n) { return gl.getUniformLocation(prog, n); }
    var u = { t: U("t"), dpr: U("dpr"), alpha: U("alpha"), col: U("col") };
    var la = gl.getAttribLocation(prog, "a"), lb = gl.getAttribLocation(prog, "b");

    var rng = env.rng(20261010);
    var data = new Float32Array(POOL * 7);
    for (var i = 0, o = 0; i < POOL; i++) {
      var layer = i % 3;
      data[o++] = rng();
      data[o++] = rng();
      data[o++] = LAYERS[layer][2] * uni(rng, [0.8, 1.25]);
      data[o++] = layer;
      data[o++] = uni(rng, SWAY);
      data[o++] = TAU / uni(rng, SWAY_PERIOD);
      data[o++] = uni(rng, [0, TAU]);
    }
    var twRate = [], twPhase = [];
    for (var k = 0; k < 3; k++) twRate.push(TAU / uni(rng, TWINKLE_PERIOD));
    for (k = 0; k < 3; k++) twPhase.push(uni(rng, [0, TAU]));

    var buf = env.buffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);

    var count = MIN_PARTICLES, dark = true;
    var alphas = new Float32Array(3);

    function stepAlpha(t) {
      for (var L = 0; L < 3; L++) {
        var breath = 1 - TWINKLE + TWINKLE * (0.5 + 0.5 * Math.sin(twRate[L] * t + twPhase[L]));
        if (!dark) breath *= LIGHT_BOOST;
        var v = Math.max(0, Math.min(1, LAYERS[L][1] * breath));
        alphas[L] = Math.round(v * (ALPHA_STEPS - 1)) / (ALPHA_STEPS - 1);
      }
    }

    return {
      t0: 30,
      resize: function (w, h, dpr) {
        var want = Math.floor((w / dpr) * (h / dpr) / AREA_PER_PARTICLE);
        want = Math.max(MIN_PARTICLES, Math.min(POOL, want));
        count = Math.max(1, Math.min(POOL, Math.round(want * DENSITY)));
        gl.useProgram(prog);
        gl.uniform1f(u.dpr, dpr);
      },
      restyle: function (d) {
        dark = d;
        var cols = [0, 1, 2].map(function (j) {
          var c = env.rgb(env.palette[j % env.palette.length]);
          return dark ? c : c.map(function (x) { return x * (1 - DARKEN_ON_LIGHT); });
        });
        gl.useProgram(prog);
        gl.uniform3fv(u.col, new Float32Array([].concat(cols[0], cols[1], cols[2])));
      },
      frame: function (t) {
        var bg = env.bg();
        gl.clearColor(bg[0], bg[1], bg[2], 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.useProgram(prog);
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.enableVertexAttribArray(la);
        gl.vertexAttribPointer(la, 4, gl.FLOAT, false, 28, 0);
        gl.enableVertexAttribArray(lb);
        gl.vertexAttribPointer(lb, 3, gl.FLOAT, false, 28, 16);
        gl.enable(gl.BLEND);
        if (dark) gl.blendFunc(gl.ONE, gl.ONE);
        else gl.blendFunc(gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA);
        stepAlpha(t);
        gl.uniform3fv(u.alpha, alphas);
        gl.uniform1f(u.t, t);
        gl.drawArrays(gl.POINTS, 0, count);
      },
      degrade: function () { return false; }
    };
  });
})();
