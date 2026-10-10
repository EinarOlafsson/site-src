/*
 * Site scripts.
 *
 * Background: a WebGL port of spaCR's "spaCR advection" theme
 * (spacr/qt/widgets/ambient.py, _DataArtEngine._frame_genetic_advection).
 * Each grain has a fixed (u, v, depth). Its position at time t is a closed
 * form: travel along x, a sum of three sines in y, then three wrapping
 * vortices that rotate grains near their centres. A trail is extrapolated
 * from the last three samples with clamped curvature, and grains within the
 * pointer radius are pulled towards the pointer, as in the app. The vertex
 * shader evaluates all of it, so the CPU only uploads the time.
 *
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

  var VERT = [
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
  var FRAG = [
    "precision mediump float;",
    "varying vec4 vc;",
    "void main() {",
    "  vec2 q = gl_PointCoord - 0.5;",
    "  float m = smoothstep(0.5, 0.2, length(q));",
    "  gl_FragColor = vc * m;",
    "}"
  ].join("\n");

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

  function makeField(canvas) {
    var gl = null;
    try {
      var opts = { antialias: false, alpha: false, depth: false, stencil: false, powerPreference: "low-power", preserveDrawingBuffer: false };
      gl = canvas.getContext("webgl", opts) || canvas.getContext("experimental-webgl", opts);
    } catch (e) { gl = null; }
    if (!gl) return null;

    function sh(type, src) {
      var o = gl.createShader(type); gl.shaderSource(o, src); gl.compileShader(o);
      if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o));
      return o;
    }
    var prog;
    try {
      prog = gl.createProgram();
      gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    } catch (e) {
      if (window.console) console.warn("fx: shader failed, using the CSS fallback", e);
      return null;
    }
    gl.useProgram(prog);
    function U(name) { return gl.getUniformLocation(prog, name); }
    var u = {
      t: U("t"), res: U("res"), ptr: U("ptr"), pull: U("pull"), radius: U("radius"), phase: U("phase"),
      trailScale: U("trailScale"), trails: U("trails"), psize: U("psize"), vort: U("vort"), col: U("col"), gain: U("gain")
    };

    var small = Math.min(window.innerWidth, window.innerHeight) < 600 || (navigator.hardwareConcurrency || 4) <= 4;
    var GRAINS = small ? 4000 : 12000;
    var TRAILS = small ? 6 : 9;
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
    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    var la = gl.getAttribLocation(prog, "a"), lc = gl.getAttribLocation(prog, "c");
    gl.enableVertexAttribArray(la);
    gl.vertexAttribPointer(la, 4, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(lc);
    gl.vertexAttribPointer(lc, 1, gl.FLOAT, false, 20, 16);

    var anchors = [];
    for (var i = 0; i < 5; i++) anchors.push([rng(), rng(), rng()]);
    gl.uniform1f(u.phase, anchors[0][0] * Math.PI * 2);
    gl.uniform3fv(u.vort, new Float32Array([].concat(anchors[2], anchors[3], anchors[4])));
    gl.uniform1f(u.trails, TRAILS);
    gl.uniform1f(u.trailScale, 11 / (TRAILS - 1));
    gl.uniform1f(u.radius, 0.22);
    gl.enable(gl.BLEND);

    var count = GRAINS * TRAILS;
    var ptr = [0.5, 0.5], pull = 0, pullTarget = 0, lastMove = 0;
    var time = 40, last = 0, running = false, raf = 0;
    var slow = 0, frames = 0;
    var dark = true;

    function resize() {
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var w = Math.max(1, Math.round(window.innerWidth * dpr));
      var h = Math.max(1, Math.round(window.innerHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      gl.viewport(0, 0, w, h);
      gl.uniform2f(u.res, w, h);
      gl.uniform1f(u.psize, Math.max(1.5, 1.6 * dpr));
    }
    function restyle() {
      dark = currentTheme() !== "light";
      var cols = PALETTE.map(hexToRgb);
      if (!dark) cols = cols.map(function (c) { return c.map(function (x) { return x * 0.82; }); });
      gl.uniform3fv(u.col, new Float32Array([].concat(cols[0], cols[1], cols[2])));
      gl.uniform1f(u.gain, dark ? 0.62 : 0.55);
      if (dark) gl.blendFunc(gl.ONE, gl.ONE);
      else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      if (!running) draw();
    }
    function draw() {
      pull += (pullTarget - pull) * 0.06;
      if (performance.now() - lastMove > 2500) pullTarget = 0;
      var bg = hexToRgb(dark ? BG.dark : BG.light);
      gl.clearColor(bg[0], bg[1], bg[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform1f(u.t, time);
      gl.uniform2f(u.ptr, ptr[0], ptr[1]);
      gl.uniform1f(u.pull, pull);
      gl.drawArrays(gl.POINTS, 0, count);
    }
    function frame(now) {
      raf = 0;
      if (!running) return;
      var dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
      last = now;
      time += dt;
      if (dt > 0.034) slow++;
      if (++frames % 90 === 0) {
        if (slow > 45 && count > TRAILS * 1500) count = Math.max(TRAILS * 1500, Math.floor(count * 0.6 / TRAILS) * TRAILS);
        slow = 0;
      }
      draw();
      raf = requestAnimationFrame(frame);
    }
    function start() {
      if (running || document.hidden) return;
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
    window.addEventListener("resize", function () { resize(); if (!running) draw(); }, { passive: true });
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) stop(); else if (motionAllowed() && awake) start();
    });
    canvas.addEventListener("webglcontextlost", function (e) {
      e.preventDefault(); stop(); root.classList.remove("has-webgl");
    });

    resize();
    restyle();
    draw();
    return {
      restyle: restyle,
      motion: function (on) { if (on && awake) start(); else { stop(); draw(); } },
      start: start
    };
  }

  function bootField() {
    var canvas = document.getElementById("fx");
    if (!canvas) return;
    field = makeField(canvas);
    if (!field) { canvas.remove(); return; }
    root.classList.add("has-webgl");
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
  syncScrolled();

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
      if (tabs[i].scrollIntoView && tablist.scrollWidth > tablist.clientWidth) {
        tablist.scrollLeft = Math.max(0, tabs[i].offsetLeft - tablist.clientWidth / 2 + tabs[i].offsetWidth / 2);
      }
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
