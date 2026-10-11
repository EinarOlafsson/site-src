(function () {
  "use strict";
  var SVGNS = "http://www.w3.org/2000/svg";
  var SUP = { "-": "⁻", "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹" };
  var MINUS = "−";

  function sup(n) { return String(n).split("").map(function (c) { return SUP[c] || c; }).join(""); }

  function fmtNum(v, digits) {
    if (v === null || v === undefined || !isFinite(v)) return "—";
    var s = Number(v).toPrecision(digits);
    if (s.indexOf("e") !== -1) {
      var parts = Number(v).toExponential(digits - 1).split("e");
      s = parts[0] + " × 10" + sup(parseInt(parts[1], 10));
    } else if (s.indexOf(".") !== -1) {
      s = s.replace(/0+$/, "").replace(/\.$/, "");
    }
    return s.charAt(0) === "-" ? MINUS + s.slice(1) : s;
  }

  function fmtP(v, zeroText) {
    if (v === 0) return zeroText;
    if (v === null || v === undefined || !isFinite(v)) return "—";
    if (v < 0.001) {
      var parts = Number(v).toExponential(2).split("e");
      return parts[0] + " × 10" + sup(parseInt(parts[1], 10));
    }
    return fmtNum(v, 3);
  }

  function signed(v) {
    var s = fmtNum(v, 4);
    return v > 0 ? "+" + s : s;
  }

  function niceTicks(lo, hi, count) {
    var span = hi - lo;
    if (!(span > 0)) return [lo];
    var step = Math.pow(10, Math.floor(Math.log10(span / count)));
    var err = (count * step) / span;
    if (err <= 0.15) step *= 10; else if (err <= 0.35) step *= 5; else if (err <= 0.75) step *= 2;
    var out = [];
    for (var t = Math.ceil(lo / step) * step; t <= hi + step * 1e-9; t += step) out.push(Math.abs(t) < step * 1e-9 ? 0 : t);
    return out;
  }

  function el(name, attrs, parent) {
    var node = document.createElementNS(SVGNS, name);
    if (attrs) for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) node.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(node);
    return node;
  }

  function h(tag, cls, text, parent) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = text;
    if (parent) parent.appendChild(node);
    return node;
  }

  function strings(root) {
    var out = {};
    var tpl = root.querySelector("template.volcano-strings");
    var scope = tpl && tpl.content ? tpl.content : tpl;
    if (!scope) return out;
    var nodes = scope.querySelectorAll("[data-k]");
    for (var i = 0; i < nodes.length; i++) out[nodes[i].getAttribute("data-k")] = nodes[i].textContent.replace(/\s+/g, " ").trim();
    return out;
  }

  function fill(template, values) {
    return String(template || "").replace(/\{(\w+)\}/g, function (m, k) { return values[k] !== undefined ? values[k] : m; });
  }

  function init(root) {
    if (root.__volcano) return;
    root.__volcano = true;
    var src = root.getAttribute("data-volcano");
    var plot = root.querySelector(".volcano-plot");
    if (!src || !plot) return;
    var T = strings(root);
    var t = function (k) { return T[k] !== undefined ? T[k] : k; };
    var started = false;
    function start() {
      if (started) return;
      started = true;
      plot.setAttribute("aria-busy", "true");
      fetch(src, { credentials: "same-origin" })
        .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
        .then(function (data) { plot.removeAttribute("aria-busy"); build(root, plot, data, t); })
        .catch(function () {
          plot.removeAttribute("aria-busy");
          var msg = root.querySelector(".volcano-status");
          if (msg) { msg.textContent = t("error"); msg.hidden = false; }
        });
    }
    if ("IntersectionObserver" in window) {
      var io = new IntersectionObserver(function (entries) {
        for (var i = 0; i < entries.length; i++) if (entries[i].isIntersecting) { io.disconnect(); start(); return; }
      }, { rootMargin: "300px 0px" });
      io.observe(root);
    } else {
      start();
    }
  }

  function build(root, plot, data, t) {
    var cols = data.points;
    var floorP = data.floor_p;
    var pts = cols.map(function (r, i) {
      var p = r[2];
      return {
        i: i, gene: r[0], c: r[1], p: p, q: r[3], n: r[4], flag: r[5], kind: r[6], symbol: r[7],
        product: r[8] >= 0 ? data.products[r[8]] : "", place: r[9] >= 0 ? data.places[r[9]] : "",
        uniprot: r[10], agree: r[11], guides: r[12] || [], accession: r[13] || ("TGGT1_" + r[0]),
        y: -Math.log10(p > 0 ? p : floorP), zero: p === 0
      };
    });
    var order = pts.slice().sort(function (a, b) { return a.c - b.c || a.y - b.y; });
    order.forEach(function (p, k) { p.rank = k; });

    var status = root.querySelector(".volcano-status");
    if (status) status.hidden = true;
    var live = root.querySelector(".volcano-live");
    var card = root.querySelector(".volcano-card");
    var tip = h("div", "volcano-tip", null, plot);
    tip.setAttribute("aria-hidden", "true");
    tip.hidden = true;

    var svg = el("svg", { "class": "volcano-svg", role: "group", tabindex: "-1", focusable: "false", "aria-label": t("plotLabel") }, plot);
    var active = null, selected = null, hover = null;
    var M = { l: 54, r: 14, t: 16, b: 46 };
    var geom = {};

    function title(p) {
      if (p.kind === "ctl") return t("controlTitle");
      return p.symbol || p.gene;
    }

    function pointLabel(p) {
      return title(p) + ", " + t("coef") + " " + fmtNum(p.c, 3) + ", " + t("p") + " " + fmtP(p.p, t("pZero")) + ", " + t("q") + " " + fmtP(p.q, t("pZero"));
    }

    function draw() {
      var W = Math.max(280, Math.round(plot.clientWidth || 600));
      var H = Math.round(Math.min(480, Math.max(330, W * 0.66)));
      var small = W < 480;
      M.l = small ? 44 : 54;
      var xs = pts.map(function (p) { return p.c; });
      var xmin = Math.min.apply(null, xs.concat([-data.cut])), xmax = Math.max.apply(null, xs.concat([data.cut]));
      var pad = (xmax - xmin) * 0.04;
      xmin -= pad; xmax += pad;
      var ymax = Math.max.apply(null, pts.map(function (p) { return p.y; })) * 1.1;
      var iw = W - M.l - M.r, ih = H - M.t - M.b;
      var X = function (v) { return M.l + ((v - xmin) / (xmax - xmin)) * iw; };
      var Y = function (v) { return M.t + ih - (v / ymax) * ih; };
      geom = { X: X, Y: Y, W: W, H: H };
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      svg.setAttribute("viewBox", "0 0 " + W + " " + H);
      svg.setAttribute("width", W);
      svg.setAttribute("height", H);

      var gAxes = el("g", { "class": "vol-axes", "aria-hidden": "true" }, svg);
      niceTicks(0, ymax, small ? 4 : 6).forEach(function (v) {
        el("line", { x1: M.l, x2: W - M.r, y1: Y(v), y2: Y(v), "class": "vol-grid" }, gAxes);
        el("text", { x: M.l - 6, y: Y(v), dy: "0.32em", "text-anchor": "end", "class": "vol-tick" }, gAxes).textContent = fmtNum(v, 3);
      });
      niceTicks(xmin, xmax, small ? 5 : 8).forEach(function (v) {
        el("line", { x1: X(v), x2: X(v), y1: M.t + ih, y2: M.t + ih + 4, "class": "vol-axis" }, gAxes);
        el("text", { x: X(v), y: M.t + ih + 16, "text-anchor": "middle", "class": "vol-tick" }, gAxes).textContent = fmtNum(v, 3);
      });
      el("line", { x1: M.l, x2: W - M.r, y1: M.t + ih, y2: M.t + ih, "class": "vol-axis" }, gAxes);
      el("line", { x1: M.l, x2: M.l, y1: M.t, y2: M.t + ih, "class": "vol-axis" }, gAxes);
      el("line", { x1: X(0), x2: X(0), y1: M.t, y2: M.t + ih, "class": "vol-zero" }, gAxes);
      el("text", { x: M.l + iw / 2, y: H - 6, "text-anchor": "middle", "class": "vol-label" }, gAxes).textContent = t("xLabel");
      el("text", { x: 0, y: 0, transform: "translate(13 " + (M.t + ih / 2) + ") rotate(-90)", "text-anchor": "middle", "class": "vol-label" }, gAxes).textContent = t("yLabel");

      [-data.cut, data.cut].forEach(function (v, k) {
        if (v <= xmin || v >= xmax) return;
        el("line", { x1: X(v), x2: X(v), y1: M.t, y2: M.t + ih, "class": "vol-cut" }, gAxes);
        if (k === 1) el("text", { x: X(v) - 4, y: M.t + 10, "text-anchor": "end", "class": "vol-note" }, gAxes).textContent = t("sigma");
      });
      if (data.critical_p) {
        var yc = Y(-Math.log10(data.critical_p));
        el("line", { x1: M.l, x2: W - M.r, y1: yc, y2: yc, "class": "vol-fdr" }, gAxes);
        el("text", { x: W - M.r - 2, y: yc - 5, "text-anchor": "end", "class": "vol-note" }, gAxes).textContent = t("fdr");
      }

      var gPts = el("g", { "class": "vol-points" }, svg);
      var drawOrder = pts.slice().sort(function (a, b) { return (a.flag - b.flag) || (a.y - b.y); });
      drawOrder.forEach(function (p) {
        var cls = "pt" + (p.flag & 2 ? " hit" : p.flag & 1 ? " called" : "");
        var node = el("circle", { cx: X(p.c), cy: Y(p.y), r: p.flag & 2 ? 6 : p.flag & 1 ? 5 : 3.6, "class": cls, tabindex: "-1", role: "button", "aria-label": pointLabel(p), "data-i": p.i }, gPts);
        p.node = node;
        p.px = X(p.c); p.py = Y(p.y);
      });

      var gLab = el("g", { "class": "vol-labels", "aria-hidden": "true" }, svg);
      pts.filter(function (p) { return p.flag & 1; }).sort(function (a, b) { return b.y - a.y; }).forEach(function (p) {
        var right = p.c >= 0;
        var tx = p.px + (right ? 9 : -9), ty = p.py + 4;
        var text = el("text", { x: tx, y: ty, "text-anchor": right ? "start" : "end", "class": "vol-tag" + (p.flag & 2 ? " hit" : "") }, gLab);
        text.textContent = p.symbol || p.gene;
        var w = text.getComputedTextLength ? text.getComputedTextLength() : 0;
        if (!right && tx - w < M.l + 2) { text.setAttribute("text-anchor", "start"); text.setAttribute("x", p.px + 9); }
        if (right && tx + w > W - M.r - 2) { text.setAttribute("text-anchor", "end"); text.setAttribute("x", p.px - 9); }
      });

      geom.ring = el("circle", { r: 9, "class": "vol-ring", "aria-hidden": "true", visibility: "hidden" }, svg);
      geom.sel = el("circle", { r: 10, "class": "vol-sel", "aria-hidden": "true", visibility: "hidden" }, svg);
      var first = active || order.reduce(function (a, b) { return b.y > a.y ? b : a; });
      setActive(first, false);
      if (selected) mark(geom.sel, selected);
      if (hover) showTip(hover);
    }

    function mark(node, p) {
      node.setAttribute("cx", p.px);
      node.setAttribute("cy", p.py);
      node.setAttribute("visibility", "visible");
    }

    function setActive(p, focus) {
      if (active && active.node) active.node.setAttribute("tabindex", "-1");
      active = p;
      p.node.setAttribute("tabindex", "0");
      if (focus) { p.node.focus({ preventScroll: true }); }
    }

    function showTip(p) {
      hover = p;
      mark(geom.ring, p);
      tip.textContent = "";
      h("b", null, p.symbol ? p.symbol + " · " + p.gene : title(p), tip);
      var rows = [[t("coef"), fmtNum(p.c, 3)], [t("p"), fmtP(p.p, t("pZero"))], [t("q"), fmtP(p.q, t("pZero"))]];
      rows.forEach(function (r) {
        var line = h("span", null, null, tip);
        h("span", "k", r[0], line);
        h("span", "v", r[1], line);
      });
      tip.hidden = false;
      var bw = tip.offsetWidth, bh = tip.offsetHeight;
      var x = p.px + 12, y = p.py - bh - 8;
      if (x + bw > geom.W - 2) x = p.px - bw - 12;
      if (x < 2) x = 2;
      if (y < 2) y = p.py + 12;
      tip.style.transform = "translate(" + Math.round(x) + "px," + Math.round(y) + "px)";
    }

    function hideTip() {
      hover = null;
      tip.hidden = true;
      if (geom.ring) geom.ring.setAttribute("visibility", "hidden");
    }

    function nearest(evt, radius) {
      var box = svg.getBoundingClientRect();
      var sx = geom.W / box.width;
      var mx = (evt.clientX - box.left) * sx, my = (evt.clientY - box.top) * sx;
      var best = null, bd = radius * radius;
      for (var i = 0; i < pts.length; i++) {
        var dx = pts[i].px - mx, dy = pts[i].py - my, d = dx * dx + dy * dy;
        if (d <= bd || (d === bd && best && pts[i].flag > best.flag)) { bd = d; best = pts[i]; }
      }
      return best;
    }

    function row(dl, k, v) {
      if (v === undefined || v === null || v === "") return;
      h("dt", null, k, dl);
      var dd = h("dd", null, null, dl);
      if (v.nodeType) dd.appendChild(v); else dd.textContent = v;
    }

    function link(href, text) {
      var a = document.createElement("a");
      a.href = href; a.textContent = text; a.rel = "noopener"; a.target = "_blank";
      return a;
    }

    function openCard(p) {
      if (!card) return;
      selected = p;
      mark(geom.sel, p);
      card.textContent = "";
      var head = h("div", "volcano-card-head", null, card);
      var hd = h("h3", null, title(p), head);
      hd.id = (root.id || "volcano") + "-card-title";
      var close = h("button", "btn volcano-close", t("close"), head);
      close.type = "button";
      close.addEventListener("click", function () { closeCard(true); });
      var sub = p.kind === "ctl" ? t("controlNote") : (p.product || t("noProduct")) + (p.symbol ? " · " + p.accession : "");
      h("p", "volcano-sub", sub, card);
      card.setAttribute("aria-labelledby", hd.id);

      if (p.kind !== "ctl") {
        h("h4", null, t("identity"), card);
        var dl = h("dl", null, null, card);
        row(dl, t("geneId"), p.accession);
        row(dl, t("product"), p.product);
        row(dl, t("symbol"), p.symbol);
        row(dl, t("localisation"), p.place);
      }
      h("h4", null, t("thisScreen"), card);
      var ds = h("dl", null, null, card);
      row(ds, t("effect"), fmtNum(p.c, 4));
      row(ds, t("pValue"), fmtP(p.p, t("pZero")) + (p.zero ? " " + t("zeroNote") : ""));
      row(ds, t("qValue"), fmtP(p.q, t("pZero")));
      row(ds, t("condition"), t({ pc: "condPc", nc: "condNc", ctl: "condCtl" }[p.kind] || "condOther"));
      row(ds, t("nGene"), p.n === null ? "" : String(p.n));
      if (p.guides.length) row(ds, t("guidesFitted"), String(p.guides.length));
      if (p.agree !== null && p.agree !== undefined) row(ds, t("guidesAgree"), fill(t("agreeOf"), { a: p.agree, b: p.guides.length }));

      if (p.guides.length) {
        h("h4", null, t("guidesHeading"), card);
        var wrap = h("div", "volcano-table", null, card);
        var table = h("table", null, null, wrap);
        var thead = h("thead", null, null, table);
        var tr = h("tr", null, null, thead);
        [t("guide"), t("coef"), t("p"), t("nGrna")].forEach(function (s, k) { var th = h("th", k ? "num" : null, s, tr); th.scope = "col"; });
        var tb = h("tbody", null, null, table);
        p.guides.slice().sort(function (a, b) { return a[2] - b[2]; }).forEach(function (g) {
          var r = h("tr", null, null, tb);
          var name = /^\d+$/.test(String(g[0])) ? p.gene + "_" + g[0] : String(g[0]);
          var th = h("th", null, name, r);
          th.scope = "row";
          var opposes = p.kind !== "ctl" && g[1] !== null && p.c !== null && (g[1] > 0) !== (p.c > 0);
          var cc = h("td", "num", signed(g[1]), r);
          if (opposes) { cc.className = "num opp"; h("span", "volcano-flag", " " + t("opposes"), cc); }
          h("td", "num", fmtP(g[2], t("pZero")), r);
          h("td", "num", g[3] === null ? "—" : String(g[3]), r);
        });
      }

      if (p.kind !== "ctl" && /^TG/.test(p.accession)) {
        h("h4", null, t("records"), card);
        var links = h("p", "volcano-links", null, card);
        links.appendChild(link("https://toxodb.org/toxo/app/record/gene/" + encodeURIComponent(p.accession), "ToxoDB " + p.accession));
        if (p.uniprot) {
          links.appendChild(document.createTextNode(" · "));
          links.appendChild(link("https://www.uniprot.org/uniprotkb/" + encodeURIComponent(p.uniprot) + "/entry", "UniProt " + p.uniprot));
        }
      }
      card.hidden = false;
      if (live) live.textContent = t("opened") + " " + title(p);
    }

    function closeCard(refocus) {
      if (!card || card.hidden) return false;
      card.hidden = true;
      card.textContent = "";
      if (geom.sel) geom.sel.setAttribute("visibility", "hidden");
      if (live) live.textContent = t("closed");
      if (refocus && selected) { setActive(selected, true); showTip(selected); }
      selected = null;
      return true;
    }

    function step(p, key) {
      if (key === "ArrowRight") return order[Math.min(order.length - 1, p.rank + 1)];
      if (key === "ArrowLeft") return order[Math.max(0, p.rank - 1)];
      if (key === "Home") return order[0];
      if (key === "End") return order[order.length - 1];
      var up = key === "ArrowUp", best = null, bd = Infinity;
      for (var i = 0; i < pts.length; i++) {
        var q = pts[i];
        var dy = p.py - q.py;
        if (up ? dy <= 0.5 : dy >= -0.5) continue;
        var d = Math.abs(dy) + 2.5 * Math.abs(q.px - p.px);
        if (d < bd) { bd = d; best = q; }
      }
      return best || p;
    }

    svg.addEventListener("keydown", function (e) {
      var i = e.target && e.target.getAttribute && e.target.getAttribute("data-i");
      if (i === null || i === undefined) return;
      var p = pts[+i];
      if (/^(Arrow(Up|Down|Left|Right)|Home|End)$/.test(e.key)) {
        e.preventDefault();
        var n = step(p, e.key);
        setActive(n, true);
        showTip(n);
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openCard(p);
      } else if (e.key === "Escape") {
        if (closeCard(false)) e.preventDefault();
        else hideTip();
      }
    });
    svg.addEventListener("focusin", function (e) {
      var i = e.target && e.target.getAttribute && e.target.getAttribute("data-i");
      if (i === null || i === undefined) return;
      var p = pts[+i];
      if (active !== p) setActive(p, false);
      showTip(p);
    });
    svg.addEventListener("focusout", function () { hideTip(); });
    svg.addEventListener("pointermove", function (e) {
      if (e.pointerType === "touch") return;
      var p = nearest(e, 14);
      if (p) { if (p !== hover) showTip(p); svg.style.cursor = "pointer"; }
      else if (hover && document.activeElement !== (active && active.node)) { hideTip(); svg.style.cursor = ""; }
      else svg.style.cursor = "";
    });
    svg.addEventListener("pointerleave", function () {
      if (!(active && document.activeElement === active.node)) hideTip();
    });
    svg.addEventListener("click", function (e) {
      var p = nearest(e, e.pointerType === "touch" ? 22 : 14);
      if (!p) return;
      setActive(p, true);
      showTip(p);
      openCard(p);
    });
    if (card) card.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { e.preventDefault(); closeCard(true); }
    });

    draw();
    var last = plot.clientWidth, timer = 0;
    var redraw = function () {
      if (plot.clientWidth === last || !plot.clientWidth) return;
      last = plot.clientWidth;
      clearTimeout(timer);
      timer = setTimeout(draw, 80);
    };
    if ("ResizeObserver" in window) new ResizeObserver(redraw).observe(plot);
    else window.addEventListener("resize", redraw);
  }

  function boot() {
    var roots = document.querySelectorAll("[data-volcano]");
    for (var i = 0; i < roots.length; i++) {
      try { init(roots[i]); } catch (err) { if (window.console) console.error(err); }
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
