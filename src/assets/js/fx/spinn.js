/*
 * "spaCR spinn": WebGL port of _DataArtEngine family "tissue_facets"
 * (spacr/qt/widgets/ambient.py, _tissue_layout / _paint_tissue_facets).
 *
 * A staggered grid of low paper pyramids: each cell is a 6-9 sided polygon
 * fanned from a lifted centre, every triangle lit by its normal against a
 * fixed upper-left light (0.49 + 0.46 n.(0.43, -0.49, 0.73)) and painted
 * mix(identity, colour, 0.04 + 0.64 light^3); every 7th cell takes the
 * second palette colour, and each polygon has a 0.65 px outline in the first
 * colour at alpha 0.23. Paper has no motion at rest. Under the pointer
 * (radius 0.15 of the shorter edge) cells lift towards it by
 * reach = (1 - d^2/r^2)^3 and spin at 240 deg/s * (1 - d/r)^2; a spun cell
 * keeps its angle after the pointer passes, and the paper settles when the
 * pointer leaves. Geometry is built once per size; the vertex shader places,
 * lifts and rotates every vertex, the fragment shader antialiases the
 * polygon edge and draws the outline. The CPU only advances the per-cell
 * angles (a few hundred floats) into a small texture while the pointer moves.
 */
(function () {
  "use strict";
  if (!window.spacrFx) return;

  var VERT = [
    "precision highp float;",
    "attribute vec4 a;",
    "attribute vec4 b;",
    "attribute vec4 c;",
    "uniform vec2 res;",
    "uniform vec3 ptr;",
    "uniform float radius;",
    "uniform sampler2D ang;",
    "varying float vf;",
    "varying float vt;",
    "varying float vd;",
    "void main() {",
    "  vec2 cell = a.xy;",
    "  float rx = b.x; float ry = b.y; float phase = b.z;",
    "  float sh = min(res.x, res.y);",
    "  vec2 dist = (cell - ptr.xy) / sh;",
    "  float sq = dot(dist, dist);",
    "  float reach = max(0.0, 1.0 - sq / (radius * radius));",
    "  reach = reach * reach * reach;",
    "  float lift = reach * (0.55 + 0.15 * sin(phase));",
    "  vec2 disp = (-dist * vec2(rx, ry) * lift - vec2(0.0, ry * 0.28 * reach)) * ptr.z;",
    "#ifdef SPIN",
    "  vec4 e = texture2D(ang, c.zw);",
    "  float r = (e.r * 65280.0 + e.g * 255.0) / 65536.0 * 6.2831853;",
    "#else",
    "  float r = 0.0;",
    "#endif",
    "  float cs = cos(r); float sn = sin(r);",
    "  vec2 p = cell + disp + vec2(a.z * cs - a.w * sn, a.z * sn + a.w * cs);",
    "  vf = c.x; vt = c.y; vd = b.w;",
    "  gl_Position = vec4(p.x / res.x * 2.0 - 1.0, 1.0 - p.y / res.y * 2.0, 0.0, 1.0);",
    "}"
  ].join("\n");

  var FRAG = [
    "precision mediump float;",
    "uniform vec3 col[2];",
    "uniform float dark;",
    "uniform float gain;",
    "uniform float line;",
    "varying float vf;",
    "varying float vt;",
    "varying float vd;",
    "void main() {",
    "  float cover = clamp(vd + 0.5, 0.0, 1.0);",
    "  float ink = 0.23 * gain * clamp(line + 0.5 - vd, 0.0, 1.0) * clamp(vd + 1.0, 0.0, 1.0);",
    "  vec3 k = vt > 0.5 ? col[1] : col[0];",
    "  float f = vf * gain * cover;",
    "  vec3 o = dark > 0.5 ? k * f + col[0] * ink",
    "    : mix(vec3(1.0), k, f) * mix(vec3(1.0), col[0], ink);",
    "  gl_FragColor = vec4(o, 1.0);",
    "}"
  ].join("\n");

  var GRAVITY = 0.15;
  var MAX_DT = 0.25;
  var DENSITY = 0.1;
  var SEED = 20261010;

  window.spacrFx.register("spinn", function (env) {
    var gl = env.gl;
    var spin = gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS) > 0;
    var prog = env.program((spin ? "#define SPIN\n" : "") + VERT, FRAG);
    gl.useProgram(prog);
    function U(n) { return gl.getUniformLocation(prog, n); }
    var u = { res: U("res"), ptr: U("ptr"), radius: U("radius"), ang: U("ang"), col: U("col"),
      dark: U("dark"), gain: U("gain"), line: U("line") };
    var la = gl.getAttribLocation(prog, "a"), lb = gl.getAttribLocation(prog, "b"), lc = gl.getAttribLocation(prog, "c");
    var buf = env.buffer();
    var tex = spin ? env.texture() : null;
    var count = 0, W = 1, H = 1, dpr = 1, dark = true;
    var cells = [], angles = null, texel = null, tw = 1, th = 1, dirty = false, lastPull = 0;

    function layout(w, h) {
      var rng = env.rng(SEED);
      function uni(lo, hi) { return lo + (hi - lo) * rng(); }
      var columns = Math.max(3, Math.min(66, Math.round(38 * Math.sqrt(DENSITY))));
      var rows = Math.max(2, Math.min(42, Math.round(columns * h / w)));
      var cw = w / columns, ch = h / rows;
      tw = columns + 2; th = rows + 2;
      var out = [];
      cells = [];
      for (var row = -1; row <= rows; row++) {
        var odd = ((row % 2) + 2) % 2;
        for (var col = -1; col <= columns; col++) {
          var cx = (col + 0.5 * odd + 0.25 + uni(-0.18, 0.18)) * cw;
          var cy = (row + 0.45 + uni(-0.18, 0.18)) * ch;
          var rx = cw * uni(0.40, 0.56), ry = ch * uni(0.40, 0.56);
          var peak = uni(0.20, 0.55), hs = Math.min(rx, ry);
          var sides = 6 + Math.floor(rng() * 4), corners = [];
          for (var s = 0; s < sides; s++) {
            var an = Math.PI * 2 * s / sides + 0.12 * odd, re = uni(0.82, 1.15);
            corners.push([Math.cos(an) * rx * re, Math.sin(an) * ry * re, uni(-0.05, 0.09) * hs]);
          }
          var ce = [rx * uni(-0.22, 0.22), ry * uni(-0.22, 0.22) - peak * ry * 0.42, peak * hs * 1.4];
          var phase = rng() * Math.PI * 2;
          var tone = (((row * columns + col) % 7) + 7) % 7 === 0 ? 1 : 0;
          var tu = (col + 1.5) / tw, tv = (row + 1.5) / th;
          cells.push([cx, cy, phase]);
          for (s = 0; s < sides; s++) {
            var A = corners[s], B = corners[(s + 1) % sides];
            var vx = A[0] - ce[0], vy = A[1] - ce[1], vz = A[2] - ce[2];
            var wx = B[0] - ce[0], wy = B[1] - ce[1], wz = B[2] - ce[2];
            var nx = vy * wz - vz * wy, ny = vz * wx - vx * wz, nz = vx * wy - vy * wx;
            var nn = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
            var light = Math.max(0, Math.min(1, 0.49 + (0.43 * nx - 0.49 * ny + 0.73 * nz) / nn * 0.46));
            var f = 0.040 + 0.64 * light * light * light;
            var ex = B[0] - A[0], ey = B[1] - A[1];
            var hgt = Math.abs((ce[0] - A[0]) * ey - (ce[1] - A[1]) * ex) / (Math.sqrt(ex * ex + ey * ey) || 1);
            var pts = [[ce, hgt], [A, 0], [B, 0]];
            for (var k = 0; k < 3; k++) {
              var P = pts[k][0];
              out.push(cx, cy, P[0], P[1], rx, ry, phase, pts[k][1], f, tone, tu, tv);
            }
          }
        }
      }
      count = out.length / 12;
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(out), gl.STATIC_DRAW);
      angles = new Float32Array(cells.length);
      texel = new Uint8Array(tw * th * 4);
      if (spin) {
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, tw, th, 0, gl.RGBA, gl.UNSIGNED_BYTE, texel);
      }
    }

    function advance(dt, input) {
      var pull = input.pull, i;
      if (pull < 0.01) {
        if (lastPull >= 0.01) { angles.fill(0); dirty = true; }
      } else if (pull < lastPull) {
        var k = pull / lastPull;
        for (i = 0; i < angles.length; i++) {
          var a = angles[i];
          if (a) { if (a > 180) a -= 360; angles[i] = (a * k + 360) % 360; dirty = true; }
        }
      }
      lastPull = pull;
      if (pull < 0.01 || dt <= 0) return;
      var step = Math.min(MAX_DT, dt) * 240 * pull;
      var sh = Math.min(W, H), r = GRAVITY, px = input.x * W, py = input.y * H;
      for (i = 0; i < cells.length; i++) {
        var dx = (cells[i][0] - px) / sh, dy = (cells[i][1] - py) / sh;
        var prox = 1 - Math.sqrt(dx * dx + dy * dy) / r;
        if (prox > 0) { angles[i] = (angles[i] + step * prox * prox) % 360; dirty = true; }
      }
    }

    function upload() {
      dirty = false;
      if (!spin) return;
      for (var i = 0; i < angles.length; i++) {
        var q = Math.round(angles[i] / 360 * 65536) & 65535;
        texel[i * 4] = q >> 8; texel[i * 4 + 1] = q & 255;
      }
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, tw, th, gl.RGBA, gl.UNSIGNED_BYTE, texel);
    }

    return {
      t0: 0,
      resize: function (w, h, d) {
        W = w; H = h; dpr = d || 1;
        layout(w, h);
        lastPull = 0;
        gl.useProgram(prog);
        gl.uniform2f(u.res, w, h);
        gl.uniform1f(u.radius, GRAVITY);
        gl.uniform1f(u.line, 0.65 * dpr);
      },
      restyle: function (d) {
        dark = d;
        var cols = env.palette.slice(0, 2).map(env.rgb);
        if (!dark) cols = cols.map(function (c) { return c.map(function (x) { return x + (1 - x) * 0.55; }); });
        gl.useProgram(prog);
        gl.uniform3fv(u.col, new Float32Array(cols[0].concat(cols[1])));
        gl.uniform1f(u.dark, dark ? 1 : 0);
        gl.uniform1f(u.gain, dark ? 0.5 : 0.62);
      },
      frame: function (t, dt, input) {
        advance(dt, input);
        if (dirty) upload();
        var bg = env.bg();
        gl.clearColor(bg[0], bg[1], bg[2], 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.useProgram(prog);
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.enableVertexAttribArray(la);
        gl.vertexAttribPointer(la, 4, gl.FLOAT, false, 48, 0);
        gl.enableVertexAttribArray(lb);
        gl.vertexAttribPointer(lb, 4, gl.FLOAT, false, 48, 16);
        gl.enableVertexAttribArray(lc);
        gl.vertexAttribPointer(lc, 4, gl.FLOAT, false, 48, 32);
        if (spin) {
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, tex);
          gl.uniform1i(u.ang, 0);
        }
        gl.uniform3f(u.ptr, input.x * W, input.y * H, input.pull);
        gl.enable(gl.BLEND);
        gl.blendEquation(gl.FUNC_ADD);
        if (dark) gl.blendFunc(gl.ONE, gl.ONE);
        else gl.blendFunc(gl.DST_COLOR, gl.ZERO);
        gl.drawArrays(gl.TRIANGLES, 0, count);
      },
      degrade: function () { return false; }
    };
  });
})();
