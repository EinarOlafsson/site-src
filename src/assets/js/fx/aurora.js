/*
 * "spaCR aurora" (ambient.py AuroraEngine). A curtain is a folded lower edge,
 * base + tilt * (u - 0.5) + sum amp * sin(2 pi (u - v t) / wl + phi), with
 * a comb of jittered rays rising from it. Each ray has its own length,
 * weight, phase and rate; it breathes and shimmers, a surge travels along
 * the arc, and the whole sheet leans slowly. The fragment shader inverts the
 * app's sheared strips per pixel over a quad covering only the curtain's
 * band; the CPU uploads a few uniforms. Dark pages add light, light pages
 * multiply ink, as the app does.
 */
(function () {
  "use strict";
  if (!window.spacrFx) return;

  var TAU = Math.PI * 2;
  var BASE = [0.67, 0.48, 0.84], BASE_JITTER = 0.05;
  var THICKNESS = [0.32, 0.57], TILT = 0.06, OVERHANG = 1.12;
  var DRIFT = [0.05, 0.18], DRIFT_PERIOD = [30, 90];
  var FOLDS = [[0.080, 0.85, 0.012], [0.043, 0.33, 0.027], [0.018, 0.17, 0.043]];
  var FOLD_REACH = 0.141;
  var PULSE = [0.62, 0.34, 0.075];
  var DEPTHS = [[1.00, 1.00, 1.00], [0.62, 0.74, 0.72], [1.45, 1.36, 0.55]];
  var DENSITY = 0.1;
  var CURTAINS = Math.max(1, Math.min(9, Math.round(3 * DENSITY)));
  var RAMP = { blend: "#b6ffc8", main: "#6dff9d", high: "#df69c6" };

  var VERT = [
    "attribute vec2 a;",
    "void main() { gl_Position = vec4(a, 0.0, 1.0); }"
  ].join("\n");

  var FRAG = [
    "#ifdef GL_FRAGMENT_PRECISION_HIGH",
    "precision highp float;",
    "#else",
    "precision mediump float;",
    "#endif",
    "uniform vec2 res;",
    "uniform float base, tilt, lean, rayH, left, span, count, peak, depthA, t, dark, minBw;",
    "uniform vec3 fAmp, fK, fPh;",
    "uniform vec2 pulse;",
    "uniform sampler2D rays;",
    "uniform vec3 cBlend, cMain, cHigh;",
    "uniform int iters;",
    "float edge(float x) {",
    "  float u = (x - left) / span;",
    "  vec3 s = sin(fK * u + fPh);",
    "  return (base + tilt * (u - 0.5) + dot(fAmp, s)) * res.y;",
    "}",
    "vec4 ray(float i) { return texture2D(rays, vec2((i + 0.5) / count, 0.25)); }",
    "void main() {",
    "  float px = gl_FragCoord.x;",
    "  float py = res.y - gl_FragCoord.y;",
    "  float f = (edge(px) - py) / rayH;",
    "  float xb = px - lean * f;",
    "  for (int k = 0; k < 3; k++) {",
    "    if (k >= iters) break;",
    "    f = (edge(xb) - py) / rayH;",
    "    xb = px - lean * f;",
    "  }",
    "  float c = (xb - left) / span;",
    "  if (f <= 0.0 || f >= 1.0 || c <= 0.0 || c >= 1.0) { gl_FragColor = vec4(dark > 0.5 ? vec3(0.0) : vec3(1.0), 1.0); return; }",
    "  float i = floor(c * count);",
    "  float best = 9.0; float pick = i;",
    "  for (int j = -1; j <= 1; j++) {",
    "    float n = clamp(i + float(j), 0.0, count - 1.0);",
    "    float d = c * count - n - (0.1 + 0.8 * ray(n).r);",
    "    if (abs(d) < abs(best)) { best = d; pick = n; }",
    "  }",
    "  vec4 k1 = ray(pick);",
    "  float ph = texture2D(rays, vec2((pick + 0.5) / count, 0.75)).r * 6.2831853;",
    "  float len = 0.5 + 0.5 * k1.g;",
    "  float w = 0.4 + 0.95 * k1.b;",
    "  float rate = 0.045 + 0.145 * k1.a;",
    "  float rl = len * (0.82 + 0.18 * sin(t * rate + ph));",
    "  float sh = 0.72 + 0.28 * sin(t * rate * 1.7 + ph);",
    "  float surge = depthA * (0.38 + 0.62 * (0.5 + 0.5 * sin(pulse.x * c + pulse.y)));",
    "  float gain = peak * w * sh * surge * pow(sin(3.1415927 * c), 0.65);",
    "  float rise = f / rl;",
    "  float bw = 0.14 + 0.28 * (1.0 - clamp(rise, 0.0, 1.0));",
    "  float bwe = sqrt(bw * bw + minBw * minBw);",
    "  float r = exp(-(best * best) / (bwe * bwe)) * bw / bwe;",
    "  float em = (0.15 + 0.85 * pow(max(0.0, 1.0 - rise), 0.8)) * clamp((1.0 - rise) / 0.12, 0.0, 1.0) * min(1.0, rise / 0.045);",
    "  float al = clamp(em * (0.2 + 0.8 * r) * gain, 0.0, 1.0);",
    "  float q = clamp(rise, 0.0, 1.0);",
    "  vec3 col = q < 0.12 ? mix(cBlend, cMain, q / 0.12) : (q < 0.42 ? cMain : (q < 0.75 ? mix(cMain, cHigh, (q - 0.42) / 0.33) : cHigh));",
    "  gl_FragColor = vec4(dark > 0.5 ? col * al : vec3(1.0) - (vec3(1.0) - col) * al, 1.0);",
    "}"
  ].join("\n");

  window.spacrFx.register("aurora", function (env) {
    var gl = env.gl;
    var prog = env.program(VERT, FRAG);
    var buf = env.buffer();
    var tex = env.texture();
    var la = gl.getAttribLocation(prog, "a");
    var U = {};
    ["res", "base", "tilt", "lean", "rayH", "left", "span", "count", "peak", "depthA", "t", "dark", "minBw",
      "fAmp", "fK", "fPh", "pulse", "rays", "cBlend", "cMain", "cHigh", "iters"].forEach(function (n) {
      U[n] = gl.getUniformLocation(prog, n);
    });

    var rng = env.rng(20261010);
    function uni(a, b) { return a + (b - a) * rng(); }
    var curtains = [];
    for (var i = 0; i < CURTAINS; i++) {
      var c = {
        y: BASE[i % 3] + Math.floor(i / 3) * 0.055 + uni(-BASE_JITTER, BASE_JITTER),
        height: uni(THICKNESS[0], THICKNESS[1]),
        tilt: uni(-TILT, TILT),
        drift: uni(DRIFT[0], DRIFT[1]),
        rate: TAU / uni(DRIFT_PERIOD[0], DRIFT_PERIOD[1]),
        phase: uni(0, TAU),
        fold: [uni(0, TAU), uni(0, TAU), uni(0, TAU)],
        pulse: uni(0, TAU),
        depth: DEPTHS[i % 3]
      };
      curtains.push(c);
    }
    var seed = Math.floor(rng() * 4294967296);
    var peakDark = 0.80 * Math.sqrt(Math.min(1, 3 * DENSITY));
    var peakLight = 0.65 * Math.sqrt(Math.min(1, 3 * DENSITY));

    var W = 1, H = 1, count = 96, dpr = 1, iters = 2, dark = true;
    var quad = new Float32Array(12);
    var cols = {};

    function build() {
      count = Math.max(96, Math.min(960, Math.floor(W / 4)));
      var r = env.rng(seed ^ count);
      var px = new Uint8Array(count * 2 * 4);
      for (var k = 0; k < count; k++) {
        var o = k * 4, p = (count + k) * 4;
        px[o] = r() * 255; px[o + 1] = r() * 255; px[o + 2] = r() * 255; px[o + 3] = r() * 255;
        px[p] = r() * 255; px[p + 3] = 255;
      }
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, count, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, px);
    }

    return {
      t0: 24,
      resize: function (w, h, d) {
        W = w; H = h; dpr = d || 1;
        build();
      },
      restyle: function (d) {
        dark = d;
        cols = { blend: env.rgb(RAMP.blend), main: env.rgb(RAMP.main), high: env.rgb(RAMP.high) };
      },
      frame: function (t) {
        var bg = env.bg();
        gl.clearColor(bg[0], bg[1], bg[2], 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.useProgram(prog);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.uniform1i(U.rays, 0);
        gl.uniform2f(U.res, W, H);
        gl.uniform1f(U.t, t);
        gl.uniform1f(U.dark, dark ? 1 : 0);
        gl.uniform1i(U.iters, iters);
        var span = W * OVERHANG;
        gl.uniform1f(U.left, (W - span) * 0.5);
        gl.uniform1f(U.span, span);
        gl.uniform1f(U.count, count);
        gl.uniform1f(U.minBw, 0.45 * count / span);
        gl.uniform1f(U.peak, dark ? peakDark : peakLight);
        gl.uniform3fv(U.cBlend, cols.blend);
        gl.uniform3fv(U.cMain, cols.main);
        gl.uniform3fv(U.cHigh, cols.high);
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.enableVertexAttribArray(la);
        gl.vertexAttribPointer(la, 2, gl.FLOAT, false, 0, 0);
        gl.enable(gl.BLEND);
        gl.blendEquation(gl.FUNC_ADD);
        if (dark) gl.blendFunc(gl.ONE, gl.ONE);
        else gl.blendFunc(gl.DST_COLOR, gl.ZERO);
        for (var n = 0; n < curtains.length; n++) {
          var c = curtains[n], rate = c.depth[0];
          var base = c.y + c.drift * Math.sin(c.rate * t + c.phase);
          var rayH = Math.max(1, c.height * H);
          var lean = W * 0.12 * Math.sin(c.phase + t * 0.04);
          var amp = [], k = [], ph = [];
          for (var j = 0; j < 3; j++) {
            amp.push(FOLDS[j][0]);
            k.push(TAU / FOLDS[j][1]);
            ph.push(c.fold[j] - TAU * FOLDS[j][2] * rate * t / FOLDS[j][1]);
          }
          gl.uniform1f(U.base, base);
          gl.uniform1f(U.tilt, c.tilt);
          gl.uniform1f(U.lean, lean);
          gl.uniform1f(U.rayH, rayH);
          gl.uniform1f(U.depthA, c.depth[2]);
          gl.uniform3fv(U.fAmp, amp);
          gl.uniform3fv(U.fK, k);
          gl.uniform3fv(U.fPh, ph);
          gl.uniform2f(U.pulse, TAU / PULSE[1], c.pulse - TAU * PULSE[2] * rate * t / PULSE[1]);
          var reach = FOLD_REACH + Math.abs(c.tilt) * 0.5 + 0.01;
          var y0 = Math.max(0, base - reach - c.height), y1 = Math.min(1, base + reach);
          if (y1 <= y0) continue;
          var a = 1 - 2 * y0, b = 1 - 2 * y1;
          quad.set([-1, b, 1, b, -1, a, -1, a, 1, b, 1, a]);
          gl.bufferData(gl.ARRAY_BUFFER, quad, gl.DYNAMIC_DRAW);
          gl.drawArrays(gl.TRIANGLES, 0, 6);
        }
      },
      degrade: function () {
        if (iters <= 1) return false;
        iters = 1;
        return true;
      }
    };
  });
})();
