/*
 * Site effects: a WebGL field that ports spaCR's ambient "blobs" and "ripple"
 * backgrounds (spacr/qt/widgets/ambient.py: BlobsEngine, RippleEngine, the
 * "spacr" palette and their timing constants), warped by a curl-noise flow
 * field that the pointer stirs. Plus scroll reveals, parallax, the
 * before/after mask slider, lazy muted clips, theme and pause toggles.
 *
 * Reduced motion: one static frame, no loops, clips do not autoplay.
 * No WebGL: the CSS gradient fallback in site.css stays visible.
 */
(function () {
  "use strict";

  var root = document.documentElement;
  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage blocked */ } }
  };

  var reduceQuery = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  var state = {
    reduced: !!(reduceQuery && reduceQuery.matches),
    paused: store.get("fx-paused") === "1"
  };
  function motionAllowed() { return !state.reduced && !state.paused; }

  function syncClasses() {
    root.classList.toggle("no-motion", state.reduced);
    root.classList.toggle("fx-paused", state.paused);
    root.classList.toggle("fx-css-anim", motionAllowed());
  }
  syncClasses();

  /* ---------- theme ---------- */
  var themeBtn = document.getElementById("theme-toggle");
  function currentTheme() { return root.getAttribute("data-theme") || "dark"; }
  function applyTheme(t) {
    root.setAttribute("data-theme", t);
    if (themeBtn) {
      themeBtn.setAttribute("aria-pressed", t === "light" ? "true" : "false");
      themeBtn.setAttribute("aria-label", t === "light" ? "Switch to dark theme" : "Switch to light theme");
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

  /* ---------- pause toggle ---------- */
  var pauseBtn = document.getElementById("fx-toggle");
  function syncPauseBtn() {
    if (!pauseBtn) return;
    pauseBtn.setAttribute("aria-pressed", state.paused ? "true" : "false");
    var long = pauseBtn.querySelector(".label-long");
    var short = pauseBtn.querySelector(".label-short");
    if (long) long.textContent = state.paused ? "Resume effects" : "Pause effects";
    if (short) short.textContent = state.paused ? "Resume" : "Pause";
    if (state.reduced) pauseBtn.title = "Your system asks for reduced motion, so effects stay still.";
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

  /* ---------- WebGL field ---------- */
  var field = null;

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  var VERT = "attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}";
  var FRAG = [
    "precision mediump float;",
    "#define NB 9",
    "uniform vec2 uRes;uniform float uTime;uniform vec2 uMouse;uniform float uPull;",
    "uniform vec3 uBg;uniform vec3 uCol[3];uniform float uBlobAlpha;uniform float uRingAlpha;",
    "uniform vec4 uA[NB];uniform vec4 uB[NB];uniform vec4 uC[NB];",
    "uniform vec4 uSrc[3];uniform vec4 uTap[4];",
    "float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}",
    "float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);",
    " return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}",
    "vec2 curl(vec2 p){float e=.12;",
    " float a=n(p+vec2(0,e)),b=n(p-vec2(0,e)),c=n(p+vec2(e,0)),d=n(p-vec2(e,0));",
    " return vec2(a-b,-(c-d))/(2.*e);}",
    "float falloff(float r){",
    " if(r<.35)return mix(1.,.6,r/.35);",
    " if(r<.7)return mix(.6,.18,(r-.35)/.35);",
    " if(r<1.)return mix(.18,0.,(r-.7)/.3);return 0.;}",
    "void main(){",
    " vec2 px=gl_FragCoord.xy;px.y=uRes.y-px.y;",
    " float s=min(uRes.x,uRes.y);vec2 uv=px/uRes;",
    " vec2 m=uMouse;vec2 dm=(uv-m)*uRes/s;float md=dot(dm,dm);",
    " vec2 swirl=vec2(-dm.y,dm.x)*exp(-md*9.)*.10*uPull;",
    " vec2 w=uv+curl(uv*vec2(2.2,1.6)+uTime*.035)*.035+swirl;",
    " vec3 col=uBg;",
    " for(int i=0;i<NB;i++){",
    "  vec4 A=uA[i],B=uB[i],C=uC[i];",
    "  vec2 c=vec2(A.x+A.z*sin(B.x*uTime+B.z),A.y+A.w*sin(B.y*uTime+B.w));",
    "  vec2 toM=m-c;c+=toM*.18*uPull*exp(-dot(toM,toM)*4.);",
    "  float r=C.x*s*(1.+C.y*sin(C.z*uTime+C.w));",
    "  float d=length((w-c)*uRes)/max(r,1.);",
    "  int ci=int(mod(float(i),3.));vec3 k=ci==0?uCol[0]:(ci==1?uCol[1]:uCol[2]);",
    "  col=mix(col,k,uBlobAlpha*falloff(d));",
    " }",
    " float hd=.5*length(uRes);",
    " for(int j=0;j<3;j++){vec4 S=uSrc[j];vec2 c=S.xy*uRes;float reach=S.w*hd;",
    "  vec3 k=j==0?uCol[0]:(j==1?uCol[1]:uCol[2]);",
    "  for(int q=0;q<4;q++){float u=fract(uTime/S.z+fract(S.x*7.31)+float(q)*.25);",
    "   float R=max(u*reach,1.);float d=length(w*uRes-c)/R;",
    "   float band=smoothstep(.28,.64,d)*smoothstep(1.,.64,d);",
    "   col=mix(col,k,uRingAlpha*sin(3.14159*u)*band);}}",
    " for(int t=0;t<4;t++){vec4 T=uTap[t];float age=uTime-T.z;",
    "  if(T.w>0.&&age>=0.&&age<2.6){float u=age/2.6;float R=max(u*.55*hd,1.);",
    "   float d=length(w*uRes-T.xy*uRes)/R;float band=smoothstep(.55,.85,d)*smoothstep(1.,.85,d);",
    "   col=mix(col,uCol[t==0?1:(t==1?2:0)],.45*sin(3.14159*u)*band);}}",
    " col+=(h(px+fract(uTime))-.5)/255.;",
    " gl_FragColor=vec4(col,1.);",
    "}"
  ].join("\n");

  function hexToRgb(hex) {
    var v = parseInt(hex.slice(1), 16);
    return [(v >> 16 & 255) / 255, (v >> 8 & 255) / 255, (v & 255) / 255];
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
      if (window.console) console.warn("fx: shader failed, using CSS fallback", e);
      return null;
    }
    gl.useProgram(prog);
    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(prog, "p");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    function U(name) { return gl.getUniformLocation(prog, name); }
    var u = {
      res: U("uRes"), time: U("uTime"), mouse: U("uMouse"), pull: U("uPull"), bg: U("uBg"),
      col: U("uCol"), ba: U("uBlobAlpha"), ra: U("uRingAlpha"), A: U("uA"), B: U("uB"), C: U("uC"),
      src: U("uSrc"), tap: U("uTap")
    };

    /* BlobsEngine._configure, constants from ambient.py */
    var rng = mulberry32(20261010);
    var cols = 5, rows = 3, cells = [];
    for (var i = 0; i < cols * rows; i++) cells.push(i);
    for (i = cells.length - 1; i > 0; i--) { var j = Math.floor(rng() * (i + 1)); var t = cells[i]; cells[i] = cells[j]; cells[j] = t; }
    function uni(a, b) { return a + (b - a) * rng(); }
    var A = [], B = [], C = [];
    for (i = 0; i < 9; i++) {
      var cell = cells[i % cells.length], col = cell % cols, row = Math.floor(cell / cols);
      var small = i % 3 === 0;
      A.push((col + 0.15 + 0.7 * rng()) / cols, (row + 0.15 + 0.7 * rng()) / rows, uni(0.04, 0.12), uni(0.04, 0.12));
      B.push(2 * Math.PI / uni(24, 70), 2 * Math.PI / uni(24, 70), uni(0, 2 * Math.PI), uni(0, 2 * Math.PI));
      C.push(small ? uni(0.07, 0.16) : uni(0.22, 0.46), uni(0.12, 0.35), 2 * Math.PI / uni(7, 19), uni(0, 2 * Math.PI));
    }
    gl.uniform4fv(u.A, new Float32Array(A));
    gl.uniform4fv(u.B, new Float32Array(B));
    gl.uniform4fv(u.C, new Float32Array(C));
    /* RippleEngine._configure: three anchors, period 14-26 s, reach 0.55-0.95 */
    var anchors = [[0.24, 0.28], [0.76, 0.22], [0.5, 0.82]], S = [];
    for (i = 0; i < 3; i++) S.push(anchors[i][0] + uni(-0.08, 0.08), anchors[i][1] + uni(-0.08, 0.08), uni(14, 26), uni(0.55, 0.95));
    gl.uniform4fv(u.src, new Float32Array(S));

    var taps = new Float32Array(16), tapIdx = 0;
    var mouse = [0.5, 0.45], target = [0.5, 0.45], pull = 0, pullTarget = 0;
    var time = 0, last = 0, running = false, raf = 0, lastMove = 0;
    var SCALE = 0.5;

    function resize() {
      var w = Math.max(1, Math.round(window.innerWidth * SCALE));
      var hgt = Math.max(1, Math.round(window.innerHeight * SCALE));
      if (w > 960) { hgt = Math.round(hgt * 960 / w); w = 960; }
      if (canvas.width !== w || canvas.height !== hgt) { canvas.width = w; canvas.height = hgt; }
      gl.viewport(0, 0, w, hgt);
      gl.uniform2f(u.res, w, hgt);
    }
    function restyle() {
      var light = root.getAttribute("data-theme") === "light";
      var bg = light ? hexToRgb("#f5f6fa") : hexToRgb("#0e1015");
      gl.uniform3fv(u.bg, new Float32Array(bg));
      var pal = ["#3B82F6", "#FF00FF", "#00CEC8"].map(hexToRgb);
      gl.uniform3fv(u.col, new Float32Array([].concat(pal[0], pal[1], pal[2])));
      gl.uniform1f(u.ba, light ? 0.30 : 0.30);
      gl.uniform1f(u.ra, light ? 0.22 : 0.20);
      if (!running) draw();
    }
    function draw() {
      mouse[0] += (target[0] - mouse[0]) * 0.08;
      mouse[1] += (target[1] - mouse[1]) * 0.08;
      pull += (pullTarget - pull) * 0.05;
      if (performance.now() - lastMove > 1800) pullTarget = 0;
      gl.uniform1f(u.time, time);
      gl.uniform2f(u.mouse, mouse[0], mouse[1]);
      gl.uniform1f(u.pull, pull);
      gl.uniform4fv(u.tap, taps);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    function frame(now) {
      raf = 0;
      if (!running) return;
      var dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
      last = now;
      time += dt;
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
      target[0] = e.clientX / window.innerWidth;
      target[1] = e.clientY / window.innerHeight;
      pullTarget = 1; lastMove = performance.now();
    }, { passive: true });
    window.addEventListener("pointerdown", function (e) {
      if (!running) return;
      var k = tapIdx++ % 4;
      taps[k * 4] = e.clientX / window.innerWidth;
      taps[k * 4 + 1] = e.clientY / window.innerHeight;
      taps[k * 4 + 2] = time;
      taps[k * 4 + 3] = 1;
    }, { passive: true });
    window.addEventListener("resize", function () { resize(); if (!running) draw(); }, { passive: true });
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) stop(); else if (motionAllowed()) start();
    });
    canvas.addEventListener("webglcontextlost", function (e) {
      e.preventDefault(); stop(); root.classList.remove("has-webgl");
    });

    time = 6.0;
    resize();
    restyle();
    draw();
    return {
      restyle: restyle,
      motion: function (on) { if (on) start(); else { stop(); draw(); } },
      start: start
    };
  }

  function bootField() {
    var canvas = document.getElementById("fx");
    if (!canvas) return;
    field = makeField(canvas);
    if (!field) { canvas.remove(); return; }
    root.classList.add("has-webgl");
    if (motionAllowed()) field.start();
  }

  /* ---------- scroll reveals and parallax ---------- */
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
          setTimeout(function () { el.classList.remove("reveal", "in"); }, 900);
        }
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
    reveals.forEach(function (el) { io.observe(el); });
  }

  var plx = [].slice.call(document.querySelectorAll("[data-parallax]"));
  var plxQueued = false;
  function parallax() {
    plxQueued = false;
    var vh = window.innerHeight;
    plx.forEach(function (el) {
      if (!motionAllowed()) { el.style.transform = ""; return; }
      var r = el.getBoundingClientRect();
      var k = parseFloat(el.getAttribute("data-parallax")) || 0.08;
      var off = (r.top + r.height / 2 - vh / 2) * -k;
      el.style.transform = "translate3d(0," + off.toFixed(1) + "px,0)";
    });
  }
  if (plx.length) {
    window.addEventListener("scroll", function () {
      if (!plxQueued) { plxQueued = true; requestAnimationFrame(parallax); }
    }, { passive: true });
    parallax();
  }

  /* ---------- card glow follows the pointer ---------- */
  [].forEach.call(document.querySelectorAll(".card"), function (card) {
    card.addEventListener("pointermove", function (e) {
      var r = card.getBoundingClientRect();
      card.style.setProperty("--mx", (e.clientX - r.left) + "px");
      card.style.setProperty("--my", (e.clientY - r.top) + "px");
    }, { passive: true });
  });

  /* ---------- before/after slider ---------- */
  [].forEach.call(document.querySelectorAll(".compare"), function (box) {
    var range = box.querySelector("input[type=range]");
    function set() { box.style.setProperty("--pos", range.value + "%"); }
    range.addEventListener("input", set);
    set();
  });
  [].forEach.call(document.querySelectorAll("[data-seg-tabs]"), function (tabs) {
    var target = document.getElementById(tabs.getAttribute("data-seg-tabs"));
    var top = target.querySelector("img.top");
    var label = target.querySelector(".lbl.r");
    [].forEach.call(tabs.querySelectorAll("button"), function (b) {
      b.addEventListener("click", function () {
        [].forEach.call(tabs.querySelectorAll("button"), function (o) { o.setAttribute("aria-pressed", o === b ? "true" : "false"); });
        top.src = b.getAttribute("data-src");
        top.alt = b.getAttribute("data-alt");
        label.textContent = b.textContent;
      });
    });
  });

  /* ---------- muted clips: load and play only when visible ---------- */
  var clips = [];
  [].forEach.call(document.querySelectorAll("video[data-src]"), function (v) {
    var visible = false, loaded = false;
    var c = {
      update: function () {
        if (!motionAllowed()) {
          v.pause();
          v.controls = true;
          return;
        }
        v.controls = false;
        if (visible) {
          if (!loaded) { v.src = v.getAttribute("data-src"); loaded = true; }
          var p = v.play(); if (p && p.catch) p.catch(function () { v.controls = true; });
        } else if (loaded) {
          v.pause();
        }
      }
    };
    v.addEventListener("play", function () {
      if (!loaded) { loaded = true; }
    });
    v.addEventListener("click", function () {
      if (!loaded) { v.src = v.getAttribute("data-src"); loaded = true; }
    });
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (es) {
        es.forEach(function (en) { visible = en.isIntersecting; c.update(); });
      }, { threshold: 0.35 }).observe(v);
    }
    v.preload = "none";
    if (!motionAllowed()) { v.src = v.getAttribute("data-src"); loaded = true; }
    c.update();
    clips.push(c);
  });

  /* ---------- copy buttons ---------- */
  [].forEach.call(document.querySelectorAll("[data-copy]"), function (btn) {
    btn.addEventListener("click", function () {
      var src = document.getElementById(btn.getAttribute("data-copy"));
      var text = src ? src.innerText : "";
      var done = function () { var o = btn.textContent; btn.textContent = "Copied"; setTimeout(function () { btn.textContent = o; }, 1400); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () {});
    });
  });

  applyTheme(currentTheme());
  syncPauseBtn();

  var boot = function () {
    if ("requestIdleCallback" in window) requestIdleCallback(bootField, { timeout: 1200 });
    else setTimeout(bootField, 200);
  };
  if (document.readyState === "complete") boot();
  else window.addEventListener("load", boot);
})();
