/*
 * spaCR growth: port of _FungalGrowthEngine (data_art_fungal_growth) in
 * spacr/qt/widgets/ambient.py.
 *
 * Every 30 s a colony starts at an edge (left, right, top, bottom in turn):
 * three fronts leave one origin and, over 144 ticks, wander, reflect off the
 * margins, turn towards the next side and fork into recursive branches (at
 * most 15 live tips at the default density 0.1). Each edge is a short
 * quadratic segment with a birth time and a 0.26-0.30 s growth, so the whole
 * network is a pure function of time: the CPU builds a colony's indexed tree
 * once (about 2000 edges, a millisecond) and the vertex shader grows, fades
 * and tips every edge. Colonies live 75 s and fade over their last 32 s; the
 * app's pixel budget (22 % of the screen, newest branches first, with their
 * ancestors) is kept as a per-edge rank so older colonies recede as new ones
 * grow. Dark pages add light, light pages multiply tinted ink; strokes are
 * unioned (MAX / MIN blending) like Qt strokes one path. No pointer reaction,
 * as in the app.
 */
(function () {
  "use strict";
  if (!window.spacrFx) return;

  var VERT = [
    "precision highp float;",
    "attribute vec4 a0;",
    "attribute vec4 a1;",
    "attribute vec3 a2;",
    "attribute float cn;",
    "uniform float t;",
    "uniform float bStart;",
    "uniform float base;",
    "uniform float budget;",
    "uniform float stroke;",
    "uniform float dpr;",
    "uniform vec2 res;",
    "uniform vec3 col[3];",
    "varying vec2 vp;",
    "varying vec2 vb;",
    "varying vec4 vw;",
    "varying vec3 vlc;",
    "varying vec3 vtc;",
    "vec3 pick(float h) { return h < 0.5 ? col[0] : (h < 1.5 ? col[1] : col[2]); }",
    "void main() {",
    "  vp = vec2(0.0); vb = vec2(0.0); vw = vec4(0.0); vlc = vec3(0.0); vtc = vec3(0.0);",
    "  gl_Position = vec4(2.0, 2.0, 2.0, 1.0);",
    "  float age = t - a1.z;",
    "  float cf = min(1.0, (75.0 - (t - bStart)) / 32.0);",
    "  if (age <= 0.0 || cf <= 0.0) return;",
    "  float pr = min(1.0, age / a1.w);",
    "  float q = 1.0 - pr;",
    "  vec2 E = q * q * a0.xy + 2.0 * q * pr * a1.xy + pr * pr * a0.zw;",
    "  float al = (0.5 + 0.75 * max(0.0, 1.0 - max(0.0, age - a1.w) / 9.0)) * min(1.0, age / 0.35) * cf;",
    "  al = min(al, 1.0);",
    "  if (a2.x < t) al *= clamp((budget - base - a2.y) / (0.03 * budget), 0.0, 1.0);",
    "  if (al < 0.006) return;",
    "  float depth = floor(a2.z / 4.0 + 0.01);",
    "  float hue = a2.z - depth * 4.0;",
    "  float thick = max(0.4, stroke * pow(0.9, depth)) * dpr;",
    "  float tipR = pr < 1.0 ? max(0.45 * dpr, thick * 0.8) : 0.0;",
    "  float R = max(thick * 0.5, tipR) + dpr;",
    "  vec2 A = a0.xy * dpr;",
    "  vec2 d = E * dpr - A;",
    "  float L = length(d);",
    "  vec2 u = L > 1e-4 ? d / L : vec2(1.0, 0.0);",
    "  vec2 n = vec2(-u.y, u.x);",
    "  float along = mod(cn, 2.0);",
    "  float side = cn < 1.5 ? -1.0 : 1.0;",
    "  vec2 p = (along > 0.5 ? d + u * R : -u * R) + n * side * R;",
    "  vp = p; vb = d;",
    "  vw = vec4(thick * 0.5, tipR, al, min(0.85, al * 1.8));",
    "  vlc = pick(hue);",
    "  vtc = pick(mod(hue + 1.0, 3.0));",
    "  vec2 s = (A + p) / res;",
    "  gl_Position = vec4(s.x * 2.0 - 1.0, 1.0 - s.y * 2.0, 0.0, 1.0);",
    "}"
  ].join("\n");

  var FRAG = [
    "precision mediump float;",
    "uniform vec3 bg;",
    "uniform float gain;",
    "uniform float mode;",
    "varying vec2 vp;",
    "varying vec2 vb;",
    "varying vec4 vw;",
    "varying vec3 vlc;",
    "varying vec3 vtc;",
    "void main() {",
    "  float h = clamp(dot(vp, vb) / max(dot(vb, vb), 1e-6), 0.0, 1.0);",
    "  float dl = length(vp - vb * h);",
    "  float w = vw.x * 2.0;",
    "  float we = max(w, 1.0);",
    "  float la = clamp(we * 0.5 + 0.5 - dl, 0.0, 1.0) * (w / we) * vw.z * gain;",
    "  float ta = 0.0;",
    "  if (vw.y > 0.0) {",
    "    float re = max(vw.y, 0.5);",
    "    ta = clamp(re + 0.5 - length(vp - vb), 0.0, 1.0) * (vw.y / re) * (vw.y / re) * vw.w * gain;",
    "  }",
    "  if (la + ta <= 0.0) discard;",
    "  vec3 c;",
    "  if (mode < 0.5) c = bg + vlc * la + vtc * ta;",
    "  else if (mode < 1.5) c = vlc * la + vtc * ta;",
    "  else c = (1.0 - la * (1.0 - vlc)) * (1.0 - ta * (1.0 - vtc));",
    "  if (mode > 2.5) c *= bg;",
    "  gl_FragColor = vec4(c, 1.0);",
    "}"
  ].join("\n");

  var INTERVAL = 30, LIFE = 75, TICKS = 144;
  var SIZE = 1.0, DENSITY = 0.1;
  var TIP_LIMIT = Math.max(5, Math.min(96, Math.round(48 * Math.sqrt(DENSITY))));
  var HEADINGS = [0, Math.PI, Math.PI / 2, -Math.PI / 2];
  var TAU = Math.PI * 2;
  var MAX_EDGES = TICKS * TIP_LIMIT;

  window.spacrFx.register("growth", function (env) {
    var gl = env.gl;
    var prog = env.program(VERT, FRAG);
    gl.useProgram(prog);
    function U(name) { return gl.getUniformLocation(prog, name); }
    var u = {
      t: U("t"), bStart: U("bStart"), base: U("base"), budget: U("budget"), stroke: U("stroke"),
      dpr: U("dpr"), res: U("res"), col: U("col"), bg: U("bg"), gain: U("gain"), mode: U("mode")
    };
    var la0 = gl.getAttribLocation(prog, "a0"), la1 = gl.getAttribLocation(prog, "a1"), la2 = gl.getAttribLocation(prog, "a2");
    var minmax = env.ext("EXT_blend_minmax");
    var SEED = 20261010;

    var inst = env.ext("ANGLE_instanced_arrays");
    var lcn = gl.getAttribLocation(prog, "cn");
    var cnb = env.buffer(), ibuf = null, CPV = inst ? 1 : 4;
    var cns = new Float32Array(inst ? 4 : MAX_EDGES * 4);
    for (var e = 0; e < cns.length; e++) cns[e] = e % 4;
    gl.bindBuffer(gl.ARRAY_BUFFER, cnb);
    gl.bufferData(gl.ARRAY_BUFFER, cns, gl.STATIC_DRAW);
    if (!inst) {
      var idx = new Uint16Array(MAX_EDGES * 6);
      for (e = 0; e < MAX_EDGES; e++) {
        var v = e * 4, o = e * 6;
        idx[o] = v; idx[o + 1] = v + 1; idx[o + 2] = v + 2;
        idx[o + 3] = v + 2; idx[o + 4] = v + 1; idx[o + 5] = v + 3;
      }
      ibuf = env.buffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibuf);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
    }

    var pool = [env.buffer(), env.buffer(), env.buffer(), env.buffer(), env.buffer()];
    var verts = new Float32Array(MAX_EDGES * 11 * CPV);
    var cache = {};
    var W = 1, H = 1, DPR = 1, stroke = 1, budget = 1;
    var dark = true, maxBlocks = 4;

    function hash(a, b) {
      var h = Math.imul(a ^ 0x9E3779B9, 0x85EBCA6B) ^ Math.imul(b + 0x632BE5AB, 0xC2B2AE35);
      h ^= h >>> 15; h = Math.imul(h, 0x2C1B3C6D); h ^= h >>> 12;
      return h | 0;
    }
    var rs = 0;
    function rnd() {
      rs = rs + 0x6D2B79F5 | 0;
      var q = Math.imul(rs ^ rs >>> 15, 1 | rs);
      q = q + Math.imul(q ^ q >>> 7, 61 | q) ^ q;
      return ((q ^ q >>> 14) >>> 0) / 4294967296;
    }
    function uni(a, b) { return a + (b - a) * rnd(); }

    var NF = 10, CAP = TIP_LIMIT + 2;
    var fr = new Float64Array(CAP * NF), nx = new Float64Array(CAP * NF), pr = new Float64Array(CAP * NF);
    var EX0 = new Float64Array(MAX_EDGES), EY0 = new Float64Array(MAX_EDGES), ECX = new Float64Array(MAX_EDGES),
      ECY = new Float64Array(MAX_EDGES), EX1 = new Float64Array(MAX_EDGES), EY1 = new Float64Array(MAX_EDGES),
      EB = new Float64Array(MAX_EDGES), ED = new Float64Array(MAX_EDGES), EM = new Float64Array(MAX_EDGES),
      EK = new Float64Array(MAX_EDGES), EC = new Float64Array(MAX_EDGES), ECUM = new Float64Array(MAX_EDGES),
      EP = new Int32Array(MAX_EDGES), EH = new Int32Array(MAX_EDGES), EDP = new Int32Array(MAX_EDGES),
      SIB = new Float64Array(MAX_EDGES + 1), SRT = new Float64Array(MAX_EDGES);

    function put(arr, i, x, y, vx, vy, rank, front, depth, code, ready, parent) {
      var o = i * NF;
      arr[o] = x; arr[o + 1] = y; arr[o + 2] = vx; arr[o + 3] = vy; arr[o + 4] = rank;
      arr[o + 5] = front; arr[o + 6] = depth; arr[o + 7] = code; arr[o + 8] = ready; arr[o + 9] = parent;
    }
    function copy(src, i, dst, j) { for (var k = 0; k < NF; k++) dst[j * NF + k] = src[i * NF + k]; }

    function lineage(block) {
      var bseed = hash(SEED, block), bstate;
      rs = bseed;
      var dir = block % 4;
      var center = uni(0.43, 0.57);
      var start = HEADINGS[dir];
      var turn = (((HEADINGS[(dir + 1) % 4] - start + Math.PI) % TAU) + TAU) % TAU - Math.PI;
      if (Math.abs(turn + Math.PI) < 1e-9 && block % 2 === 0) turn = Math.PI;
      var ox = dir === 0 ? 0.05 * W : dir === 1 ? 0.95 * W : center * W;
      var oy = dir === 2 ? 0.05 * H : dir === 3 ? 0.95 * H : center * H;
      var nf = 0, f, ang;
      for (f = 0; f < 3; f++) {
        ang = start + uni(-1.1, 1.1);
        put(fr, nf++, ox, oy, Math.cos(ang), Math.sin(ang), -1, f, 0, f * 128 + 1, -1e9, -1);
      }
      bstate = rs;
      var n = 0;
      var step = (dir < 2 ? W : H) * Math.pow(SIZE, 0.3) / 120;
      for (var tick = 0; tick < TICKS; tick++) {
        var nn = 0, np = 0;
        var pg = Math.min(1, tick / 105);
        var bias = 0.16 + 0.36 * pg;
        var tr = Math.max(0, Math.min(1, (tick - 84) / 60));
        tr = tr * tr * (3 - 2 * tr);
        var hd = start + turn * tr, tx = Math.cos(hd), ty = Math.sin(hd);
        var chance = tick < 140 ? 0.42 + 0.24 * Math.pow(pg, 1.5) : 0;
        for (var i = 0; i < nf && n < MAX_EDGES; i++) {
          var o = i * NF;
          var x0 = fr[o], y0 = fr[o + 1], vx = fr[o + 2], vy = fr[o + 3], rank = fr[o + 4];
          var front = fr[o + 5], depth = fr[o + 6], code = fr[o + 7], ready = fr[o + 8];
          rs = hash(bseed ^ Math.imul(code, 0x9E3779B1), tick * 0x27D4EB2F + 1);
          var lb = bias / (1 + 0.03 * Math.min(depth, 12));
          var st = uni(-0.58, 0.58) * (1 - 0.4 * lb);
          var c = Math.cos(st), s = Math.sin(st);
          var rx = vx * c - vy * s, ry = vx * s + vy * c;
          var ex = Math.max(0, (0.2 * W - x0) / (0.2 * W)) - Math.max(0, (x0 - 0.8 * W) / (0.2 * W));
          var ey = Math.max(0, (0.2 * H - y0) / (0.2 * H)) - Math.max(0, (y0 - 0.8 * H) / (0.2 * H));
          var hx = (1 - lb) * rx + lb * tx + 1.8 * ex, hy = (1 - lb) * ry + lb * ty + 1.8 * ey;
          var nm = Math.sqrt(hx * hx + hy * hy) || 1;
          hx /= nm; hy /= nm;
          var len = step * uni(0.85, 1.45);
          var x1 = x0 + hx * len, y1 = y0 + hy * len;
          if (x1 < W * 0.025) { x1 = W * 0.05 - x1; hx = Math.abs(hx); }
          else if (x1 > W * 0.975) { x1 = W * 1.95 - x1; hx = -Math.abs(hx); }
          if (y1 < H * 0.025) { y1 = H * 0.05 - y1; hy = Math.abs(hy); }
          else if (y1 > H * 0.975) { y1 = H * 1.95 - y1; hy = -Math.abs(hy); }
          if ((x1 - x0) * (x1 - x0) + (y1 - y0) * (y1 - y0) < 0.16) {
            if (rank === -1) { copy(fr, i, nx, nn); nx[nn * NF + 2] = tx; nx[nn * NF + 3] = ty; nn++; }
            continue;
          }
          var bend = uni(-0.015, 0.015);
          var born = Math.max(ready, block * INTERVAL - 0.55 + tick * INTERVAL / 108 + uni(-0.012, 0.012));
          var dur = uni(0.26, 0.30);
          EX0[n] = x0; EY0[n] = y0; EX1[n] = x1; EY1[n] = y1;
          ECX[n] = (x0 + x1) * 0.5 - (y1 - y0) * bend; ECY[n] = (y0 + y1) * 0.5 + (x1 - x0) * bend;
          EB[n] = born; ED[n] = dur; EM[n] = born; EH[n] = front; EDP[n] = depth; EP[n] = fr[o + 9];
          put(nx, nn++, x1, y1, hx, hy, rank, front, depth, code, born + dur, n);
          if (rnd() < chance) {
            var fk = (rnd() < 0.5 ? -1 : 1) * uni(0.42, 1.05);
            c = Math.cos(fk); s = Math.sin(fk);
            var chx = hx * c - hy * s, chy = hx * s + hy * c;
            c = Math.cos(-fk * 0.55); s = Math.sin(-fk * 0.55);
            put(nx, nn - 1, x1, y1, hx * c - hy * s, hx * s + hy * c, rank, front, depth + 1,
              (Math.imul(code, 131) + tick + 7) | 0, born + dur, n);
            var crank = Math.min(999, Math.max(0, rank) + 8 + Math.floor(rnd() * 57));
            if (np < CAP) put(pr, np++, x1, y1, chx, chy, crank, front, depth + 1, (Math.imul(code, 131) + tick + 1) | 0, born + dur, n);
          }
          n++;
        }
        rs = bstate;
        for (var k = np - 1; k > 0; k--) {
          var j = Math.floor(rnd() * (k + 1));
          copy(pr, k, fr, CAP - 1); copy(pr, j, pr, k); copy(fr, CAP - 1, pr, j);
        }
        bstate = rs;
        var quota = Math.min(np, Math.max(1, Math.round((1 + 7 * Math.pow(pg, 1.5)) * TIP_LIMIT / 48)));
        for (k = 0; k < quota; k++) {
          if (nn >= TIP_LIMIT) {
            var r = -1;
            for (j = 0; j < nn; j++) {
              var oj = j * NF, or = r * NF;
              if (nx[oj + 4] === -1) continue;
              if (r < 0 || nx[oj + 6] < nx[or + 6] || (nx[oj + 6] === nx[or + 6] && nx[oj + 8] < nx[or + 8])) r = j;
            }
            if (r >= 0) { for (j = r; j < nn - 1; j++) copy(nx, j + 1, nx, j); nn--; }
          }
          copy(pr, k, nx, nn++);
        }
        var sw = fr; fr = nx; nx = sw; nf = nn;
      }
      return n;
    }

    function build(block, buf) {
      var n = lineage(block), i, p, o = 0;
      for (i = n - 1; i >= 0; i--) {
        p = EP[i];
        if (p >= 0 && EM[i] > EM[p]) EM[p] = EM[i];
        var rr = Math.max(0.4, stroke * Math.pow(0.9, EDP[i])) * 0.5 + 1.5;
        EC[i] = 2 * rr * (Math.sqrt((ECX[i] - EX0[i]) * (ECX[i] - EX0[i]) + (ECY[i] - EY0[i]) * (ECY[i] - EY0[i])) +
          Math.sqrt((EX1[i] - ECX[i]) * (EX1[i] - ECX[i]) + (EY1[i] - ECY[i]) * (EY1[i] - ECY[i]))) + Math.PI * rr * rr;
        SIB[i + 1] = -1e9;
      }
      SIB[0] = -1e9;
      for (i = 0; i < n; i++) if (EM[i] > SIB[EP[i] + 1]) SIB[EP[i] + 1] = EM[i];
      var ord = SRT.subarray(0, n), j;
      for (i = 0; i < n; i++) { EK[i] = SIB[EP[i] + 1]; ord[i] = Math.floor(EK[i] * 1e4) * 8192 + i; }
      ord.sort();
      var cum = 0;
      for (i = n - 1; i >= 0; i--) { j = ord[i] - Math.floor(ord[i] / 8192) * 8192; cum += EC[j]; ECUM[j] = cum; }
      for (i = 0; i < n; i++) ord[i] = Math.floor(EB[i] * 1e4) * 8192 + i;
      ord.sort();
      var borns = new Float64Array(n), after = new Float64Array(n + 1);
      for (i = n - 1; i >= 0; i--) { j = ord[i] - Math.floor(ord[i] / 8192) * 8192; borns[i] = EB[j]; after[i] = after[i + 1] + EC[j]; }
      for (i = 0; i < n; i++) {
        for (var c = 0; c < CPV; c++) {
          verts[o++] = EX0[i]; verts[o++] = EY0[i]; verts[o++] = EX1[i]; verts[o++] = EY1[i];
          verts[o++] = ECX[i]; verts[o++] = ECY[i]; verts[o++] = EB[i]; verts[o++] = ED[i];
          verts[o++] = EK[i]; verts[o++] = ECUM[i]; verts[o++] = EH[i] + 4 * EDP[i];
        }
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, verts.subarray(0, o), gl.STATIC_DRAW);
      return { buf: buf, n: n, borns: borns, after: after };
    }

    function unbornCost(b, t) {
      var lo = 0, hi = b.n;
      while (lo < hi) { var mid = (lo + hi) >> 1; if (b.borns[mid] < t) lo = mid + 1; else hi = mid; }
      return b.after[lo];
    }

    function blocksAt(t) {
      var latest = Math.max(0, Math.floor((t + 0.55) / INTERVAL));
      var earliest = Math.max(0, Math.floor((t - LIFE) / INTERVAL), latest - maxBlocks + 1);
      var keep = {}, free = pool.slice(), list = [], b;
      for (b = latest; b >= earliest; b--) if (LIFE - (t - (b * INTERVAL - 0.55)) > 0) keep[b] = 1;
      for (b in cache) {
        if (keep[b]) free.splice(free.indexOf(cache[b].buf), 1);
        else delete cache[b];
      }
      for (b = latest; b >= earliest; b--) {
        if (!keep[b]) continue;
        if (!cache[b]) cache[b] = build(b, free.shift());
        list.push(b);
      }
      return list;
    }

    return {
      t0: 3 * INTERVAL + 17,
      resize: function (w, h, dpr) {
        DPR = dpr || 1;
        W = Math.max(1, w / DPR); H = Math.max(1, h / DPR);
        stroke = Math.max(0.65, Math.min(2.0, 1.45 * SIZE * Math.pow(Math.min(W, H) / 1080, 0.35)));
        budget = W * H * 0.22 * Math.min(1, 0.5 + 0.5 * Math.sqrt(DENSITY / 3));
        cache = {};
        gl.useProgram(prog);
        gl.uniform2f(u.res, w, h);
        gl.uniform1f(u.dpr, DPR);
        gl.uniform1f(u.stroke, stroke);
        gl.uniform1f(u.budget, budget);
      },
      restyle: function (d) {
        dark = d;
        var cols = env.palette.map(env.rgb);
        if (!dark) cols = cols.map(function (c) { return c.map(function (x) { return x + (1 - x) * 0.55; }); });
        gl.useProgram(prog);
        gl.uniform3fv(u.col, new Float32Array([].concat(cols[0], cols[1], cols[2])));
        gl.uniform1f(u.gain, dark ? 0.8 : 1.1);
      },
      frame: function (t, dt, input) {
        var bg = env.bg();
        gl.clearColor(bg[0], bg[1], bg[2], 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        var list = blocksAt(t);
        gl.useProgram(prog);
        gl.uniform1f(u.t, t);
        gl.uniform3f(u.bg, bg[0], bg[1], bg[2]);
        gl.enable(gl.BLEND);
        if (minmax) {
          gl.blendEquation(dark ? minmax.MAX_EXT : minmax.MIN_EXT);
          gl.blendFunc(gl.ONE, gl.ONE);
          gl.uniform1f(u.mode, dark ? 0 : 3);
        } else {
          gl.blendEquation(gl.FUNC_ADD);
          if (dark) gl.blendFunc(gl.ONE, gl.ONE); else gl.blendFunc(gl.DST_COLOR, gl.ZERO);
          gl.uniform1f(u.mode, dark ? 1 : 2);
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, cnb);
        gl.enableVertexAttribArray(lcn);
        gl.vertexAttribPointer(lcn, 1, gl.FLOAT, false, 4, 0);
        gl.enableVertexAttribArray(la0);
        gl.enableVertexAttribArray(la1);
        gl.enableVertexAttribArray(la2);
        if (inst) {
          inst.vertexAttribDivisorANGLE(la0, 1);
          inst.vertexAttribDivisorANGLE(la1, 1);
          inst.vertexAttribDivisorANGLE(la2, 1);
        } else gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibuf);
        var used = 0;
        for (var i = 0; i < list.length; i++) {
          var b = cache[list[i]];
          if (!b.n) continue;
          var unborn = unbornCost(b, t);
          gl.uniform1f(u.bStart, list[i] * INTERVAL - 0.55);
          gl.uniform1f(u.base, used - unborn);
          used += Math.max(0, Math.min(budget - used, b.after[0] - unborn));
          gl.bindBuffer(gl.ARRAY_BUFFER, b.buf);
          gl.vertexAttribPointer(la0, 4, gl.FLOAT, false, 44, 0);
          gl.vertexAttribPointer(la1, 4, gl.FLOAT, false, 44, 16);
          gl.vertexAttribPointer(la2, 3, gl.FLOAT, false, 44, 32);
          if (inst) inst.drawArraysInstancedANGLE(gl.TRIANGLE_STRIP, 0, 4, b.n);
          else gl.drawElements(gl.TRIANGLES, b.n * 6, gl.UNSIGNED_SHORT, 0);
        }
        if (inst) {
          inst.vertexAttribDivisorANGLE(la0, 0);
          inst.vertexAttribDivisorANGLE(la1, 0);
          inst.vertexAttribDivisorANGLE(la2, 0);
        }
        gl.blendEquation(gl.FUNC_ADD);
      },
      degrade: function () {
        if (maxBlocks <= 2) return false;
        maxBlocks--;
        return true;
      },
      dispose: function () {
        if (inst) for (var i = 0; i < 3; i++) inst.vertexAttribDivisorANGLE([la0, la1, la2][i], 0);
      }
    };
  });
})();
