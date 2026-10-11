/*
 * "spaCR blobs": WebGL port of BlobsEngine (spacr/qt/widgets/ambient.py).
 *
 * Fourteen soft blobs on a 5 x 3 shuffled grid, every third one small. Each
 * drifts on two independent sines and pulses on a third, so the frame is a
 * pure function of time:
 *   cx = (x + driftX sin(rateX t + phaseX)) W
 *   cy = (y + driftY sin(rateY t + phaseY)) H
 *   r  = radius min(W, H) (1 + pulse sin(pulseRate t + pulsePhase))
 * Alpha falls off piecewise linearly over (0, 1) (.35, .6) (.7, .18) (1, 0)
 * from a peak of 0.30 (dark, additive) or 0.46 (light, multiply, colours
 * mixed 55 % toward white), exactly as the app's blobs shader.
 *
 * The CPU computes the 14 centres and radii (42 floats). One fragment pass
 * at reduced resolution composites every blob onto the page colour into a
 * small framebuffer; a second pass stretches it over the canvas with linear
 * filtering and a 1/255 dither, which is what the app does with its buffer.
 */
(function () {
  "use strict";
  if (!window.spacrFx) return;

  var COUNT = 14;
  var SMALL_EVERY = 3;
  var LARGE = [0.22, 0.46], SMALL = [0.07, 0.16];
  var DRIFT = [0.04, 0.12], DRIFT_PERIOD = [24.0, 70.0];
  var PULSE = [0.12, 0.35], PULSE_PERIOD = [7.0, 19.0];
  var ALPHA_DARK = 0.30, ALPHA_LIGHT = 0.46;
  var LIGHT_TINT = 0.55;
  var SEED = 1729;
  var TAU = Math.PI * 2;

  var VERT = [
    "attribute vec2 p;",
    "varying vec2 uv;",
    "void main() { uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }"
  ].join("\n");

  var SHADE = [
    "precision highp float;",
    "varying vec2 uv;",
    "uniform vec2 res;",
    "uniform vec3 bg;",
    "uniform float dark;",
    "uniform float peak;",
    "uniform vec3 blob[" + COUNT + "];",
    "uniform vec3 tint[" + COUNT + "];",
    "float falloff(float d) {",
    "  if (d < 0.35) return mix(1.0, 0.60, d / 0.35);",
    "  if (d < 0.70) return mix(0.60, 0.18, (d - 0.35) / 0.35);",
    "  return mix(0.18, 0.0, clamp((d - 0.70) / 0.30, 0.0, 1.0));",
    "}",
    "void main() {",
    "  vec2 px = vec2(uv.x, 1.0 - uv.y) * res;",
    "  vec3 c = bg;",
    "  for (int i = 0; i < " + COUNT + "; i++) {",
    "    vec3 b = blob[i];",
    "    float a = peak * falloff(length(px - b.xy) / b.z);",
    "    if (dark > 0.5) c += tint[i] * a;",
    "    else c *= 1.0 - a + a * tint[i];",
    "  }",
    "  gl_FragColor = vec4(min(c, 1.0), 1.0);",
    "}"
  ].join("\n");

  var SHOW = [
    "precision mediump float;",
    "varying vec2 uv;",
    "uniform sampler2D img;",
    "void main() {",
    "  vec3 c = texture2D(img, uv).rgb;",
    "  float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);",
    "  gl_FragColor = vec4(c + (n - 0.5) / 255.0, 1.0);",
    "}"
  ].join("\n");

  window.spacrFx.register("blobs", function (env) {
    var gl = env.gl;
    var shade = env.program(VERT, SHADE);
    var show = env.program(VERT, SHOW);
    function locs(prog, names) {
      var o = {};
      names.forEach(function (n) { o[n] = gl.getUniformLocation(prog, n); });
      o.p = gl.getAttribLocation(prog, "p");
      return o;
    }
    var us = locs(shade, ["res", "bg", "dark", "peak", "blob", "tint"]);
    var uw = locs(show, ["img"]);

    var quad = env.buffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

    var tex = env.texture();
    var fbo = env.framebuffer();

    var rnd = env.rng(SEED);
    function uni(r) { return r[0] + (r[1] - r[0]) * rnd(); }
    var cells = [];
    for (var k = 0; k < 15; k++) cells.push(k);
    for (k = cells.length - 1; k > 0; k--) {
      var j = Math.floor(rnd() * (k + 1)), s = cells[k];
      cells[k] = cells[j]; cells[j] = s;
    }
    var blobs = [];
    for (var i = 0; i < COUNT; i++) {
      var cell = cells[i % cells.length], col = cell % 5, row = Math.floor(cell / 5);
      var small = i % SMALL_EVERY === 0;
      blobs.push({
        x: (col + 0.15 + 0.7 * rnd()) / 5,
        y: (row + 0.15 + 0.7 * rnd()) / 3,
        dx: uni(DRIFT), dy: uni(DRIFT),
        rx: TAU / uni(DRIFT_PERIOD), ry: TAU / uni(DRIFT_PERIOD),
        px: rnd() * TAU, py: rnd() * TAU,
        r: uni(small ? SMALL : LARGE),
        pulse: uni(PULSE), pr: TAU / uni(PULSE_PERIOD), pp: rnd() * TAU
      });
    }

    var geo = new Float32Array(COUNT * 3);
    var tints = new Float32Array(COUNT * 3);
    var W = 1, H = 1, bw = 1, bh = 1;
    var edge = env.small ? 360 : 640;
    var dark = true;

    function alloc() {
      var sc = Math.max(1, Math.ceil(Math.max(W, H) / edge));
      bw = Math.max(1, Math.floor(W / sc));
      bh = Math.max(1, Math.floor(H / sc));
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, bw, bh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.bindTexture(gl.TEXTURE_2D, null);
    }

    function quadAttrib(loc) {
      gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    }

    return {
      t0: 0,
      resize: function (w, h) {
        W = w; H = h;
        alloc();
      },
      restyle: function (d) {
        dark = d;
        var pal = env.palette.map(env.rgb);
        for (var i = 0; i < COUNT; i++) {
          var c = pal[i % pal.length];
          for (var q = 0; q < 3; q++) tints[i * 3 + q] = dark ? c[q] : c[q] + (1 - c[q]) * LIGHT_TINT;
        }
      },
      frame: function (t) {
        var short = Math.min(bw, bh);
        for (var i = 0; i < COUNT; i++) {
          var b = blobs[i];
          geo[i * 3] = (b.x + b.dx * Math.sin(b.rx * t + b.px)) * bw;
          geo[i * 3 + 1] = (b.y + b.dy * Math.sin(b.ry * t + b.py)) * bh;
          geo[i * 3 + 2] = Math.max(0.5, b.r * short * (1 + b.pulse * Math.sin(b.pr * t + b.pp)));
        }
        gl.disable(gl.BLEND);
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.viewport(0, 0, bw, bh);
        gl.useProgram(shade);
        quadAttrib(us.p);
        var bg = env.bg();
        gl.uniform2f(us.res, bw, bh);
        gl.uniform3f(us.bg, bg[0], bg[1], bg[2]);
        gl.uniform1f(us.dark, dark ? 1 : 0);
        gl.uniform1f(us.peak, dark ? ALPHA_DARK : ALPHA_LIGHT);
        gl.uniform3fv(us.blob, geo);
        gl.uniform3fv(us.tint, tints);
        gl.drawArrays(gl.TRIANGLES, 0, 3);

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, W, H);
        gl.useProgram(show);
        quadAttrib(uw.p);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.uniform1i(uw.img, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      },
      degrade: function () {
        if (edge <= 200) return false;
        edge = Math.max(200, Math.floor(edge * 0.66));
        alloc();
        return true;
      }
    };
  });
})();
