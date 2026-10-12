/*
 * Site scripts.
 *
 * Background: WebGL ports of spaCR's ambient themes (spacr/qt/widgets/
 * ambient.py). This file holds the shared core (canvas, clock, pointer,
 * pause, reduced motion, CSS fallback, theme picker) and the default theme,
 * "spaCR advection" (_DataArtEngine._frame_genetic_advection). Every other
 * theme lives in assets/js/fx/<slug>.js and is fetched only when picked; it
 * calls spacrFx.register(slug, factory).
 *
 * Theme contract. factory(env) returns
 *   { t0, resize(w, h, dpr), restyle(dark), frame(t, dt, input), degrade(), dispose() }
 * frame draws the whole frame, clear included; dt 0 means "draw the current
 * state without advancing". input = { x, y, pull, clicks: [{ x, y, t }], bounces: [{ edge, s, t }] }
 * with x, y in 0..1 from the top left, pull 0..1 (pointer presence,
 * smoothed) and clicks in theme time, newest last, at most 8, under 5 s old.
 * GL objects come from env.program/buffer/texture/framebuffer/renderbuffer;
 * the core deletes them and resets GL state when the theme is switched away,
 * so switching never leaks.
 *
 * Advection: each grain has a fixed (u, v, depth). Its position at time t is
 * a closed form: travel along x, a sum of three sines in y, then three
 * wrapping vortices that rotate grains near their centres. A trail is
 * extrapolated from the last three samples with clamped curvature, and
 * grains within the pointer radius are pulled towards the pointer, as in the
 * app. The vertex shader evaluates all of it, so the CPU only uploads time.
 *
 * Motion starts on its own shortly after load, or at the first interaction
 * where WebGL is software-rendered or a frame takes over 25 ms (localStorage
 * "fx-motion" = "always" skips that check, e.g. for tests).
 * Reduced motion: one still frame, no loop. Pause: the same, until resumed.
 * No WebGL: the CSS gradient in site.css stays visible.
 */
(function () {
  "use strict";

  var root = document.documentElement;
  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage blocked */ } }
  };

  var ui = {};
  try { ui = JSON.parse(document.getElementById("i18n-ui").textContent) || {}; } catch (e) { /* English page */ }
  function T(k, en) { return typeof ui[k] === "string" ? ui[k] : en; }

  var self = document.currentScript;
  var assetVer = (self && /[?&]v=([^&#]+)/.exec(self.src) || [])[1] || "";
  var themeBase = self && self.src ? self.src.replace(/[?#].*$/, "").replace(/[^\/]*$/, "") + "fx/" : "/assets/js/fx/";

  var reduceQuery = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  var state = {
    reduced: !!(reduceQuery && reduceQuery.matches),
    paused: store.get("fx-paused") === "1"
  };
  function motionAllowed() { return !state.reduced && !state.paused; }
  function syncClasses() {
    root.classList.toggle("no-motion", state.reduced);
    root.classList.toggle("fx-paused", state.paused);
  }
  syncClasses();

  var DEFAULT_FX = "field";
  var INLINE_FX = "advection";
  var fxMenu = document.querySelector("[data-fx-menu]");
  var fxChoices = fxMenu ? [].slice.call(fxMenu.querySelectorAll("[data-fx-theme]")) : [];
  var FX_SLUGS = fxChoices.map(function (b) { return b.getAttribute("data-fx-theme"); });
  if (FX_SLUGS.indexOf(DEFAULT_FX) < 0) FX_SLUGS.unshift(DEFAULT_FX);
  if (FX_SLUGS.indexOf(INLINE_FX) < 0) FX_SLUGS.unshift(INLINE_FX);
  function validFx(s) { return typeof s === "string" && FX_SLUGS.indexOf(s) >= 0 ? s : DEFAULT_FX; }
  var fxWanted = validFx(store.get("fx-theme"));
  root.setAttribute("data-fx", fxWanted);

  var field = null;
  var clips = [];

  var themeBtn = document.getElementById("theme-toggle");
  function currentTheme() { return root.getAttribute("data-theme") || "dark"; }
  function applyTheme(t) {
    root.setAttribute("data-theme", t);
    if (themeBtn) {
      themeBtn.setAttribute("aria-pressed", t === "light" ? "true" : "false");
      var label = t === "light" ? T("ui.theme_dark", "Switch to dark theme") : T("ui.theme_light", "Switch to light theme");
      themeBtn.setAttribute("aria-label", label);
      themeBtn.title = label;
    }
    [].forEach.call(document.querySelectorAll("source[data-theme-dark]"), function (src) {
      var base = src.getAttribute("data-theme-dark");
      var m = t === "dark" ? (base || "all") : "not all";
      if (src.media !== m) src.media = m;
    });
    if (field) field.restyle();
  }
  if (themeBtn) {
    themeBtn.addEventListener("click", function () {
      var next = currentTheme() === "light" ? "dark" : "light";
      store.set("theme", next);
      applyTheme(next);
    });
  }

  var pauseBtn = document.getElementById("fx-toggle");
  function syncPauseBtn() {
    if (!pauseBtn) return;
    pauseBtn.setAttribute("aria-pressed", state.paused ? "true" : "false");
    var label = state.paused ? T("ui.fx_resume", "Resume background animation") : T("ui.fx_pause", "Pause background animation");
    if (state.reduced) label = T("ui.fx_reduced", "Background animation is off: your system asks for reduced motion");
    pauseBtn.setAttribute("aria-label", label);
    pauseBtn.title = label;
    var text = pauseBtn.querySelector(".label");
    if (text) text.textContent = state.paused ? T("ui.resume", "Resume") : T("ui.pause", "Pause");
  }
  if (pauseBtn) {
    pauseBtn.addEventListener("click", function () {
      state.paused = !state.paused;
      store.set("fx-paused", state.paused ? "1" : "0");
      onMotionChange();
    });
  }
  if (reduceQuery) {
    var onReduce = function (e) { state.reduced = e.matches; onMotionChange(); };
    if (reduceQuery.addEventListener) reduceQuery.addEventListener("change", onReduce);
    else if (reduceQuery.addListener) reduceQuery.addListener(onReduce);
  }
  function onMotionChange() {
    syncClasses();
    syncPauseBtn();
    if (field) field.motion(motionAllowed());
    clips.forEach(function (c) { c.update(); });
    if (!motionAllowed()) revealAll();
  }

  var PALETTE = ["#3B82F6", "#FF00FF", "#00CEC8"];
  var BG = { dark: "#0f1115", light: "#fafaf9" };

  function hexToRgb(hex) {
    var v = parseInt(hex.slice(1), 16);
    return [(v >> 16 & 255) / 255, (v >> 8 & 255) / 255, (v & 255) / 255];
  }
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  var registry = {};
  window.spacrFx = {
    register: function (slug, factory) {
      if (typeof factory !== "function") return;
      var waiting = registry[slug];
      registry[slug] = factory;
      if (typeof waiting === "object" && waiting) waiting.forEach(function (cb) { cb(factory); });
    }
  };
  function loadTheme(slug, cb) {
    if (slug === INLINE_FX) { cb(advection); return; }
    var have = registry[slug];
    if (typeof have === "function") { cb(have); return; }
    if (have) { have.push(cb); return; }
    registry[slug] = [cb];
    var s = document.createElement("script");
    s.src = themeBase + slug + ".js" + (assetVer ? "?v=" + assetVer : "");
    s.async = true;
    s.onerror = function () {
      var list = registry[slug];
      delete registry[slug];
      if (window.console) console.warn("fx: could not load the " + slug + " background");
      if (typeof list === "object" && list) list.forEach(function (f) { f(null); });
    };
    document.head.appendChild(s);
  }

  var ADV_VERT = [
    "precision highp float;",
    "attribute vec4 a;",
    "attribute float c;",
    "uniform float t;",
    "uniform vec2 res;",
    "uniform vec2 ptr;",
    "uniform float pull;",
    "uniform float radius;",
    "uniform float phase;",
    "uniform float trailScale;",
    "uniform float trails;",
    "uniform float psize;",
    "uniform vec3 vort[3];",
    "uniform vec3 col[3];",
    "uniform float gain;",
    "varying vec4 vc;",
    "const float TAU = 6.2831853;",
    "float wrapd(float d) { return d - floor(d + 0.5); }",
    "vec2 sampleAt(float s, float u, float v, float d) {",
    "  float travel = t * (0.013 + 0.009 * d) + 0.046 * (sin(t * 0.23 + 4.0 * d + phase) - sin(4.0 * d + phase));",
    "  float x = fract(u + travel - s * (0.0015 + 0.0012 * d));",
    "  float br = t * 0.11;",
    "  float y = v + (0.10 + 0.045 * sin(br)) * sin(TAU * x + 7.0 * v + phase + br)",
    "    + 0.07 * sin(2.0 * TAU * x - 5.0 * v + phase * 0.7 - br * 0.83)",
    "    + 0.035 * sin(5.0 * TAU * x + 11.0 * v + br * 1.31);",
    "  y = fract(y);",
    "  for (int i = 0; i < 3; i++) {",
    "    vec3 A = vort[i];",
    "    float cx = A.x + 0.12 * sin(t * 0.071 + A.z * TAU);",
    "    float cy = A.y + 0.12 * cos(t * 0.063 + A.z * TAU);",
    "    float dx = wrapd(x - cx);",
    "    float dy = wrapd(y - cy);",
    "    float reach = 0.15 + 0.025 * sin(t * 0.14 + float(i));",
    "    float w = max(0.0, 1.0 - (dx * dx + dy * dy) / (reach * reach));",
    "    w *= w;",
    "    float sgn = i == 1 ? 1.0 : -1.0;",
    "    float rot = w * (2.7 + 1.4 * sin(t * 0.19 + A.z * TAU)) * sgn;",
    "    float cs = cos(rot);",
    "    float sn = sin(rot);",
    "    x = fract(cx + dx * cs - dy * sn);",
    "    y = fract(cy + dx * sn + dy * cs);",
    "  }",
    "  return vec2(x, y);",
    "}",
    "void main() {",
    "  float u = a.x; float v = a.y; float d = a.z; float k = a.w * trailScale;",
    "  vec2 p0 = sampleAt(0.0, u, v, d);",
    "  vec2 p1 = sampleAt(1.0, u, v, d);",
    "  vec2 p2 = sampleAt(2.0, u, v, d);",
    "  vec2 tg = vec2(wrapd(p0.x - p1.x), wrapd(p0.y - p1.y));",
    "  vec2 pv = vec2(wrapd(p1.x - p2.x), wrapd(p1.y - p2.y));",
    "  vec2 cv = clamp(tg - pv, -0.0003, 0.0003);",
    "  vec2 p = fract(p0 - k * tg + 0.5 * k * (k - 1.0) * cv);",
    "  float sh = min(res.x, res.y);",
    "  vec2 dm = (p - ptr) * res / sh;",
    "  float sq = dot(dm, dm);",
    "  float w = max(0.0, 1.0 - sq / (radius * radius));",
    "  w = w * w * w;",
    "  p -= dm * (0.72 * w * pull) * sh / res;",
    "  float fade = pow((trails - a.w) / trails, 1.3);",
    "  float I = clamp((0.25 + 0.60 * d) * fade * gain, 0.0, 1.0);",
    "  vec3 k3 = c < 0.5 ? col[0] : (c < 1.5 ? col[1] : col[2]);",
    "  vc = vec4(k3 * I, I);",
    "  gl_PointSize = psize;",
    "  gl_Position = vec4(p.x * 2.0 - 1.0, 1.0 - p.y * 2.0, 0.0, 1.0);",
    "}"
  ].join("\n");
  var ADV_FRAG = [
    "precision mediump float;",
    "varying vec4 vc;",
    "void main() {",
    "  vec2 q = gl_PointCoord - 0.5;",
    "  float m = smoothstep(0.5, 0.2, length(q));",
    "  gl_FragColor = vc * m;",
    "}"
  ].join("\n");

  function advection(env) {
    var gl = env.gl;
    var prog = env.program(ADV_VERT, ADV_FRAG);
    gl.useProgram(prog);
    function U(name) { return gl.getUniformLocation(prog, name); }
    var u = {
      t: U("t"), res: U("res"), ptr: U("ptr"), pull: U("pull"), radius: U("radius"), phase: U("phase"),
      trailScale: U("trailScale"), trails: U("trails"), psize: U("psize"), vort: U("vort"), col: U("col"), gain: U("gain")
    };
    var GRAINS = env.small ? 4000 : 12000;
    var TRAILS = env.small ? 6 : 9;
    var rng = mulberry32(20261010);
    var data = new Float32Array(GRAINS * TRAILS * 5);
    var o = 0;
    for (var g = 0; g < GRAINS; g++) {
      var gu = rng(), gv = rng(), gd = rng();
      var pick = rng();
      var ci = pick < 0.7 ? 0 : (pick < 0.85 ? 2 : 1);
      for (var k = 0; k < TRAILS; k++) {
        data[o++] = gu; data[o++] = gv; data[o++] = gd; data[o++] = k; data[o++] = ci;
      }
    }
    var buf = env.buffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    var la = gl.getAttribLocation(prog, "a"), lc = gl.getAttribLocation(prog, "c");

    var anchors = [];
    for (var i = 0; i < 5; i++) anchors.push([rng(), rng(), rng()]);
    gl.uniform1f(u.phase, anchors[0][0] * Math.PI * 2);
    gl.uniform3fv(u.vort, new Float32Array([].concat(anchors[2], anchors[3], anchors[4])));
    gl.uniform1f(u.trails, TRAILS);
    gl.uniform1f(u.trailScale, 11 / (TRAILS - 1));
    gl.uniform1f(u.radius, 0.22);

    var count = GRAINS * TRAILS;
    var dark = true;
    return {
      t0: 40,
      resize: function (w, h, dpr) {
        gl.useProgram(prog);
        gl.uniform2f(u.res, w, h);
        gl.uniform1f(u.psize, Math.max(1.5, 1.6 * dpr));
      },
      restyle: function (d) {
        dark = d;
        var cols = PALETTE.map(hexToRgb);
        if (!dark) cols = cols.map(function (c) { return c.map(function (x) { return x * 0.82; }); });
        gl.useProgram(prog);
        gl.uniform3fv(u.col, new Float32Array([].concat(cols[0], cols[1], cols[2])));
        gl.uniform1f(u.gain, dark ? 0.62 : 0.55);
      },
      frame: function (t, dt, input) {
        var bg = env.bg();
        gl.clearColor(bg[0], bg[1], bg[2], 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.useProgram(prog);
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.enableVertexAttribArray(la);
        gl.vertexAttribPointer(la, 4, gl.FLOAT, false, 20, 0);
        gl.enableVertexAttribArray(lc);
        gl.vertexAttribPointer(lc, 1, gl.FLOAT, false, 20, 16);
        gl.enable(gl.BLEND);
        if (dark) gl.blendFunc(gl.ONE, gl.ONE);
        else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.uniform1f(u.t, t);
        gl.uniform2f(u.ptr, input.x, input.y);
        gl.uniform1f(u.pull, input.pull);
        gl.drawArrays(gl.POINTS, 0, count);
      },
      degrade: function () {
        if (count <= TRAILS * 1500) return false;
        count = Math.max(TRAILS * 1500, Math.floor(count * 0.6 / TRAILS) * TRAILS);
        return true;
      }
    };
  }

  function makeField(canvas) {
    var gl = null;
    try {
      var opts = { antialias: false, alpha: false, depth: false, stencil: false, powerPreference: "low-power", preserveDrawingBuffer: false };
      gl = canvas.getContext("webgl", opts) || canvas.getContext("experimental-webgl", opts);
    } catch (e) { gl = null; }
    if (!gl) return null;

    var small = Math.min(window.innerWidth, window.innerHeight) < 600 || (navigator.hardwareConcurrency || 4) <= 4;
    var owned = [];
    function own(kind, obj) { owned.push([kind, obj]); return obj; }
    function compile(type, src) {
      var o = own("Shader", gl.createShader(type));
      gl.shaderSource(o, src); gl.compileShader(o);
      if (!gl.getShaderParameter(o, gl.COMPILE_STATUS) && !gl.isContextLost()) throw new Error(gl.getShaderInfoLog(o));
      return o;
    }
    var maxAttribs = gl.getParameter(gl.MAX_VERTEX_ATTRIBS);
    var maxUnits = Math.min(8, gl.getParameter(gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS));
    function resetState() {
      for (var i = 0; i < maxAttribs; i++) gl.disableVertexAttribArray(i);
      for (var j = 0; j < maxUnits; j++) { gl.activeTexture(gl.TEXTURE0 + j); gl.bindTexture(gl.TEXTURE_2D, null); }
      gl.activeTexture(gl.TEXTURE0);
      gl.useProgram(null);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.bindRenderbuffer(gl.RENDERBUFFER, null);
      gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST); gl.disable(gl.SCISSOR_TEST); gl.disable(gl.CULL_FACE);
      gl.blendEquation(gl.FUNC_ADD);
      gl.blendFunc(gl.ONE, gl.ZERO);
      gl.colorMask(true, true, true, true);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.viewport(0, 0, canvas.width, canvas.height);
    }
    function release() {
      resetState();
      for (var i = owned.length - 1; i >= 0; i--) {
        var r = owned[i];
        if (r[0] === "Program") gl.deleteProgram(r[1]);
        else gl["delete" + r[0]](r[1]);
      }
      owned = [];
    }
    var env = {
      gl: gl,
      canvas: canvas,
      small: small,
      palette: PALETTE.slice(),
      rgb: hexToRgb,
      rng: mulberry32,
      ext: function (name) { return gl.getExtension(name); },
      dark: function () { return currentTheme() !== "light"; },
      bg: function () { return hexToRgb(currentTheme() === "light" ? BG.light : BG.dark); },
      size: function () { return [canvas.width, canvas.height]; },
      program: function (vs, fs) {
        var p = own("Program", gl.createProgram());
        gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
        gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
        gl.linkProgram(p);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error(gl.getProgramInfoLog(p));
        return p;
      },
      buffer: function () { return own("Buffer", gl.createBuffer()); },
      texture: function () { return own("Texture", gl.createTexture()); },
      framebuffer: function () { return own("Framebuffer", gl.createFramebuffer()); },
      renderbuffer: function () { return own("Renderbuffer", gl.createRenderbuffer()); }
    };

    var theme = null, themeSlug = null;
    var ptr = [0.5, 0.5], pull = 0, pullTarget = 0, lastMove = 0;
    var clicks = [], bounces = [];
    var time = 0, last = 0, running = false, raf = 0;
    var slow = 0, frames = 0, dpr = 1;
    var drawn = false;

    function build(factory) {
      var made = null;
      try {
        made = factory(env);
        if (!made || typeof made.frame !== "function") throw new Error("not a theme");
      } catch (e) {
        if (window.console) console.warn("fx: background failed to start", e);
        release();
        return null;
      }
      return made;
    }
    function adopt(slug, made) {
      theme = made; themeSlug = slug;
      time = typeof made.t0 === "number" ? made.t0 : 0;
      clicks = []; bounces = []; slow = 0; frames = 0;
      if (made.resize) made.resize(canvas.width, canvas.height, dpr);
      if (made.restyle) made.restyle(env.dark());
      draw(0);
      if (awake && motionAllowed()) start();
    }
    function use(slug) {
      loadTheme(slug, function (factory) {
        if (slug !== fxWanted) return;
        var old = theme;
        if (old) {
          try { if (old.dispose) old.dispose(); } catch (e) { /* ignore */ }
          theme = null;
          release();
        }
        var made = factory ? build(factory) : null;
        if (!made && slug !== INLINE_FX) {
          made = build(advection);
          slug = INLINE_FX;
        }
        if (!made) { stop(); root.classList.remove("has-webgl"); return; }
        adopt(slug, made);
      });
    }

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      var w = Math.max(1, Math.round(window.innerWidth * dpr));
      var h = Math.max(1, Math.round(window.innerHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      gl.viewport(0, 0, w, h);
      if (theme && theme.resize) theme.resize(w, h, dpr);
    }
    function restyle() {
      if (!theme) return;
      if (theme.restyle) theme.restyle(env.dark());
      if (!running) draw(0);
    }
    function draw(dt) {
      if (!theme || gl.isContextLost()) return;
      pull += (pullTarget - pull) * (dt > 0 ? Math.min(1, dt * 3.6) : 0);
      if (performance.now() - lastMove > 2500) pullTarget = 0;
      while (clicks.length && (time - clicks[0].t > 5 || clicks[0].t > time)) clicks.shift();
      while (bounces.length && (time - bounces[0].t > 5 || bounces[0].t > time)) bounces.shift();
      gl.viewport(0, 0, canvas.width, canvas.height);
      try {
        theme.frame(time, dt, { x: ptr[0], y: ptr[1], pull: pull, clicks: clicks, bounces: bounces });
      } catch (e) {
        if (window.console) console.warn("fx: background frame failed", e);
        stop();
        return;
      }
      if (!drawn) { drawn = true; root.classList.add("has-webgl"); }
    }
    function frame(now) {
      raf = 0;
      if (!running) return;
      var dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
      last = now;
      time += dt;
      if (dt > 0.034) slow++;
      if (++frames % 90 === 0) {
        if (slow > 45 && theme && theme.degrade) theme.degrade();
        slow = 0;
      }
      draw(dt);
      raf = requestAnimationFrame(frame);
    }
    function start() {
      if (running || document.hidden || !theme) return;
      running = true; last = 0;
      raf = requestAnimationFrame(frame);
    }
    function stop() {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    }
    window.addEventListener("pointermove", function (e) {
      if (e.pointerType === "touch") return;
      ptr[0] = e.clientX / window.innerWidth;
      ptr[1] = e.clientY / window.innerHeight;
      pullTarget = 1; lastMove = performance.now();
    }, { passive: true });
    window.addEventListener("pointerdown", function (e) {
      if (!running || e.button > 0) return;
      clicks.push({ x: e.clientX / window.innerWidth, y: e.clientY / window.innerHeight, t: time });
      if (clicks.length > 8) clicks.shift();
    }, { passive: true });
    // Overscroll bounce: one wave per gesture from the edge that bounced
    // (0 top, 1 bottom), strength from the overscroll speed or amount.
    // Listeners are passive and never cancel scrolling.
    var bounceArmed = [true, true], wheelIdle = 0, touchY = null, touchEdge = -1, touchFired = false;
    function atEdge() {
      var el = document.scrollingElement || document.documentElement;
      var y = window.scrollY, max = el.scrollHeight - window.innerHeight;
      return { top: y <= 0, bottom: y >= max - 1, over: y < 0 ? -y : (y > max ? y - max : 0) };
    }
    function bounce(edge, strength) {
      if (!running || !bounceArmed[edge]) return;
      bounceArmed[edge] = false;
      bounces.push({ edge: edge, s: Math.max(0.35, Math.min(1.6, strength)), t: time });
      if (bounces.length > 4) bounces.shift();
    }
    window.addEventListener("wheel", function (e) {
      var dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1);
      var at = atEdge();
      clearTimeout(wheelIdle);
      wheelIdle = setTimeout(function () { bounceArmed = [true, true]; }, 350);
      if (dy < 0 && at.top) bounce(0, Math.abs(dy) / 100);
      else if (dy > 0 && at.bottom) bounce(1, Math.abs(dy) / 100);
    }, { passive: true });
    window.addEventListener("touchstart", function (e) {
      var at = atEdge();
      touchY = e.touches.length ? e.touches[0].clientY : null;
      touchEdge = at.top ? 0 : at.bottom ? 1 : -1;
      touchFired = false;
      bounceArmed = [true, true];
    }, { passive: true });
    window.addEventListener("touchmove", function (e) {
      if (touchY === null || touchFired || touchEdge < 0 || !e.touches.length) return;
      var pull = e.touches[0].clientY - touchY;
      if ((touchEdge === 0 && pull > 24) || (touchEdge === 1 && pull < -24)) {
        touchFired = true;
        bounce(touchEdge, Math.abs(pull) / 80);
      }
    }, { passive: true });
    window.addEventListener("touchend", function () { touchY = null; }, { passive: true });
    window.addEventListener("scroll", function () {
      var at = atEdge();
      if (at.over > 2) bounce(window.scrollY < 0 ? 0 : 1, at.over / 40);
    }, { passive: true });
    window.addEventListener("resize", function () { resize(); if (!running) draw(0); }, { passive: true });
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) stop(); else if (motionAllowed() && awake) start();
    });
    canvas.addEventListener("webglcontextlost", function (e) {
      e.preventDefault(); stop(); theme = null; owned = []; root.classList.remove("has-webgl");
    });

    resize();
    resetState();
    return {
      restyle: restyle,
      motion: function (on) { if (on && awake) start(); else { stop(); draw(0); } },
      start: start,
      use: function (slug) { use(slug); },
      boot: function (slug) { use(slug); },
      current: function () { return themeSlug; },
      slow: function () {
        var r = "";
        try { var dbg = gl.getExtension("WEBGL_debug_renderer_info"); if (dbg) r = String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || ""); } catch (e) { r = ""; }
        if (/swiftshader|llvmpipe|softpipe|software|basic render/i.test(r)) return true;
        var t0 = performance.now();
        draw(0);
        try { gl.finish(); } catch (e) { /* timing only */ }
        return performance.now() - t0 > 25;
      }
    };
  }

  function syncFxMenu() {
    fxChoices.forEach(function (b) {
      b.setAttribute("aria-pressed", b.getAttribute("data-fx-theme") === fxWanted ? "true" : "false");
    });
  }
  function chooseFx(slug) {
    slug = validFx(slug);
    store.set("fx-theme", slug);
    if (slug === fxWanted) return;
    fxWanted = slug;
    root.setAttribute("data-fx", slug);
    syncFxMenu();
    if (field) field.use(slug);
  }
  if (fxMenu) {
    var fxSummary = fxMenu.querySelector("summary");
    syncFxMenu();
    fxChoices.forEach(function (b, i) {
      b.addEventListener("click", function () {
        chooseFx(b.getAttribute("data-fx-theme"));
        fxMenu.open = false;
        if (fxSummary) fxSummary.focus();
      });
      b.addEventListener("keydown", function (e) {
        var n = fxChoices.length, j = null;
        if (e.key === "ArrowDown") j = (i + 1) % n;
        else if (e.key === "ArrowUp") j = (i - 1 + n) % n;
        else if (e.key === "Home") j = 0;
        else if (e.key === "End") j = n - 1;
        if (j !== null) { e.preventDefault(); fxChoices[j].focus(); }
      });
    });
    fxMenu.addEventListener("toggle", function () {
      if (!fxMenu.open) return;
      var cur = fxMenu.querySelector('[data-fx-theme][aria-pressed="true"]') || fxChoices[0];
      if (cur && fxMenu.matches(":focus-within")) cur.focus();
    });
    fxMenu.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && fxMenu.open) { fxMenu.open = false; if (fxSummary) fxSummary.focus(); }
      else if (e.key === "ArrowDown" && e.target === fxSummary) {
        e.preventDefault();
        fxMenu.open = true;
        var cur = fxMenu.querySelector('[data-fx-theme][aria-pressed="true"]') || fxChoices[0];
        if (cur) cur.focus();
      }
    });
    document.addEventListener("click", function (e) {
      if (fxMenu.open && !fxMenu.contains(e.target)) fxMenu.open = false;
    });
    fxMenu.addEventListener("focusout", function (e) {
      if (fxMenu.open && e.relatedTarget && !fxMenu.contains(e.relatedTarget)) fxMenu.open = false;
    });
  }

  function bootField() {
    var canvas = document.getElementById("fx");
    if (!canvas) return;
    field = makeField(canvas);
    if (!field) { canvas.remove(); return; }
    field.boot(fxWanted);
    var events = ["pointermove", "pointerdown", "scroll", "keydown", "touchstart", "wheel"];
    var woke = false;
    function wake() {
      if (woke) return;
      woke = true;
      events.forEach(function (n) { window.removeEventListener(n, wake, { passive: true }); });
      awake = true;
      if (motionAllowed()) field.start();
    }
    events.forEach(function (n) { window.addEventListener(n, wake, { passive: true }); });
    setTimeout(function () {
      if (woke || (store.get("fx-motion") !== "always" && field.slow())) return;
      if ("requestIdleCallback" in window) requestIdleCallback(wake, { timeout: 1000 }); else wake();
    }, 1200);
  }
  var awake = false;

  var scrolledQueued = false;
  function syncScrolled() {
    scrolledQueued = false;
    root.classList.toggle("scrolled", window.scrollY > window.innerHeight * 0.5);
  }
  window.addEventListener("scroll", function () {
    if (!scrolledQueued) { scrolledQueued = true; requestAnimationFrame(syncScrolled); }
  }, { passive: true });
  requestAnimationFrame(syncScrolled);

  var reveals = [].slice.call(document.querySelectorAll(".reveal"));
  function revealAll() { reveals.forEach(function (el) { el.classList.add("in"); }); }
  if (!("IntersectionObserver" in window) || !motionAllowed()) {
    revealAll();
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          var el = en.target;
          el.classList.add("in");
          io.unobserve(el);
          setTimeout(function () { el.classList.remove("reveal", "in"); }, 700);
        }
      });
    }, { rootMargin: "0px 0px -6% 0px", threshold: 0.05 });
    reveals.forEach(function (el) { io.observe(el); });
  }

  var tablist = document.querySelector('[role="tablist"]');
  if (tablist) {
    var tabs = [].slice.call(tablist.querySelectorAll('[role="tab"]'));
    var panels = tabs.map(function (t) { return document.getElementById(t.getAttribute("aria-controls")); });
    root.classList.add("tabs-on");
    var panelFor = function (id) {
      if (!id) return null;
      var el = document.getElementById(id);
      if (!el) return null;
      for (var i = 0; i < panels.length; i++) if (panels[i] === el || panels[i].contains(el)) return { index: i, target: el };
      return null;
    };
    var select = function (i, opts) {
      opts = opts || {};
      tabs.forEach(function (t, j) {
        var on = j === i;
        t.setAttribute("aria-selected", on ? "true" : "false");
        t.tabIndex = on ? 0 : -1;
        panels[j].hidden = !on;
      });
      root.classList.toggle("tab-inner", i !== 0);
      if (opts.focusTab) tabs[i].focus();
      requestAnimationFrame(function () {
        if (tablist.scrollWidth > tablist.clientWidth) {
          tablist.scrollLeft = Math.max(0, tabs[i].offsetLeft - tablist.clientWidth / 2 + tabs[i].offsetWidth / 2);
        }
      });
      if (opts.push) {
        var id = panels[i].id;
        if (location.hash !== "#" + id) history.pushState(null, "", "#" + id);
      }
      if (opts.scrollTo) {
        var bar = document.querySelector(".tabbar");
        var top = opts.scrollTo === "panel" ? 0 : opts.scrollTo.getBoundingClientRect().top + window.scrollY - (bar ? bar.offsetHeight + 72 : 0);
        window.scrollTo(0, Math.max(0, top));
      }
      [].forEach.call(panels[i].querySelectorAll(".reveal"), function (el) { el.classList.add("in"); });
    };
    var fromHash = function (scroll) {
      var id = decodeURIComponent(location.hash.slice(1));
      var hit = panelFor(id) || { index: 0, target: null };
      var deep = hit.target && panels.indexOf(hit.target) < 0;
      select(hit.index, { scrollTo: scroll ? (deep ? hit.target : "panel") : null });
    };
    tabs.forEach(function (t, i) {
      t.addEventListener("click", function (e) {
        e.preventDefault();
        select(i, { push: true, scrollTo: "panel" });
      });
      t.addEventListener("keydown", function (e) {
        var k = e.key, n = tabs.length, j = null;
        if (k === "ArrowRight") j = (i + 1) % n;
        else if (k === "ArrowLeft") j = (i - 1 + n) % n;
        else if (k === "Home") j = 0;
        else if (k === "End") j = n - 1;
        if (j !== null) { e.preventDefault(); select(j, { push: true, focusTab: true }); }
      });
    });
    document.addEventListener("click", function (e) {
      var a = e.target.closest && e.target.closest('a[href^="#"]');
      if (!a || a.getAttribute("role") === "tab") return;
      var id = a.getAttribute("href").slice(1);
      var hit = panelFor(id);
      if (!hit) return;
      e.preventDefault();
      history.pushState(null, "", "#" + id);
      var deep = panels.indexOf(hit.target) < 0;
      select(hit.index, { scrollTo: deep ? hit.target : "panel" });
      if (!deep) panels[hit.index].focus({ preventScroll: true });
    });
    window.addEventListener("popstate", function () { fromHash(true); });
    window.addEventListener("hashchange", function () { fromHash(true); });
    fromHash(!!location.hash && location.hash !== "#overview");
  }

  [].forEach.call(document.querySelectorAll(".viewer"), function (box) {
    var range = box.querySelector("input[type=range]");
    if (!range) return;
    function set() { box.style.setProperty("--pos", range.value + "%"); }
    range.addEventListener("input", set);
    set();
  });
  [].forEach.call(document.querySelectorAll("[data-layer]"), function (cb) {
    var img = document.getElementById(cb.getAttribute("data-layer"));
    if (!img) return;
    cb.addEventListener("change", function () { img.hidden = !cb.checked; });
  });

  [].forEach.call(document.querySelectorAll(".fc"), function (card) {
    var front = card.querySelector(".fc-front"), back = card.querySelector(".fc-back");
    var ret = card.querySelector(".fc-return");
    if (!front || !back) return;
    function face(el, shown) {
      if ("inert" in el) el.inert = !shown;
      if (shown) el.removeAttribute("aria-hidden"); else el.setAttribute("aria-hidden", "true");
    }
    function flip(on, focus) {
      card.classList.toggle("flipped", on);
      front.setAttribute("aria-expanded", on ? "true" : "false");
      var show = on ? back : front, hide = on ? front : back;
      face(show, true);
      if (focus) (on ? (ret || back) : front).focus({ preventScroll: true });
      face(hide, false);
    }
    flip(false, false);
    front.addEventListener("click", function () { flip(true, true); });
    if (ret) ret.addEventListener("click", function (e) { e.stopPropagation(); flip(false, true); });
    back.addEventListener("click", function (e) {
      if (e.target.closest("a, button, summary, table, dl")) return;
      if (window.getSelection && String(window.getSelection())) return;
      flip(false, true);
    });
    back.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { e.preventDefault(); flip(false, true); }
    });
  });
  [].forEach.call(document.querySelectorAll(".fc-morebtn"), function (b) {
    var panel = document.getElementById(b.getAttribute("aria-controls"));
    if (!panel) return;
    b.addEventListener("click", function (e) {
      e.stopPropagation();
      var open = panel.hidden;
      panel.hidden = !open;
      b.setAttribute("aria-expanded", open ? "true" : "false");
      if (open && panel.getBoundingClientRect().top > window.innerHeight - 80) {
        panel.scrollIntoView({ block: "nearest", behavior: document.documentElement.classList.contains("no-motion") ? "auto" : "smooth" });
      }
    });
  });

  [].forEach.call(document.querySelectorAll("video[data-src]"), function (v) {
    var visible = false, loaded = false;
    function load() { if (!loaded) { v.src = v.getAttribute("data-src"); loaded = true; } }
    var c = {
      update: function () {
        if (!motionAllowed()) { v.pause(); v.controls = true; return; }
        v.controls = false;
        if (visible) {
          load();
          var p = v.play(); if (p && p.catch) p.catch(function () { v.controls = true; });
        } else if (loaded) {
          v.pause();
        }
      }
    };
    v.addEventListener("click", load);
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (es) {
        es.forEach(function (en) {
          if (en.isIntersecting && !v.poster && v.getAttribute("data-poster")) v.poster = v.getAttribute("data-poster");
          visible = en.isIntersecting; c.update();
        });
      }, { threshold: 0.35, rootMargin: "200px 0px" }).observe(v);
    }
    v.preload = "none";
    c.update();
    clips.push(c);
  });

  [].forEach.call(document.querySelectorAll("[data-copy]"), function (btn) {
    btn.addEventListener("click", function () {
      var src = document.getElementById(btn.getAttribute("data-copy"));
      var text = src ? src.innerText : "";
      var done = function () { var o = btn.textContent; btn.textContent = T("ui.copied", "Copied"); setTimeout(function () { btn.textContent = o; }, 1400); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () {});
    });
  });

  var menu = document.querySelector("[data-lang-menu]");
  if (menu) {
    var summary = menu.querySelector("summary");
    [].forEach.call(menu.querySelectorAll("a[data-lang]"), function (a) {
      a.addEventListener("click", function () {
        store.set("lang", a.getAttribute("data-lang"));
        if (location.hash) a.setAttribute("href", a.getAttribute("href").split("#")[0] + location.hash);
      });
    });
    menu.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && menu.open) { menu.open = false; summary.focus(); }
    });
    document.addEventListener("click", function (e) {
      if (menu.open && !menu.contains(e.target)) menu.open = false;
    });
    menu.addEventListener("focusout", function (e) {
      if (menu.open && e.relatedTarget && !menu.contains(e.relatedTarget)) menu.open = false;
    });
  }
  var spacrLink = document.querySelector("a[data-langs]");
  var pref = store.get("lang");
  if (spacrLink && pref && pref !== "en") {
    var tag = pref.replace("_", "-");
    if ((" " + spacrLink.getAttribute("data-langs") + " ").indexOf(" " + tag + " ") >= 0) {
      [].forEach.call(document.querySelectorAll('a[href="/projects/spacr/"], a[href^="/projects/spacr/#"]'), function (a) {
        if (a.hasAttribute("data-lang")) return;
        a.setAttribute("href", "/projects/spacr/" + tag + "/" + a.getAttribute("href").slice(16));
      });
    }
  }

  applyTheme(currentTheme());
  syncPauseBtn();

  var boot = function () {
    if ("requestIdleCallback" in window) requestIdleCallback(bootField, { timeout: 1500 });
    else setTimeout(bootField, 300);
  };
  if (document.readyState === "complete") boot();
  else window.addEventListener("load", boot);
})();
