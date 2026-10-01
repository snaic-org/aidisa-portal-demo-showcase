// AiDiSA sentiment dashboard - a static recreation of the Power BI report
// "Sentiment_Analysis_v4" (MRT/LRT Overview page plus its drill-through
// pages). Layout, colours and text come from the report definition; every
// position below is in Power BI's 1280x720 canvas space.
//
// Data comes from data.js (synthetic, see tools/build_dashboard_data.py).
// Individual drill-down cases, their titles and descriptions are generated
// here from that synthetic data - none of them are real.

(function () {
  "use strict";

  var D = window.DASHBOARD_DATA;
  var C = D.cols;
  var N = C.n.length;
  var DAY_MS = 86400000;
  var START = new Date(D.meta.start + "T00:00:00");

  var COLORS = ["#D9534F", "#D97B4F", "#F0DB4F", "#8EB85C", "#5CB85C"];
  var NAMES = ["1-Very Negative", "2-Negative", "3-Neutral", "4-Positive", "5-Very Positive"];
  var GAUGE_BANDS = ["#B60600", "#FF5400", "#F0DB4F", "#5CB85C"];
  var ACCENT = "#0D6ABF";
  var INK = "#252423";
  var INK2 = "#605E5C";
  var FONT = "Barlow, DIN, 'Segoe UI', helvetica, arial, sans-serif";
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  // Tooltips copied from the report's buttons.
  var HELP = {
    sub: "This chart shows the number of report and the number of sentiment for each subcategory",
    pie: "This sentiment label proportions shows you the number of sentiment in each sentiment band based on the filtered data on this page.",
    gauge: "This feedback sentiment intensity shows you sentiment ranging from 1-5 based on the filtered data on this page.",
    map: "This sentiment map shows the sentiment of each MRT and LRT station with their respective colors. The more red the point is, the more negative the feedback; the more green, the more positive.",
    time: "This sentiment timeline shows you the sentiment over the number of reports daily based on the filtered data on this page. Click a coloured segment to show only that sentiment across all days; click the blue line or a date to select a day.",
    table: "This table shows the raw report from CDE. Click a row to see its full description and sentiment below.",
    daily: "Allows you to view the chart in a daily format based on the selected date range at the top.",
    monthly: "Allows you to view the chart in a monthly format based on the selected date range at the top.",
    toggle: "To toggle between Feedback volume and Sentiment Score Trend in this chart",
    all: "All",
    station: "Without \"TRN\" and \"blanks\" incident at",
    train: "only \"TRN\" Incident At",
    other: "only \"blanks\" Incident At",
    clear: "Clear all slicers on this page",
    drillFilter: "Open the raw reports for the current filters",
    drillDay: "Select a day in the timeline, then drill down to that day's reports",
    drillStation: "Select a station on the map, then drill down to that station's reports"
  };

  var state = {
    division: -1, station: -1, main: -1, sub: -1, subsub: -1, type: "all",
    from: 31, to: 58,
    sel: null,
    day: -1, // selected day on the timeline; combines with sel
    pin: -1, // station picked on the map; combines with sel and day
    timeMode: "day", timeMetric: "volume",
    drill: null,
    row: null
  };
  var DEFAULT_RANGE = { from: 31, to: 58 };

  var scale = 1;

  // ---------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------
  function $(id) { return document.getElementById(id); }
  function pad(n, w) { return String(n).padStart(w || 2, "0"); }
  function dayDate(i) { return new Date(START.getTime() + i * DAY_MS); }
  function dayIndex(date) { return Math.round((date - START) / DAY_MS); }
  function isoDay(i) { var d = dayDate(i); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function usDate(d) { return (d.getMonth() + 1) + "/" + d.getDate() + "/" + d.getFullYear(); }
  function usDateTime(d) {
    var h = d.getHours(), ampm = h >= 12 ? "PM" : "AM";
    h = h % 12 || 12;
    return usDate(d) + " " + h + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds()) + " " + ampm;
  }
  function escapeHtml(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  // Power BI "Auto" display units: once the largest value reaches the
  // thousands, every label is shown in K with up to two decimals.
  function fmtK(v, forceK) {
    if (v < 1000 && !forceK) return String(v);
    return (Math.round(v / 10) / 100) + "K";
  }
  function labelText(avg) { return NAMES[Math.min(4, Math.max(0, Math.round(avg) - 1))]; }
  function bandColor(avg) {
    if (avg >= 4) return COLORS[4];
    if (avg >= 3) return COLORS[2];
    if (avg >= 2) return COLORS[1];
    return COLORS[0];
  }
  function stationName(code) {
    var s = D.stations[code];
    if (s) return s.name;
    return code === "TRN" ? "Trains" : code;
  }

  function hexRgb(h) { return [1, 3, 5].map(function (i) { return parseInt(h.slice(i, i + 2), 16); }); }
  var MAP_STOPS = [hexRgb("#D9534F"), hexRgb("#F0DB4F"), hexRgb("#5CB85C")];
  function mapColor(avg) {
    var x = (Math.min(5, Math.max(1, avg)) - 1) / 2;
    var i = Math.min(1, Math.floor(x)), t = x - i;
    var a = MAP_STOPS[i], b = MAP_STOPS[i + 1];
    return "rgb(" + a.map(function (v, k) { return Math.round(v + (b[k] - v) * t); }).join(",") + ")";
  }
  function darker(rgb, f) {
    var m = rgb.match(/\d+/g).map(Number);
    return "rgb(" + m.map(function (v) { return Math.round(v * f); }).join(",") + ")";
  }

  // Positioned element in canvas units.
  function V(parent, x, y, w, h, cls, html, fs) {
    var d = document.createElement("div");
    d.className = "v" + (cls ? " " + cls : "") + (fs ? " t" : "");
    d.style.cssText = "--x:" + x + ";--y:" + y + ";--w:" + w + ";--h:" + h + (fs ? ";--fs:" + fs : "");
    if (html != null) d.innerHTML = html;
    parent.appendChild(d);
    return d;
  }

  function titles(parent, x, y, w, title, sub, center) {
    V(parent, x + 10, y + 5, w - 20, 18, "vt" + (center ? " center" : ""), title, 14);
    return V(parent, x + 10, y + 23, w - 20, 14, "vs" + (center ? " center" : ""), sub, 10.67);
  }

  var HELP_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10.2" fill="none" stroke="#252423" stroke-width="1.7"/>' +
    '<path d="M9.3 9.4a2.8 2.8 0 1 1 4.2 2.4c-.9.5-1.5 1.1-1.5 2.1v.5" fill="none" stroke="#252423" stroke-width="1.7" stroke-linecap="round"/>' +
    '<circle cx="12" cy="17.2" r="1.05" fill="#252423"/></svg>';
  var CHEVRON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 5.5l5.5 5.5 5.5-5.5" fill="none" stroke="#252423" stroke-width="1.1"/></svg>';
  var CALENDAR = '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="3" width="12" height="11" fill="none" stroke="#252423" stroke-width="1"/>' +
    '<path d="M2 6h12M5 1.5v3M11 1.5v3" stroke="#252423" stroke-width="1"/><path d="M4.5 8h1M7.5 8h1M10.5 8h1M4.5 10.5h1M7.5 10.5h1M10.5 10.5h1" stroke="#252423" stroke-width="1"/></svg>';

  function helpButton(parent, x, y, w, h, text) {
    var b = V(parent, x, y, w, h, "help", HELP_SVG);
    attachTip(b, function () { return escapeHtml(text); });
    return b;
  }

  function button(parent, x, y, w, h, cls, label, tipText, onClick) {
    var b = V(parent, x, y, w, h, "btn " + (cls || ""), escapeHtml(label), 12);
    if (tipText) attachTip(b, function () { return escapeHtml(tipText); });
    if (onClick) b.addEventListener("click", function () { if (!b.classList.contains("disabled")) onClick(); });
    return b;
  }

  // ---------------------------------------------------------------------
  // Tooltip
  // ---------------------------------------------------------------------
  var tipEl;
  function showTip(html, x, y) {
    tipEl.innerHTML = html;
    tipEl.hidden = false;
    var r = tipEl.getBoundingClientRect();
    var left = Math.min(window.innerWidth - r.width - 8, x + 14);
    var top = y + 16 + r.height > window.innerHeight ? y - r.height - 10 : y + 16;
    tipEl.style.left = Math.max(8, left) + "px";
    tipEl.style.top = Math.max(8, top) + "px";
  }
  function hideTip() { tipEl.hidden = true; }
  function attachTip(el, fn) {
    el.addEventListener("mousemove", function (e) { showTip(fn(), e.clientX, e.clientY); });
    el.addEventListener("mouseleave", hideTip);
  }
  function tipRows(rows) {
    return rows.map(function (r) { return '<div class="tt-r"><span class="tt-k">' + escapeHtml(r[0]) + "</span><b>" + escapeHtml(r[1]) + "</b></div>"; }).join("");
  }
  var echartsTip = {
    backgroundColor: "#fff", borderWidth: 0, padding: [7, 10],
    textStyle: { color: INK, fontSize: 12, fontFamily: FONT },
    extraCssText: "box-shadow:0 2px 10px rgba(0,0,0,.25);border-radius:4px;"
  };

  // ---------------------------------------------------------------------
  // Filtering
  // ---------------------------------------------------------------------
  function selMatch(i, sel) {
    if (sel.kind === "label") return C.l[i] === sel.l;
    if (sel.kind === "sub") return C.s[i] === sel.s && C.l[i] === sel.l;
    return true;
  }

  function matches(i, skip, useSel, useDay, usePin) {
    if (C.d[i] < state.from || C.d[i] > state.to) return false;
    if (skip !== "division" && state.division >= 0 && C.v[i] !== state.division) return false;
    if (skip !== "station" && state.station >= 0 && C.a[i] !== state.station) return false;
    if (state.type !== "all" && D.incident_type[C.a[i]] !== state.type) return false;
    if (skip !== "main" && state.main >= 0 && C.m[i] !== state.main) return false;
    if (skip !== "main" && skip !== "sub" && state.sub >= 0 && C.s[i] !== state.sub) return false;
    if (skip !== "main" && skip !== "sub" && skip !== "subsub" && state.subsub >= 0 && C.ss[i] !== state.subsub) return false;
    if (useSel && state.sel && !selMatch(i, state.sel)) return false;
    if (useDay && state.day >= 0 && C.d[i] !== state.day) return false;
    if (usePin && state.pin >= 0 && C.a[i] !== state.pin) return false;
    return true;
  }

  function aggregate(useSel, useDay, usePin) {
    var agg = { total: 0, sum: 0, labels: [0, 0, 0, 0, 0], bySub: {}, byStation: {}, byDay: {} };
    for (var i = 0; i < N; i++) {
      if (!matches(i, null, useSel, useDay, usePin)) continue;
      var n = C.n[i], l = C.l[i];
      agg.total += n;
      agg.sum += n * l;
      agg.labels[l - 1] += n;
      (agg.bySub[C.s[i]] || (agg.bySub[C.s[i]] = [0, 0, 0, 0, 0]))[l - 1] += n;
      var st = agg.byStation[C.a[i]] || (agg.byStation[C.a[i]] = { n: 0, sum: 0 });
      st.n += n;
      st.sum += n * l;
      (agg.byDay[C.d[i]] || (agg.byDay[C.d[i]] = [0, 0, 0, 0, 0]))[l - 1] += n;
    }
    return agg;
  }

  // ---------------------------------------------------------------------
  // Slicers (shared by every page)
  // ---------------------------------------------------------------------
  var slicers = [];

  function slicerOptions(kind) {
    var present = {};
    var col = { division: "v", station: "a", main: "m", sub: "s", subsub: "ss" }[kind];
    for (var i = 0; i < N; i++) if (matches(i, kind, false)) present[C[col][i]] = true;
    var dim = { division: "division", station: "incident_at", main: "main", sub: "sub", subsub: "subsub" }[kind];
    return D.dims[dim].map(function (v, i) {
      return [i, kind === "station" ? stationName(v) : v];
    }).filter(function (o) { return present[o[0]] || state[kind] === o[0]; })
      .sort(function (a, b) { return String(a[1]).localeCompare(String(b[1])); });
  }

  function slicer(parent, x, y, w, title, kind) {
    V(parent, x + 5, y + 5, w - 10, 14, "slicer-title", title, 10.67);
    var box = V(parent, x + 8, y + 27, w - 23, 24, "slicer-box", "<span>All</span>" + CHEVRON + "<select></select>", 12);
    var select = box.querySelector("select");
    select.setAttribute("aria-label", title);
    select.addEventListener("change", function () {
      state[kind] = Number(select.value);
      if (kind === "main") { state.sub = -1; state.subsub = -1; }
      if (kind === "sub") state.subsub = -1;
      state.sel = null;
      state.day = -1;
      state.pin = -1;
      state.row = null;
      renderAll();
    });
    slicers.push({ kind: kind, select: select, span: box.querySelector("span") });
  }

  function dateSlicer(parent, x, y, w) {
    V(parent, x + 5, y + 5, w - 10, 14, "slicer-title", "DATE RANGE", 10.67);
    ["from", "to"].forEach(function (key, k) {
      var box = V(parent, x + 2 + k * 101, y + 23, 94, 26, "slicer-box date", "<span></span>" + CALENDAR + '<input type="date">', 12);
      var input = box.querySelector("input");
      input.setAttribute("aria-label", key === "from" ? "Start date" : "End date");
      input.min = isoDay(0);
      input.max = isoDay(D.meta.days - 1);
      box.addEventListener("click", function () { try { input.showPicker(); } catch (e) { /* older browsers */ } });
      input.addEventListener("change", function () {
        if (!input.value) return;
        var idx = Math.max(0, Math.min(D.meta.days - 1, dayIndex(new Date(input.value + "T00:00:00"))));
        state[key] = idx;
        if (state.from > state.to) { var t = state.from; state.from = state.to; state.to = t; }
        state.sel = null;
        state.day = -1;
        state.pin = -1;
        state.row = null;
        renderAll();
      });
      slicers.push({ kind: key, input: input, span: box.querySelector("span") });
    });
  }

  function renderSlicers() {
    var cache = {};
    slicers.forEach(function (sl) {
      if (sl.kind === "from" || sl.kind === "to") {
        sl.span.textContent = usDate(dayDate(state[sl.kind]));
        sl.input.value = isoDay(state[sl.kind]);
        return;
      }
      var opts = cache[sl.kind] || (cache[sl.kind] = slicerOptions(sl.kind));
      sl.select.innerHTML = '<option value="-1">All</option>' + opts.map(function (o) {
        return '<option value="' + o[0] + '">' + escapeHtml(o[1]) + "</option>";
      }).join("");
      sl.select.value = String(state[sl.kind]);
      var chosen = opts.find(function (o) { return o[0] === state[sl.kind]; });
      sl.span.textContent = chosen ? chosen[1] : "All";
    });
  }

  // ---------------------------------------------------------------------
  // Overview page
  // ---------------------------------------------------------------------
  var ov = {};
  var charts = {};

  function buildOverview() {
    var P = $("pageOverview");

    // The AiDiSA wordmark lives in the portal navbar, not on the canvas.

    // Filter bar
    V(P, 16, 64, 1248, 120, "card");
    V(P, 20, 64, 80, 40, "pad b", "FILTER", 14);
    button(P, 28, 95, 88, 24, "", "Clear All", HELP.clear, clearAll);
    slicer(P, 120, 65, 180, "PARENT CASE DIVISIONS", "division");
    slicer(P, 304, 65, 180, "STATION", "station");
    slicer(P, 487, 65, 180, "MAIN CATEGORY", "main");
    slicer(P, 671, 65, 180, "SUB CATEGORY", "sub");
    slicer(P, 855, 65, 180, "SUB SUB CATEGORY", "subsub");
    dateSlicer(P, 1032, 65, 224);

    V(P, 20, 120, 96, 56, "pad b", "INCIDENT AT FILTER", 14);
    ov.quick = [["all", "All"], ["station", "Stations"], ["train", "Trains"], ["other", "Others"]].map(function (q, i) {
      var b = button(P, 128 + i * 120, 136, 100, 32, "quick", q[1], HELP[q[0]], function () {
        state.type = q[0];
        state.station = -1;
        state.sel = null;
        state.day = -1;
        state.pin = -1;
        renderAll();
      });
      b.style.setProperty("--fs", 14);
      b.dataset.type = q[0];
      return b;
    });

    V(P, 620, 126, 325, 45, "note");
    V(P, 634, 133, 58, 31, "b center", "NOTE!", 14.67).style.lineHeight = "calc(31 * var(--u))";
    V(P, 695, 131, 245, 36, "", "This is a demo using synthetic data for illustrative purposes only..", 12);

    button(P, 1080, 136, 160, 32, "", "Drilldown based on Filter", HELP.drillFilter, function () { location.hash = "#drill"; });

    // Sentiment of reports in subcategory
    V(P, 16, 190, 512, 240, "card");
    titles(P, 16, 190, 512, "SENTIMENT OF REPORTS IN SUBCATEGORY", "NUMBER OF REPORT IN EACH SENTIMENT BAND");
    helpButton(P, 488, 198, 32, 32, HELP.sub);
    ov.subLegend = V(P, 26, 234, 500, 14, "legend", legendHtml(false), 10.67);
    charts.sub = echarts.init(V(P, 16, 248, 512, 182));

    // Sentiment label proportions
    V(P, 536, 190, 360, 240, "card");
    titles(P, 536, 190, 360, "SENTIMENT LABEL PROPORTIONS", "NUMBER OF FEEDBACK IN EACH SENTIMENT BAND", true);
    helpButton(P, 544, 198, 33, 32, HELP.pie);
    charts.pie = echarts.init(V(P, 528, 228, 244, 202));
    ov.pieLegend = V(P, 772, 225, 118, 150, "pie-legend", "", 12);

    // Feedback sentiment intensity
    V(P, 904, 190, 360, 240, "card");
    titles(P, 904, 190, 360, "FEEDBACK SENTIMENT INTENSITY", "AVERAGE OF SENITMENT FEEDBACKS", true);
    ov.gauge = V(P, 904, 190, 360, 240);
    helpButton(P, 914, 198, 32, 32, HELP.gauge);

    // Station-based sentiment map
    V(P, 16, 440, 512, 264, "card");
    titles(P, 16, 440, 512, "STATION-BASED SENTIMENT MAP", "SHOWING SENTIMENT RADER FOR STATIONS ONLY");
    ov.drillStation = button(P, 306, 445, 160, 32, "disabled", "Drilldown to MRT station", HELP.drillStation, function () {
      if (state.pin >= 0) location.hash = "#station/" + encodeURIComponent(D.dims.incident_at[state.pin]);
    });
    helpButton(P, 480, 448, 48, 32, HELP.map);
    ov.mapEl = V(P, 26, 479, 487, 208, "map");
    ov.mapMsg = V(P, 26, 479, 487, 208, "map-msg",
      "Map is only used for feedback relating to stations, please select ALL or STATIONS button at the top bar to view.", 18.67);

    // Sentiment timeline
    V(P, 536, 440, 728, 264, "card");
    ov.timeTitle = V(P, 546, 445, 300, 18, "vt", "", 14);
    ov.timeSub = V(P, 546, 463, 300, 14, "vs", "", 10.67);
    V(P, 784, 449, 22, 22, "center", "&#8987;", 15);
    var pill = V(P, 808, 452, 32, 16, "pill");
    ov.knob = V(P, 808, 450, 20, 20, "knob");
    V(P, 843, 449, 22, 22, "center", "&#128202;", 15);
    attachTip(pill, function () { return escapeHtml(HELP.toggle); });
    pill.addEventListener("click", function () {
      state.timeMetric = state.timeMetric === "volume" ? "score" : "volume";
      renderTimelineOnly();
    });
    ov.daily = button(P, 874, 445, 112, 32, "", "Daily View", HELP.daily, function () { state.timeMode = "day"; renderTimelineOnly(); });
    ov.monthly = button(P, 990, 445, 112, 32, "", "Monthly View", HELP.monthly, function () {
      state.timeMode = "month";
      state.day = -1;
      renderOverview(false);
    });
    ov.drillDay = button(P, 1107, 445, 112, 32, "disabled", "Drilldown to day", HELP.drillDay, function () {
      if (state.day >= 0) location.hash = "#day/" + isoDay(state.day);
    });
    helpButton(P, 1224, 445, 32, 32, HELP.time);
    ov.timeLegend = V(P, 546, 481, 700, 14, "legend", "", 10.67);
    charts.time = echarts.init(V(P, 536, 492, 728, 212));

    ov.subLegend.addEventListener("click", legendClick);
    ov.timeLegend.addEventListener("click", legendClick);
    ov.pieLegend.addEventListener("click", legendClick);

    charts.sub.on("click", function (p) {
      if (p.componentType !== "series") return;
      var s = ov.subOrder[p.dataIndex];
      toggleSel({ kind: "sub", s: s, l: p.seriesIndex + 1 });
    });
    charts.pie.on("click", function (p) { toggleSel({ kind: "label", l: p.data.l }); });
    charts.time.on("click", function (p) {
      // Coloured segment: show that sentiment for every day.
      if (p.componentType === "series" && state.timeMetric === "volume" && p.seriesIndex < NAMES.length) {
        toggleSel({ kind: "label", l: p.seriesIndex + 1 });
        return;
      }
      // Blue line, score bar or date label: select that day (daily view only).
      if (state.timeMode !== "day") return;
      var idx = p.componentType === "xAxis" ? ov.points.findIndex(function (x) { return x.label === p.value; }) : p.dataIndex;
      var pt = ov.points[idx];
      if (pt) toggleDay(pt.key);
    });

    initMap();
  }

  function legendHtml(withCount, avg) {
    var html = "<b>SENTIMENT</b>";
    if (!avg) html += NAMES.map(function (n, k) { return '<span data-l="' + (k + 1) + '"><i style="background:' + COLORS[k] + '"></i>' + n + "</span>"; }).join("");
    if (withCount) html += '<span><i style="background:' + ACCENT + '"></i>' + (avg ? "Average of label" : "Count of label") + "</span>";
    return html;
  }

  function legendClick(e) {
    var item = e.target.closest("[data-l]");
    if (item) toggleSel({ kind: "label", l: Number(item.getAttribute("data-l")) });
  }

  function toggleSel(sel) {
    var cur = state.sel;
    var same = cur && cur.kind === sel.kind && cur.l === sel.l && cur.s === sel.s && cur.a === sel.a;
    state.sel = same ? null : sel;
    renderOverview();
  }

  function togglePin(a) {
    state.pin = state.pin === a ? -1 : a;
    renderOverview();
  }

  function toggleDay(d) {
    state.day = state.day === d ? -1 : d;
    renderOverview();
  }

  function clearAll() {
    state.division = state.station = state.main = state.sub = state.subsub = -1;
    state.type = "all";
    state.from = DEFAULT_RANGE.from;
    state.to = DEFAULT_RANGE.to;
    state.sel = null;
    state.day = -1;
    state.pin = -1;
    renderAll();
  }

  // ----- subcategory chart ---------------------------------------------
  function renderSub(agg) {
    var s = scale;
    var sel = state.sel && state.sel.kind === "sub" ? state.sel : null;
    var labelSel = state.sel && state.sel.kind === "label" ? state.sel.l : 0;
    var subs = Object.keys(agg.bySub).map(Number).map(function (k) {
      var c = agg.bySub[k];
      return { s: k, counts: c, total: c.reduce(function (a, b) { return a + b; }, 0) };
    }).sort(function (a, b) { return b.total - a.total; });
    ov.subOrder = subs.map(function (x) { return x.s; });
    var max = Math.max.apply(null, subs.map(function (x) { return Math.max.apply(null, x.counts); }).concat([1]));
    var interval = niceStep(max / 2.5);

    charts.sub.setOption({
      animation: false,
      textStyle: { fontFamily: FONT },
      grid: { left: 163 * s, right: 21 * s, top: 21 * s, bottom: 50 * s },
      tooltip: Object.assign({ trigger: "item", formatter: function (p) {
        var x = subs[p.dataIndex];
        return tipRows([["Subcategory", D.dims.sub[x.s]], ["Sentiment", NAMES[p.seriesIndex]], ["Count of label", p.value.toLocaleString()]]);
      } }, echartsTip),
      xAxis: {
        type: "value", min: 0, interval: interval, max: function (v) { return Math.max(interval, v.max * 1.1); },
        axisLabel: { fontSize: 10.67 * s, color: INK2, fontWeight: "bold", showMaxLabel: false, formatter: function (v) { return v >= 1000 || interval >= 1000 ? v / 1000 + "K" : v; } },
        splitLine: { lineStyle: { type: [1 * s, 3 * s], color: "#7D7C7B" } },
        axisLine: { show: false }, axisTick: { show: false },
        name: "REPORT COUNTS", nameLocation: "middle", nameGap: 22 * s, nameTextStyle: { fontSize: 12 * s, color: INK }
      },
      yAxis: {
        type: "category", inverse: true, data: subs.map(function (x) { return D.dims.sub[x.s]; }),
        axisLabel: { fontSize: 10.67 * s, color: INK2, width: 125 * s, overflow: "truncate", margin: 9 * s },
        axisTick: { show: false }, axisLine: { show: false },
        name: "SUBCATEGORY", nameLocation: "middle", nameGap: 143 * s, nameRotate: 90, nameTextStyle: { fontSize: 12 * s, color: INK }
      },
      dataZoom: subs.length > 5 ? [
        { type: "slider", yAxisIndex: 0, right: 3 * s, width: 7 * s, top: 21 * s, bottom: 50 * s, startValue: 0, endValue: 4, zoomLock: true,
          showDetail: false, showDataShadow: false, brushSelect: false, handleSize: 0, moveHandleSize: 0,
          fillerColor: "#C8C6C4", borderColor: "transparent", backgroundColor: "transparent", handleStyle: { opacity: 0 } },
        { type: "inside", yAxisIndex: 0, zoomLock: true, moveOnMouseWheel: true, zoomOnMouseWheel: false }
      ] : [],
      series: NAMES.map(function (name, k) {
        return {
          name: name, type: "bar", barGap: "0%", barCategoryGap: "24%",
          itemStyle: { color: COLORS[k] },
          data: subs.map(function (x) {
            var dim = (sel && !(sel.s === x.s && sel.l === k + 1)) || (labelSel && labelSel !== k + 1);
            return { value: x.counts[k], itemStyle: dim ? { opacity: 0.35 } : null };
          })
        };
      })
    }, true);
  }

  function niceStep(raw) {
    if (raw <= 0) return 1;
    var p = Math.pow(10, Math.floor(Math.log10(raw)));
    var m = raw / p;
    return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
  }

  // ----- pie ----------------------------------------------------------
  function renderPie(agg) {
    var s = scale;
    var sel = state.sel && state.sel.kind === "label" ? state.sel.l : 0;
    var data = [4, 3, 2, 1, 0].map(function (k) {
      return { name: NAMES[k], value: agg.labels[k], l: k + 1, itemStyle: { color: COLORS[k], opacity: sel && sel !== k + 1 ? 0.35 : 1 } };
    });
    var total = agg.total || 1;
    var inK = Math.max.apply(null, agg.labels) >= 1000;
    charts.pie.setOption({
      animation: false,
      textStyle: { fontFamily: FONT },
      tooltip: Object.assign({ trigger: "item", formatter: function (p) {
        return tipRows([["label name", p.name], ["Count of label", p.value.toLocaleString()]]);
      } }, echartsTip),
      series: [{
        type: "pie", radius: [0, 69 * s], center: [126 * s, 98 * s], startAngle: 90, clockwise: true,
        minShowLabelAngle: 3,
        label: {
          color: INK2, fontSize: 12 * s, lineHeight: 16 * s, fontFamily: FONT, overflow: "none", edgeDistance: 2,
          formatter: function (p) {
            var pct = (p.value / total * 100).toFixed(2) + "%";
            return p.value / total < 0.05 ? fmtK(p.value, inK) + " (" + pct + ")" : fmtK(p.value, inK) + "\n(" + pct + ")";
          }
        },
        labelLine: { length: 7 * s, length2: 9 * s, lineStyle: { color: "#A19F9D", width: 1 } },
        data: data
      }]
    }, true);

    ov.pieLegend.innerHTML = '<div class="b" style="height:calc(19 * var(--u));font-size:calc(12.5 * var(--u))">Sentiment Labels</div>' +
      [4, 3, 2, 1, 0].map(function (k) {
        return '<div class="row' + (sel && sel !== k + 1 ? " off" : "") + '" data-l="' + (k + 1) + '"><i style="background:' + COLORS[k] + '"></i><span>' + NAMES[k] + "</span></div>";
      }).join("");
  }

  // ----- gauge (Tachometer custom visual) --------------------------------
  function renderGauge(agg) {
    var avg = agg.total ? agg.sum / agg.total : 0;
    var cx = 173.5, cy = 150, R = 89, r = 45;
    function pt(value, rad) {
      var a = (-120 + (value - 1) / 4 * 240) * Math.PI / 180;
      return [cx + rad * Math.sin(a), cy - rad * Math.cos(a)];
    }
    function arc(v0, v1, R1, r1, color) {
      var p0 = pt(v0, R1), p1 = pt(v1, R1), q1 = pt(v1, r1), q0 = pt(v0, r1);
      return '<path d="M' + p0 + " A" + R1 + " " + R1 + " 0 0 1 " + p1 + " L" + q1 + " A" + r1 + " " + r1 + " 0 0 0 " + q0 + 'Z" fill="' + color + '"/>';
    }
    var svg = [];
    GAUGE_BANDS.forEach(function (c, i) { svg.push(arc(i + 1, i + 2, R, r, c)); });
    // base ring
    var b0 = pt(1, 17), b1 = pt(5, 17);
    svg.push('<path d="M' + b0 + " A17 17 0 1 1 " + b1 + '" fill="none" stroke="#808080" stroke-width="5"/>');
    if (agg.total) {
      var n0 = pt(avg, 18), n1 = pt(avg, 71);
      svg.push('<line x1="' + n0[0] + '" y1="' + n0[1] + '" x2="' + n1[0] + '" y2="' + n1[1] + '" stroke="' + ACCENT + '" stroke-width="2.6" stroke-linecap="round"/>');
    }
    function text(x, y, t, size, color, weight, anchor) {
      return '<text x="' + x + '" y="' + y + '" font-size="' + size + '" fill="' + color + '" font-weight="' + (weight || 400) +
        '" text-anchor="' + (anchor || "middle") + '" dominant-baseline="middle" font-family="' + FONT.replace(/"/g, "'") + '">' + t + "</text>";
    }
    svg.push(text(77, 94, "2.00", 12, INK2), text(267, 94, "4.00", 12, INK2), text(77, 198, "1.00", 12, INK2), text(267, 198, "5.00", 12, INK2));
    svg.push(text(173, 48, "Neutral", 12, "#A38600", 700), text(59, 116, "Negative", 12, "#A1343C", 700), text(282, 118, "Positive", 12, "#32A83C", 700));
    svg.push(text(63, 213, "V. Negative", 12, "#A1343C", 700), text(273, 213, "V. Positive", 12, "#32A83C", 700));
    svg.push(text(173, 86, "&#128528;", 21), text(108, 152, "&#128577;", 21), text(236, 152, "&#128512;", 21));
    svg.push(text(172, 197, agg.total ? avg.toFixed(2) : "(Blank)", 26.7, INK, 500));
    svg.push(text(172, 219, agg.total ? labelText(avg) : "", 12, INK, 700));
    ov.gauge.innerHTML = '<svg viewBox="0 0 360 240" width="100%" height="100%" aria-label="Average sentiment ' + avg.toFixed(2) + '">' + svg.join("") + "</svg>";
  }

  // ----- map --------------------------------------------------------------
  var map, bubbleLayer;

  function initMap() {
    map = L.map(ov.mapEl, { zoomControl: false, zoomSnap: 0, zoomDelta: 0.5, scrollWheelZoom: true, attributionControl: true });
    L.control.zoom({ position: "topright", zoomInTitle: "Zoom in", zoomOutTitle: "Zoom out" }).addTo(map);
    // Esri street tiles need no API key and serve pages opened from disk too.
    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}", {
      maxZoom: 18,
      attribution: "Tiles &copy; Esri - Esri, HERE, Garmin, OpenStreetMap contributors"
    }).addTo(map);
    map.setView([1.3521, 103.8198], 11);
    bubbleLayer = L.layerGroup().addTo(map);
  }

  function renderMap(agg, refit) {
    var stationsOnly = state.type === "all" || state.type === "station";
    ov.mapMsg.hidden = stationsOnly;
    ov.mapEl.style.visibility = stationsOnly ? "visible" : "hidden";
    bubbleLayer.clearLayers();
    var sel = state.pin;
    var pts = [];
    Object.keys(agg.byStation).map(Number).forEach(function (a) {
      var code = D.dims.incident_at[a];
      var info = D.stations[code];
      if (!info) return;
      var st = agg.byStation[a];
      var avg = st.sum / st.n;
      var fill = mapColor(avg);
      var m = L.circleMarker([info.lat, info.lng], {
        radius: 7.5 * scale, color: darker(fill, 0.72), weight: 1.2 * scale, fillColor: fill,
        fillOpacity: sel >= 0 && sel !== a ? 0.25 : 0.85, opacity: sel >= 0 && sel !== a ? 0.3 : 1
      });
      m.on("mousemove", function (e) {
        showTip(tipRows([["station_name", info.name], ["Average of label", avg.toFixed(2)], ["Count of label", st.n.toLocaleString()]]),
          e.originalEvent.clientX, e.originalEvent.clientY);
      });
      m.on("mouseout", hideTip);
      m.on("click", function (e) { L.DomEvent.stopPropagation(e); togglePin(a); });
      m.addTo(bubbleLayer);
      pts.push([info.lat, info.lng]);
    });
    // Same framing as the report's Bing map: all of Singapore plus Johor Bahru.
    if (refit) map.setView([1.40, 103.84], 9.85 + Math.log2(scale), { animate: false });
  }

  // ----- timeline -----------------------------------------------------------
  function renderTimeline(agg) {
    var s = scale;
    var daily = state.timeMode === "day";
    var score = state.timeMetric === "score";
    var sel = state.day;
    ov.timeTitle.textContent = "SENTIMENT TIMELINE (" + (daily ? "DAILY" : "MONTHLY") + ")";
    ov.timeSub.textContent = score ? "SENTIMENT SCORE TREND" : "FEEDBACK VOLUME TREND";
    ov.knob.style.setProperty("--x", score ? 820 : 808);
    ov.daily.className = "v btn t " + (daily ? "solid" : "soft");
    ov.monthly.className = "v btn t " + (daily ? "soft" : "solid");
    ov.timeLegend.innerHTML = legendHtml(daily || score, score);

    var points = [];
    if (daily) {
      for (var d = state.from; d <= state.to; d++) {
        var dt = dayDate(d);
        points.push({ key: d, label: MONTHS[dt.getMonth()] + " " + pad(dt.getDate()), sunday: dt.getDay() === 0, counts: agg.byDay[d] || [0, 0, 0, 0, 0] });
      }
    } else {
      var months = {};
      Object.keys(agg.byDay).forEach(function (d) {
        var dt = dayDate(Number(d)), key = dt.getFullYear() * 12 + dt.getMonth();
        var m = months[key] || (months[key] = [0, 0, 0, 0, 0]);
        agg.byDay[d].forEach(function (c, k) { m[k] += c; });
      });
      var a = dayDate(state.from), b = dayDate(state.to);
      for (var k = a.getFullYear() * 12 + a.getMonth(); k <= b.getFullYear() * 12 + b.getMonth(); k++) {
        points.push({ key: k, label: MONTHS_LONG[k % 12] + " " + Math.floor(k / 12), sunday: true, counts: months[k] || [0, 0, 0, 0, 0] });
      }
    }
    points.forEach(function (p) {
      p.total = p.counts.reduce(function (x, y) { return x + y; }, 0);
      p.avg = p.total ? p.counts.reduce(function (x, c, k) { return x + c * (k + 1); }, 0) / p.total : null;
    });
    function dim(p) { return sel >= 0 && p.key !== sel ? 0.35 : 1; }
    var many = points.length > 45;
    var labelStyle = { show: !many, color: "#3B3A39", fontSize: 11.33 * s, fontFamily: FONT };

    var series;
    if (!score) {
      series = NAMES.map(function (name, k) {
        return {
          name: name, type: "bar", stack: "v", barCategoryGap: daily ? "14%" : "30%",
          itemStyle: { color: COLORS[k] },
          data: points.map(function (p) { return { value: p.counts[k], itemStyle: { opacity: dim(p) } }; })
        };
      });
      if (daily) {
        series.push({
          name: "Count of label", type: "line", z: 5, data: points.map(function (p) { return p.total; }),
          symbol: "circle", symbolSize: 8 * s, lineStyle: { color: ACCENT, width: 2 * s }, itemStyle: { color: ACCENT },
          label: Object.assign({ position: "top", distance: 4 * s }, labelStyle)
        });
      } else {
        series.push({
          type: "scatter", symbolSize: 0, silent: true, data: points.map(function (p) { return p.total; }),
          label: Object.assign({ position: "top", formatter: function (p) { return fmtK(p.value); } }, labelStyle, { show: true })
        });
      }
    } else {
      series = [{
        name: "Average of label", type: "bar", barCategoryGap: daily ? "14%" : "30%",
        data: points.map(function (p) { return { value: p.avg, itemStyle: { color: p.avg ? bandColor(p.avg) : "transparent", opacity: dim(p) } }; }),
        label: daily ? null : Object.assign({ position: "top", formatter: function (p) { return p.value ? p.value.toFixed(2) : ""; } }, labelStyle, { show: true })
      }];
      if (daily) {
        series.push({
          name: "Average of label", type: "line", z: 5, data: points.map(function (p) { return p.avg; }), connectNulls: true,
          symbol: "circle", symbolSize: 6 * s, lineStyle: { color: ACCENT, width: 2 * s }, itemStyle: { color: ACCENT },
          label: Object.assign({ position: "top", formatter: function (p) { return p.value ? p.value.toFixed(2) : ""; } }, labelStyle)
        });
      }
    }

    charts.time.setOption({
      animation: false,
      textStyle: { fontFamily: FONT },
      grid: { left: 49 * s, right: 19 * s, top: 18 * s, bottom: 42 * s },
      tooltip: Object.assign({ trigger: "axis", axisPointer: { type: "shadow", shadowStyle: { color: "rgba(0,0,0,0.04)" } }, formatter: function (ps) {
        var p = points[ps[0].dataIndex];
        var rows = [["Incident date", p.label]];
        if (score) {
          rows.push(["Average of label", p.avg ? p.avg.toFixed(2) : "(Blank)"]);
        } else {
          NAMES.forEach(function (n, k) { rows.push([n, p.counts[k].toLocaleString()]); });
          rows.push(["Count of label", p.total.toLocaleString()]);
        }
        return tipRows(rows);
      } }, echartsTip),
      xAxis: {
        type: "category", data: points.map(function (p) { return p.label; }), triggerEvent: daily,
        axisLabel: { fontSize: 10.67 * s, color: INK2, margin: 8 * s, interval: daily ? function (i) { return points[i].sunday; } : 0 },
        axisTick: { show: false }, axisLine: { show: false },
        name: "INCIDENT DATES", nameLocation: "middle", nameGap: 22 * s, nameTextStyle: { fontSize: 12 * s, color: INK, fontWeight: "bold" }
      },
      yAxis: {
        type: "value", min: 0, max: score ? 5 : null, splitNumber: 3,
        axisLabel: { fontSize: 10.67 * s, color: INK2, margin: 6 * s },
        splitLine: { lineStyle: { type: [1 * s, 3 * s], color: "#7D7C7B" } },
        name: score ? "SENTIMENT SCORE" : "NO. OF REPORTED CASES", nameLocation: "middle", nameGap: 34 * s,
        nameTextStyle: { fontSize: 12 * s, color: INK, fontWeight: "bold" }
      },
      series: series
    }, true);

    ov.points = points;
    ov.drillDay.className = "v btn t " + (sel >= 0 ? "solid" : "disabled");
  }

  function renderTimelineOnly() {
    renderTimeline(aggregate(true, false, true));
  }

  function renderOverview(refitMap) {
    // Each visual is filtered by every selection except its own, so the
    // clicked visual keeps its context (highlighted) while the rest follow.
    var kind = state.sel ? state.sel.kind : null;
    var withSel = aggregate(true, true, true);
    var noSel = aggregate(false, true, true);
    renderSub(kind === "sub" || kind === "label" ? noSel : withSel);
    renderPie(kind === "label" ? noSel : withSel);
    renderGauge(withSel);
    renderMap(aggregate(true, true, false), refitMap);
    renderTimeline(aggregate(true, false, true));
    ov.subLegend.querySelectorAll("[data-l]").forEach(function (el) {
      el.classList.toggle("off", kind === "label" && Number(el.getAttribute("data-l")) !== state.sel.l);
    });
    ov.quick.forEach(function (b) { b.classList.toggle("on", b.dataset.type === state.type); });
    ov.drillStation.className = "v btn t " + (state.pin >= 0 ? "solid" : "disabled");
  }

  // ---------------------------------------------------------------------
  // Drill-down pages (Drill Down / Day Report / MRT-LRT Report)
  // ---------------------------------------------------------------------
  var dr = {};

  var SOURCES = [["Feedback Form", 36], ["Web Form", 30], ["Phone - incoming", 11], ["Whatsapp", 9], ["Email", 9], ["Social media", 5]];
  var STATUS_CASE = [["Closed", 30], ["Investigation Completed (Child)", 22], ["System Closed", 16], ["Under Investigation", 12], ["Open", 12], ["Cancelled", 8]];
  var STATUS_COMPLIMENT = [["", 55], ["Closed", 30], ["System Closed", 15]];
  var FEEDBACK_OTHER = [["Complaint", 45], ["Comment", 33], ["Enquiry", 13], ["Suggestion", 9]];
  var STAFF = ["the station staff", "the customer service officer", "the train captain", "the service ambassador", "the station manager", "the bus captain"];
  var PRAISE = [
    "helped my elderly mother find the correct exit",
    "went out of the way to help me look for my lost wallet",
    "was very patient and friendly when I asked for directions",
    "assisted a wheelchair user to board the train safely",
    "made clear and calm announcements during the service delay",
    "helped a tourist family top up their cards and plan their route"
  ];
  var ISSUES = {
    "Escalators / Lifts": "the escalator near the exit was not working and there was no alternative lift nearby",
    "Vehicles Air-condition": "the air-conditioning was not working properly and it was very warm inside",
    "Driving Habits": "the captain was braking abruptly and passengers were thrown off balance",
    "Frequency": "I waited more than 15 minutes for the next service during peak hours",
    "Handling of Passengers": "the staff member was unhelpful when I asked for assistance",
    "Bad Handling of Passengers": "the staff member was rude when I asked a simple question",
    "Fail to Pick up / Alight Passengers": "the bus did not stop at the stop even though I flagged it",
    "Passenger Safety": "the platform was very crowded and passengers were pushing near the doors",
    "Toilets": "the station toilet was not clean and the tap was not working",
    "Vehicle Design & Condition": "several seats were damaged and the handrail was loose",
    "Vehicle Information Systems": "the information display showed the wrong next station",
    "Announcement in Trains & Buses": "the announcements were too soft to hear",
    "Doors Closed on Passenger": "the doors closed while passengers were still boarding",
    "Lighting": "part of the concourse lighting was not working",
    "Signage in Stations/Bus Interchanges (Ops)": "the signage to the bus interchange was confusing"
  };

  function rng(seed) {
    return function () {
      seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function pick(r, list) {
    var total = 0;
    list.forEach(function (x) { total += x[1]; });
    var v = r() * total;
    for (var i = 0; i < list.length; i++) { v -= list[i][1]; if (v <= 0) return list[i][0]; }
    return list[list.length - 1][0];
  }
  function one(r, arr) { return arr[Math.floor(r() * arr.length)]; }

  // ---- Raw feedback text shared with the portal (samples.js) -----------
  // Cases borrow the same WhatsApp / email / call-note / web-form text the
  // Situational Awareness view uses, matched on sentiment and category.
  var SAMPLE_SOURCE = { "WhatsApp (SNAP)": "Whatsapp", "Email": "Email", "Web Form": "Web Form", "Phone (CSR note)": "Phone - incoming",
    "Social Media": "Social media", "Station Report": "Feedback Form", "Live IFS Feed": "Feedback Form" };
  var SAMPLE_POOLS = (function () {
    var S = window.AIDISA_SAMPLES;
    var pools = { pos: [], neutral: [], neg: [], vneg: [] };
    if (!S) return pools;
    function add(title, text, source, kind) {
      var item = { title: title, text: text, source: SAMPLE_SOURCE[source] || "Web Form" };
      var pos = /compliment|thank you for helping|helped|returned|helpful/i.test(title);
      var strong = /!!|complaint|rude|unacceptable|angry|sia\b|dangerous|sauna|bbq|ridiculous|wat is going on|cannot tahan/i.test(text);
      if (pos) { pools.pos.push(item); return; }
      if (kind === "routine") pools.neutral.push(item);
      pools.neg.push(item);
      if (strong || kind === "incident") pools.vneg.push(item);
    }
    S.seeds.forEach(function (x) { add(x[0], x[1], x[4], "routine"); });
    S.routines.forEach(function (x) { add(x.title, x.description, x.source_at, "routine"); });
    S.incidents.forEach(function (x) { add(x.title, x.description, x.source_at, "incident"); });
    S.scenarios.forEach(function (sc) { sc.reports.forEach(function (x) { add(x[0], x[1], x[2], "incident"); }); });
    return pools;
  })();
  var SUB_HINTS = [
    [/air-?con/i, /aircon/i],
    [/door/i, /door/i],
    [/escalator|lift/i, /escalator|lift/i],
    [/burning/i, /burning/i],
    [/toilet/i, /toilet|tissue/i],
    [/dwell|frequency|delay|^TD|operational/i, /track fault|stuck|stop|bridging/i],
    [/cleanliness/i, /dirty|clean|water|leak/i],
    [/information|STARIS|announcement|signage/i, /announcement|screen|sign|exit/i],
    [/handling of passengers|customer service|rule enforcement|behaviour/i, /staff|rude|security|officer/i]
  ];
  function fillSampleTokens(text, when) {
    function hhmm(extra) {
      var x = new Date(when.getTime() + extra * 60000);
      return pad(x.getHours()) + ":" + pad(x.getMinutes());
    }
    return text.replace(/\{t(\d*)\}/g, function (m, n) { return hhmm(Number(n) || 0); })
      .replace(/\{d\}/g, pad(when.getDate()) + "/" + pad(when.getMonth() + 1) + "/" + when.getFullYear());
  }
  function pickSample(r, label, sub, subsub) {
    var tone = label >= 4 ? "pos" : label === 3 ? "neutral" : label === 2 ? "neg" : "vneg";
    var pool = SAMPLE_POOLS[tone];
    if (!pool.length) return null;
    var hint = SUB_HINTS.find(function (h) { return h[0].test(sub) || h[0].test(subsub); });
    if (hint) {
      var narrowed = pool.filter(function (x) { return hint[1].test(x.title + " " + x.text); });
      if (narrowed.length) pool = narrowed;
    }
    return one(r, pool);
  }

  // Build one synthetic case from aggregated row i, copy k.
  function makeCase(i, k) {
    var r = rng(i * 7919 + k * 104729 + 17);
    var incident = dayDate(C.d[i]);
    var created = new Date(incident.getTime());
    var delay = r() < 0.6 ? 0 : r() < 0.7 ? 1 : 2 + Math.floor(r() * 8);
    created.setDate(created.getDate() + delay);
    created.setHours(6 + Math.floor(r() * 17), Math.floor(r() * 60), Math.floor(r() * 60));
    var hour = Math.floor(r() * 24), minute = Math.floor(r() * 60);
    var incidentTime = r() < 0.06 ? 0 : hour * 100 + minute;

    var division = D.dims.division[C.v[i]];
    var main = D.dims.main[C.m[i]], sub = D.dims.sub[C.s[i]], subsub = D.dims.subsub[C.ss[i]];
    var label = C.l[i];
    var code = D.dims.incident_at[C.a[i]];
    var place = D.stations[code] ? D.stations[code].name + " station" : code === "TRN" ? "the train" : "the interchange";
    var isBus = division === "Bus";

    var compliment = main === "Compliments (Customer Service)" || label >= 4;
    var feedback = main === "Compliments (Customer Service)" ? (r() < 0.9 ? "Compliments" : "Compliment")
      : main === "Lost and Found" ? "Lost and Found" : compliment ? "Compliment" : pick(r, FEEDBACK_OTHER);
    var caseNo = String(created.getFullYear()).slice(2) + pad(created.getMonth() + 1) + "-" + pad(1 + Math.floor(r() * 6400), 5) + "-01";

    var staff = isBus ? "the bus captain" : one(r, STAFF.slice(0, 5));
    var title, body;
    if (compliment) {
      title = "Compliment for " + staff.replace("the ", "") + " at " + place.replace(" station", "");
      body = "I would like to compliment " + staff + " at " + place + " who " + one(r, PRAISE) + ". Please pass my thanks to them.";
    } else if (label === 3) {
      title = (sub !== "Unspecified" ? sub : "General enquiry") + " - " + place.replace(" station", "");
      body = "I would like to check on " + (ISSUES[sub] ? "a matter where " + ISSUES[sub] : "the service at " + place) + ". Please advise on the next steps.";
    } else {
      title = (sub !== "Unspecified" ? sub : "Feedback") + " - " + place.replace(" station", "");
      body = "I am writing to feed back that " + (ISSUES[sub] || "the service did not meet my expectations") + " at " + place + ". " +
        (label === 1 ? "This is unacceptable and I would like a reply as soon as possible." : "I hope this can be looked into.");
    }
    var sample = pickSample(r, label, sub, subsub);
    if (sample) {
      title = sample.title;
      body = fillSampleTokens(sample.text, created);
    }
    var sent = new Date(created.getTime() - 3600000);
    var sentText = WEEKDAYS[sent.getDay()] + ", " + MONTHS_LONG[sent.getMonth()] + " " + sent.getDate() + ", " + sent.getFullYear() + " " +
      pad(sent.getHours() % 12 || 12) + ":" + pad(sent.getMinutes()) + " " + (sent.getHours() >= 12 ? "PM" : "AM");
    var description = sample ? body : "Sent : " + sentText + "\nType : " + (compliment ? "Compliment" : feedback) +
      "\nDivision : " + (isBus ? "Bus" : "Train") + "\nFull name : Demo Customer " + pad(Math.floor(r() * 9000) + 1000, 4) +
      "\nEmail address : ****@***.**\n\n" + body;

    return {
      key: i + ":" + k,
      label: label,
      created: usDateTime(created),
      incidentDate: usDate(incident) + " 12:00:00 AM",
      incidentTime: incidentTime,
      parentCase: r() < 0.08 ? caseNo.replace(/-01$/, "-00") : "",
      caseId: caseNo,
      divisionName: r() < 0.25 && division !== "Unspecified" ? division : "",
      incidentAt: code === "Unspecified" ? "" : code,
      parentDivision: division === "Unspecified" ? "" : division,
      feedback: feedback,
      source: sample ? sample.source : pick(r, SOURCES),
      status: compliment ? pick(r, STATUS_COMPLIMENT) : pick(r, STATUS_CASE),
      main: main === "Unspecified" ? "" : main,
      sub: sub === "Unspecified" ? "" : sub,
      subsub: subsub === "Unspecified" ? "" : subsub,
      title: title,
      description: description
    };
  }

  var COLUMNS = [
    ["Sentiment", 100, function (c) { return NAMES[c.label - 1]; }],
    ["Date Created", 132, "created"],
    ["Incident Date", 132, "incidentDate"],
    ["Incident Time", 92, "incidentTime", true],
    ["Parent Case Id", 78, "parentCase"],
    ["Case Id", 97, "caseId"],
    ["Division Name", 149, "divisionName"],
    ["Incident At", 62, "incidentAt"],
    ["Parent Case Division", 106, "parentDivision"],
    ["Feedback Value", 84, "feedback"],
    ["Source Value", 112, "source"],
    ["Status Value", 68, "status"],
    ["Main Category", 150, "main"],
    ["Sub Category", 170, "sub"],
    ["Sub Sub Category", 170, "subsub"],
    ["Title", 240, "title"],
    ["Description", 420, function (c) { return c.description.replace(/\s+/g, " "); }]
  ];

  function buildDrill() {
    var P = $("pageDrill");
    V(P, 0, 0, 1280, 56, "nav");
    button(P, 16, 12, 160, 32, "", "Back to MRT/LRT Overview", "Back to MRT/LRT overview", function () { location.hash = ""; });
    V(P, 16, 79, 1232, 64, "card");
    dr.filterBar = V(P, 0, 0, 1280, 160, "passthrough");

    V(P, 16, 160, 1248, 288, "card");
    titles(P, 16, 160, 1248, "CDE PUBLIC REPORT", "THIS TABLE SHOWS THE RAW REPORT FROM CDE");
    V(P, 624, 160, 112, 48, "pad b", "Incident At:", 16);
    dr.incidentAt = V(P, 723, 163, 120, 36, "center", "", 21.33);
    dr.incidentAt.style.lineHeight = "calc(36 * var(--u))";
    helpButton(P, 1216, 160, 48, 30, HELP.table);
    dr.scroll = V(P, 26, 199, 1228, 239, "table-scroll");
    dr.scroll.innerHTML = '<table class="pbi"><colgroup>' + COLUMNS.map(function (c) { return '<col style="width:calc(' + c[1] + ' * var(--u))">'; }).join("") +
      "</colgroup><thead><tr>" + COLUMNS.map(function (c, i) {
        return '<th style="position:sticky' + (i === 0 ? ';padding-bottom:calc(4 * var(--u))' : "") + '">' + c[0] + (i === 0 ? '<span class="sort">&#9650;</span>' : "") + "</th>";
      }).join("") + "</tr></thead><tbody></tbody></table>";
    dr.tbody = dr.scroll.querySelector("tbody");
    dr.scroll.addEventListener("scroll", function () {
      if (dr.scroll.scrollTop + dr.scroll.clientHeight > dr.scroll.scrollHeight - 80) appendRows();
    });
    dr.tbody.addEventListener("click", function (e) {
      var tr = e.target.closest("tr");
      if (!tr) return;
      state.row = state.row === tr.dataset.key ? null : tr.dataset.key;
      renderSelection();
    });

    V(P, 16, 448, 1248, 32, "pad b nowrap",
      "PLEASE CLICKED ON A ROW ABOVE FOR THE VALUE BELOW TO SHOW YOU THE SENTIMENT AND CONFIDENCE RELATED TO THE CASE", 13.33);

    V(P, 16, 480, 992, 224, "card");
    V(P, 26, 485, 972, 18, "vt", "FULL DESCRIPTION", 14);
    V(P, 26, 505, 976, 19, "desc-head", 'THIS SHOWS THE FULL DESCRIPTION FROM THE ROW CLICKED<span class="sort">&#9660;</span>', 10.67);
    dr.desc = V(P, 26, 528, 980, 170, "desc-body", "", 14);

    V(P, 1024, 480, 240, 224, "card");
    V(P, 1034, 485, 220, 18, "vt center", "SENTIMENT", 14);
    V(P, 1034, 503, 220, 14, "vs center", "THIS IS THE SENITMENT OF REPORT CLICKED", 10.67);
    dr.sentiment = V(P, 1024, 540, 240, 150, "big-value", "", 40);
  }

  function buildDrillFilters(kind) {
    var P = dr.filterBar;
    P.innerHTML = "";
    slicers = slicers.filter(function (sl) { return document.body.contains(sl.span) && !P.contains(sl.span); });
    if (kind === "filter") {
      V(P, 16, 79, 120, 64, "pad b", "FILTER APPLIED:", 16);
      slicer(P, 128, 80, 180, "PARENT CASE DIVISIONS", "division");
      slicer(P, 312, 80, 180, "STATION", "station");
      slicer(P, 495, 80, 180, "MAIN CATEGORY", "main");
      slicer(P, 679, 80, 180, "SUB CATEGORY", "sub");
      slicer(P, 863, 80, 180, "SUB SUB CATEGORY", "subsub");
      dateSlicer(P, 1040, 80, 224);
    } else if (kind === "station") {
      V(P, 48, 91, 168, 40, "pad b nowrap", "FILTER APPLIED:", 18.67);
      dr.selected = V(P, 240, 79, 192, 64, "card-value", "", 24);
      slicer(P, 457, 79, 178, "MAIN CATEGORY", "main");
      slicer(P, 638, 79, 178, "SUB CATEGORY", "sub");
      slicer(P, 820, 79, 178, "SUB SUB CATEGORY", "subsub");
      dateSlicer(P, 1000, 79, 221);
    } else {
      V(P, 48, 91, 168, 40, "pad b nowrap", "FILTER APPLIED:", 18.67);
      dr.selected = V(P, 216, 79, 144, 64, "card-value", "", 24);
      slicer(P, 377, 79, 176, "PARENT CASE DIVISIONS", "division");
      slicer(P, 551, 79, 176, "STATION", "station");
      slicer(P, 725, 79, 176, "MAIN CATEGORY", "main");
      slicer(P, 899, 79, 176, "SUB CATEGORY", "sub");
      slicer(P, 1073, 79, 176, "SUB SUB CATEGORY", "subsub");
    }
  }

  function drillMatch(i) {
    var dk = state.drill;
    if (dk.kind === "day") {
      var from = state.from, to = state.to;
      state.from = state.to = dk.d;
      var ok = matches(i, null, false);
      state.from = from;
      state.to = to;
      return ok;
    }
    if (dk.kind === "station") return C.a[i] === dk.a && matches(i, "station", false) &&
      (state.type === "all" || state.type === "station");
    return matches(i, null, true, true, true);
  }

  function renderDrill() {
    var dk = state.drill;
    renderSlicers();
    var titleLabel = { all: "All", station: "Station", train: "Train", other: "Others" }[state.type];
    dr.incidentAt.textContent = dk.kind === "station" ? "Station" : titleLabel;
    if (dk.kind === "station") {
      dr.selected.innerHTML = '<div class="vt t" style="--fs:10.67;color:#252423">SELECTED STATION</div><div>' + escapeHtml(stationName(D.dims.incident_at[dk.a])) + "</div>";
    } else if (dk.kind === "day") {
      dr.selected.innerHTML = '<div class="vt t" style="--fs:10.67;color:#252423">SELECTED DATE</div><div>' + usDate(dayDate(dk.d)) + "</div>";
    }

    var pairs = [];
    for (var i = 0; i < N; i++) {
      if (!drillMatch(i)) continue;
      for (var k = 0; k < C.n[i]; k++) pairs.push([i, k]);
    }
    pairs.sort(function (a, b) { return C.l[a[0]] - C.l[b[0]] || C.d[a[0]] - C.d[b[0]]; });
    dr.pairs = pairs;
    dr.shown = 0;
    dr.cache = {};
    dr.tbody.innerHTML = "";
    dr.scroll.scrollTop = 0;
    appendRows();
    renderSelection();
  }

  function caseFor(pair) {
    var key = pair[0] + ":" + pair[1];
    return dr.cache[key] || (dr.cache[key] = makeCase(pair[0], pair[1]));
  }

  function appendRows() {
    if (!dr.pairs || dr.shown >= dr.pairs.length) return;
    var end = Math.min(dr.pairs.length, dr.shown + 150);
    var html = [];
    for (var j = dr.shown; j < end; j++) {
      var c = caseFor(dr.pairs[j]);
      html.push('<tr data-key="' + c.key + '"' + (state.row === c.key ? ' class="sel"' : "") + ">" + COLUMNS.map(function (col) {
        var v = typeof col[2] === "function" ? col[2](c) : c[col[2]];
        return "<td" + (col[3] ? ' class="num"' : "") + ">" + escapeHtml(v) + "</td>";
      }).join("") + "</tr>");
    }
    dr.tbody.insertAdjacentHTML("beforeend", html.join(""));
    dr.shown = end;
  }

  function renderSelection() {
    dr.tbody.classList.toggle("dim", !!state.row);
    dr.tbody.querySelectorAll("tr").forEach(function (tr) { tr.classList.toggle("sel", tr.dataset.key === state.row); });
    var chosen = null;
    if (state.row) {
      var parts = state.row.split(":").map(Number);
      chosen = makeCase(parts[0], parts[1]);
    } else if (dr.pairs.length) {
      chosen = caseFor(dr.pairs[0]);
    }
    dr.desc.textContent = chosen ? chosen.description : "";
    if (state.row && chosen) {
      dr.sentiment.textContent = NAMES[chosen.label - 1];
    } else {
      var sum = 0;
      dr.pairs.forEach(function (p) { sum += C.l[p[0]]; });
      dr.sentiment.textContent = dr.pairs.length ? labelText(sum / dr.pairs.length) : "(Blank)";
    }
  }

  // ---------------------------------------------------------------------
  // Routing, scaling and start-up
  // ---------------------------------------------------------------------
  function route() {
    var h = decodeURIComponent(location.hash.replace(/^#/, ""));
    var drill = null;
    if (h === "drill") drill = { kind: "filter" };
    else if (/^day\/\d{4}-\d{2}-\d{2}$/.test(h)) {
      var d = dayIndex(new Date(h.slice(4) + "T00:00:00"));
      if (d >= 0 && d < D.meta.days) drill = { kind: "day", d: d };
    } else if (/^station\//.test(h)) {
      var a = D.dims.incident_at.indexOf(h.slice(8));
      if (a >= 0) drill = { kind: "station", a: a };
    }
    var prevKind = state.drill && state.drill.kind;
    state.drill = drill;
    state.row = null;
    $("pageOverview").hidden = !!drill;
    $("pageDrill").hidden = !drill;
    // The overview has no header row any more, so it uses a shorter canvas.
    $("canvas").classList.toggle("is-overview", !drill);
    if (drill) {
      if (drill.kind !== prevKind) buildDrillFilters(drill.kind);
      renderDrill();
    } else {
      resizeCharts();
      renderAll(true);
    }
    window.scrollTo(0, 0);
  }

  function renderAll(refitMap) {
    renderSlicers();
    if (state.drill) renderDrill();
    else renderOverview(refitMap !== false);
  }

  function applyScale() {
    var w = document.documentElement.clientWidth;
    scale = Math.max(0.6, Math.min(2, w / 1280));
    $("canvas").style.setProperty("--u", scale + "px");
  }

  function resizeCharts() {
    Object.keys(charts).forEach(function (k) { charts[k].resize(); });
    if (map) map.invalidateSize();
  }

  document.addEventListener("DOMContentLoaded", function () {
    tipEl = $("tip");
    if (!D || !window.echarts || !window.L) {
      $("canvas").innerHTML = '<p style="padding:20px">Could not load the chart libraries or data. Check your connection and reload.</p>';
      return;
    }
    applyScale();
    buildOverview();
    buildDrill();
    route();
    window.addEventListener("hashchange", route);
    var timer = null;
    window.addEventListener("resize", function () {
      clearTimeout(timer);
      timer = setTimeout(function () {
        applyScale();
        resizeCharts();
        renderAll(true);
      }, 120);
    });
    document.addEventListener("scroll", hideTip, true);
  });
})();
