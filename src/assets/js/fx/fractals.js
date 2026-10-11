/*
 * "spaCR fractals": a port of FractalEngine (spacr/qt/widgets/ambient.py,
 * SPACEOUT_THEME "fractal"), painted in the app's default "rainbow" palette.
 *
 * A Julia set z <- z^2 + c. The constant c travels round the main cardioid
 * of the Mandelbrot set, a little inside it (96 s per lap, inset 0.035..0.16
 * on a 41 s swing), so the set morphs through the whole connected family.
 * The view sits on the repelling fixed point beta = (1 + sqrt(1 - 4c)) / 2
 * and turns (240 s per turn plus a depth-dependent vortex rate); hashed,
 * non-repeating "wander" states move the depth (span 1.6 -> 0.16, with a
 * log-spiral swirl and tunnel bands), the iteration count (20 x 0.55..1.45,
 * +85 % at depth), the pace and the number of "buds": up to five bubbles
 * that leave the rim and re-sample the same set through their own zoom and
 * vortex, feathered into the parent. Each iteration adds a soft count
 * (1 inside |z|^2 < 4, ramping to 0 at 16); the count is wrapped round the
 * palette every 3 iterations, the ring scrolls once per 14 s, and the
 * interior shows the first ring colour at 0.2 of the peak. A two-thump beat
 * (37 a minute, wandering) dips the light and nudges the zoom.
 *
 * GPU: one fragment pass shades the field into a small buffer (longest edge
 * 448, as the app; 320 on small devices), a second pass upscales it with
 * linear filtering and composites it: added to the dark page, multiplied
 * into the light one after tinting 0.40 toward white, as the app does.
 * CPU per frame: the closed-form state (a few dozen hashes) and ~70 floats
 * of uniforms. The app has no pointer reaction for this theme; neither does
 * this port. The brightness is scaled down from the app's full-screen peak
 * (0.30 dark, 0.40 light) so text over it stays comfortable.
 */
(function () {
  "use strict";
  if (!window.spacrFx) return;

  var MAXIT = 56;
  var VERT = [
    "attribute vec2 p;",
    "void main() { gl_Position = vec4(p, 0.0, 1.0); }"
  ].join("\n");

  var FIELD = [
    "#ifdef GL_FRAGMENT_PRECISION_HIGH",
    "precision highp float;",
    "#else",
    "precision mediump float;",
    "#endif",
    "uniform vec2 bsize;",
    "uniform vec4 mA;",
    "uniform vec4 mB;",
    "uniform vec2 c;",
    "uniform vec4 bA[5];",
    "uniform vec4 bB[5];",
    "uniform vec3 col[7];",
    "uniform float ncol;",
    "uniform float phase;",
    "uniform float peak;",
    "uniform float tint;",
    "vec3 ring(float f) {",
    "  float pos = fract(f + phase) * ncol;",
    "  float lo = floor(pos);",
    "  float hi = mod(lo + 1.0, ncol);",
    "  vec3 a = col[0]; vec3 b = col[0];",
    "  for (int k = 0; k < 7; k++) {",
    "    float fk = float(k);",
    "    if (fk == lo) a = col[k];",
    "    if (fk == hi) b = col[k];",
    "  }",
    "  return mix(a, b, pos - lo);",
    "}",
    "void form(vec2 d, float scale, float ang, float swirl, float tunnel, float scroll, out vec2 z, out float bands) {",
    "  float r = length(d);",
    "  float lr = log(r + 1.0);",
    "  float th = (r > 1e-4 ? atan(d.y, d.x) : 0.0) + ang + swirl * lr;",
    "  z = (r / scale) * vec2(cos(th), sin(th)) + mB.xy;",
    "  bands = (lr + scroll) * tunnel * 255.0;",
    "}",
    "void main() {",
    "  vec2 px = vec2(gl_FragCoord.x, bsize.y - gl_FragCoord.y);",
    "  vec2 z; float bands;",
    "  form(px - 0.5 * bsize, mA.x, mA.y, mA.z, mA.w, mB.z, z, bands);",
    "  for (int i = 0; i < 5; i++) {",
    "    vec4 A = bA[i];",
    "    if (A.z <= 0.0) continue;",
    "    vec2 d = px - A.xy;",
    "    float reach = A.z * 1.3;",
    "    float rb = length(d);",
    "    if (rb >= reach) continue;",
    "    float s = clamp((reach - rb) / max(1e-3, reach - A.z), 0.0, 1.0);",
    "    s = s * s * (3.0 - 2.0 * s);",
    "    vec4 B = bB[i];",
    "    vec2 bz; float bb;",
    "    form(d, A.w, B.x, B.y, B.z, B.w, bz, bb);",
    "    z = mix(z, bz, s);",
    "    bands = mix(bands, bb, s);",
    "  }",
    "  float iters = mB.w;",
    "  float n = 0.0;",
    "  for (int i = 0; i < " + MAXIT + "; i++) {",
    "    if (float(i) >= iters) break;",
    "    float m = dot(z, z);",
    "    n += clamp((16.0 - m) / 12.0, 0.0, 1.0);",
    "    if (m > 16.0) break;",
    "    z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c;",
    "  }",
    "  vec3 k; float a;",
    "  if (n >= iters - 0.5) { k = ring(0.0); a = peak * 0.2; }",
    "  else { k = ring(mod(n * 85.0 + bands, 255.0) / 255.0); a = peak; }",
    "  k = mix(k, vec3(1.0), tint);",
    "  gl_FragColor = vec4(tint > 0.0 ? a * (1.0 - k) : a * k, 1.0);",
    "}"
  ].join("\n");

  var COMP = [
    "precision mediump float;",
    "uniform sampler2D tex;",
    "uniform vec2 res;",
    "uniform vec3 bg;",
    "uniform float light;",
    "void main() {",
    "  vec3 ink = texture2D(tex, gl_FragCoord.xy / res).rgb;",
    "  gl_FragColor = vec4(light > 0.5 ? bg * (1.0 - ink) : bg + ink, 1.0);",
    "}"
  ].join("\n");

  var RAINBOW = ["#FF0040", "#FF7A00", "#FFE000", "#00E05A", "#00C8FF", "#4030FF", "#C02BFF"];
  var TAU = Math.PI * 2;
  var OCT = [[73, 1.0], [29, 0.52], [11, 0.24]];

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, f) { return a + (b - a) * clamp(f, 0, 1); }

  window.spacrFx.register("fractals", function (env) {
    var gl = env.gl;
    var fprog = env.program(VERT, FIELD);
    var cprog = env.program(VERT, COMP);
    function locs(prog, names) {
      var o = {};
      names.forEach(function (n) { o[n] = gl.getUniformLocation(prog, n); });
      return o;
    }
    var fu = locs(fprog, ["bsize", "mA", "mB", "c", "bA", "bB", "col", "ncol", "phase", "peak", "tint"]);
    var cu = locs(cprog, ["tex", "res", "bg", "light"]);
    var fp = gl.getAttribLocation(fprog, "p"), cp = gl.getAttribLocation(cprog, "p");
    var tri = env.buffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, tri);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    var tex = env.texture();
    var fbo = env.framebuffer();

    var rng = env.rng(20261010);
    var phC = rng(), phInset = rng(), phSpin = rng(), phBreath = rng(), phCycle = rng(), phBeat = rng();
    var spinSign = rng() < 0.5 ? 1 : -1;
    var salt = Math.floor(rng() * 1073741824) || 1;

    var cols = RAINBOW.map(env.rgb);
    var edge = env.small ? 320 : 448, iterScale = 1;
    var W = 1, H = 1, bw = 1, bh = 1, dark = true;
    var bA = new Float32Array(20), bB = new Float32Array(20);

    function hash01(ch, idx) {
      var v = (Math.imul(salt, 0x9E3779B1) ^ Math.imul(ch, 0x85EBCA77) ^ Math.imul(idx, 0xC2B2AE3D)) >>> 0;
      v = (v ^ (v >>> 15)) >>> 0;
      v = Math.imul(v, 0x2C1B3C6D) >>> 0;
      v = (v ^ (v >>> 12)) >>> 0;
      v = Math.imul(v, 0x297A2D39) >>> 0;
      v = (v ^ (v >>> 15)) >>> 0;
      return v / 4294967296;
    }
    function wander(ch, t) {
      var tot = 0, ws = 0;
      for (var o = 0; o < 3; o++) {
        var seat = ch * 8 + o;
        var pos = t / OCT[o][0] + hash01(seat, -1);
        var i = Math.floor(pos), f = pos - i;
        var lo = hash01(seat, i), hi = hash01(seat, i + 1);
        tot += OCT[o][1] * (lo + (hi - lo) * f * f * (3 - 2 * f));
        ws += OCT[o][1];
      }
      return tot / ws;
    }
    function depthAt(t) {
      var r = clamp((wander(0, t) - 0.30) / 0.38, 0, 1);
      return r * r * (3 - 2 * r);
    }
    function beat(t) {
      var ph = t * 0.62, W2 = [[0.34, 41.0, 0.31], [0.19, 17.3, 0.77]];
      for (var i = 0; i < 2; i++) {
        var w = W2[i];
        ph += 0.62 * w[0] * w[1] / TAU * (Math.sin(TAU * (t / w[1] + w[2])) - Math.sin(TAU * w[2]));
      }
      ph = ((ph + phBeat) % 1 + 1) % 1;
      var v = 0, TH = [[0.0, 0.052, 1.0], [0.20, 0.080, 0.55]];
      for (var j = 0; j < 2; j++) {
        var g = ((ph - TH[j][0] + 0.5) % 1 + 1) % 1 - 0.5;
        v += TH[j][2] * Math.exp(-(g / TH[j][1]) * (g / TH[j][1]));
      }
      return clamp(v, 0, 1);
    }

    function alloc() {
      var scale = Math.max(1, Math.ceil(Math.max(W, H) / edge));
      bw = Math.max(1, Math.floor(W / scale));
      bh = Math.max(1, Math.floor(H / scale));
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

    function uploadState(t) {
      var deep = depthAt(t);
      var pace = 0.35 * (2 * wander(2, t) - 1);
      var busy = lerp(0.55, 1.45, wander(1, t)) * (1 + 0.85 * deep);
      var iters = clamp(Math.round(Math.max(1, Math.round(20 * busy)) * iterScale), 1, MAXIT);

      var th = TAU * (t / 96 + phC + pace);
      var sw = 0.5 * (1 - Math.cos(TAU * (t / 41 + phInset)));
      var inside = 1 - (0.035 + sw * (0.16 - 0.035));
      var cr = inside * (0.5 * Math.cos(th) - 0.25 * Math.cos(2 * th));
      var ci = inside * (0.5 * Math.sin(th) - 0.25 * Math.sin(2 * th));
      var re = 1 - 4 * cr, im = -4 * ci, mod = Math.sqrt(re * re + im * im);
      var rr = Math.sqrt(Math.max(0, (mod + re) / 2));
      var ri = Math.sqrt(Math.max(0, (mod - re) / 2)) * (im < 0 ? -1 : 1);
      var oRe = (1 + rr) / 2, oIm = ri / 2;

      var bt = beat(t);
      var breath = (1 + 0.16 * Math.sin(TAU * (t / 57 + phBreath))) * (1 - 0.055 * bt);
      var span = lerp(1.6, 0.16, deep) * breath;
      var scale = Math.max(1, bh / 2) / span;
      var turn = t / 240 + phSpin + t * lerp(0.004, 0.055, deep) + pace;

      gl.uniform2f(fu.bsize, bw, bh);
      gl.uniform4f(fu.mA, scale, spinSign * TAU * turn, spinSign * lerp(0, 1.25, deep), lerp(0, 2.6, deep));
      gl.uniform4f(fu.mB, oRe, oIm, -spinSign * 0.045 * t, iters);
      gl.uniform2f(fu.c, cr, ci);

      var rim = 0.62 * Math.min(bw, bh) / 2;
      var slots = clamp(Math.round(5 * wander(3, t)), 0, 5);
      var dd = Math.max(deep, 0.5);
      for (var s = 0; s < 5; s++) {
        bA[s * 4 + 2] = 0;
        if (s >= slots) continue;
        var cyc = lerp(19, 47, hash01(100 + s, 0));
        var pos = t / cyc + hash01(100 + s, 1);
        var num = Math.floor(pos), thr = pos - num;
        if (hash01(200 + s, num) > 0.62) continue;
        var life = lerp(0.30, 0.72, hash01(300 + s, num));
        if (thr >= life) continue;
        var age = thr / life;
        var head = TAU * hash01(400 + s, num);
        var away = rim + rim * lerp(0.35, 1.30, hash01(500 + s, num)) * age * age * (3 - 2 * age);
        var rad = rim * lerp(0.28, 0.62, hash01(600 + s, num)) * Math.pow(Math.sin(Math.PI * age), 0.65);
        if (rad < 2) continue;
        var zoom = lerp(0.35, 1.6, hash01(700 + s, num));
        var sp = hash01(800 + s, num) < 0.5 ? 1 : -1;
        bA[s * 4] = bw / 2 + away * Math.cos(head);
        bA[s * 4 + 1] = bh / 2 + away * Math.sin(head);
        bA[s * 4 + 2] = rad;
        bA[s * 4 + 3] = Math.max(1, rad / (0.16 * zoom));
        bB[s * 4] = head + sp * TAU * turn * (1 + 2 * hash01(900 + s, num));
        bB[s * 4 + 1] = sp * lerp(0, 1.25, dd);
        bB[s * 4 + 2] = lerp(0, 2.6, dd);
        bB[s * 4 + 3] = -sp * 0.045 * turn * 8;
      }
      gl.uniform4fv(fu.bA, bA);
      gl.uniform4fv(fu.bB, bB);
      gl.uniform1f(fu.phase, t / 14 + phCycle);
      var peak = dark ? 0.30 * 0.52 : 0.40 * 0.5;
      gl.uniform1f(fu.peak, peak * (1 - 0.22 * (1 - bt)));
    }

    function quad(loc) {
      gl.bindBuffer(gl.ARRAY_BUFFER, tri);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    return {
      t0: 180,
      resize: function (w, h) { W = w; H = h; alloc(); },
      restyle: function (d) {
        dark = d;
        gl.useProgram(fprog);
        var flat = [];
        cols.forEach(function (k) { flat.push(k[0], k[1], k[2]); });
        gl.uniform3fv(fu.col, new Float32Array(flat));
        gl.uniform1f(fu.ncol, cols.length);
        gl.uniform1f(fu.tint, dark ? 0 : 0.40);
      },
      frame: function (t) {
        gl.disable(gl.BLEND);
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.viewport(0, 0, bw, bh);
        gl.useProgram(fprog);
        uploadState(t);
        quad(fp);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, W, H);
        gl.useProgram(cprog);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.uniform1i(cu.tex, 0);
        gl.uniform2f(cu.res, W, H);
        var bg = env.bg();
        gl.uniform3f(cu.bg, bg[0], bg[1], bg[2]);
        gl.uniform1f(cu.light, dark ? 0 : 1);
        quad(cp);
      },
      degrade: function () {
        if (edge > 180) { edge = Math.max(175, Math.round(edge * 0.8)); alloc(); return true; }
        if (iterScale > 0.55) { iterScale -= 0.15; return true; }
        return false;
      }
    };
  });
})();
