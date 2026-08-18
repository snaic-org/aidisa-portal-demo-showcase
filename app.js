// AIDISA Portal - standalone GitHub Pages demo.
// Fully static and client-side: no server, no API routes, no build step.
// All data is synthetic, generated locally with simple rules and kept in
// localStorage. This file is independent of the real aidisa_portal_frontend
// app - nothing here is shared with or read by that codebase.

(function () {
  "use strict";

  var STORAGE_KEY = "aidisa-pages-demo-v1";
  var AUTH_KEY = "aidisa-pages-demo-auth";

  // ---------------------------------------------------------------------
  // Keyword vocabulary (mirrors the phrase-based classifier used by the
  // real offline demo mode, ported to plain JS).
  // ---------------------------------------------------------------------
  var HIGH_SEVERITY_TERMS = [
    "injury", "injured", "fire", "smoke", "weapon", "threat", "fell", "collapsed", "slippery",
    "train door", "platform edge", "breakdown", "collision", "emergency", "assault", "violent",
    "harassment", "molest", "suicide", "trespass", "track intrusion", "unattended bag",
    "suspicious bag", "suspicious item", "explosion", "flood", "electrocut"
  ];

  var INCIDENT_KEYWORD_PHRASES = [
    "train breakdown", "signal fault", "signal failure", "power fault", "power trip",
    "person fell", "passenger fell", "fell on escalator", "medical emergency", "heart attack", "fainted", "collapsed",
    "suspicious bag", "suspicious item", "unattended bag", "unattended item",
    "violent person", "physical assault", "assault", "fight", "harassment", "verbal abuse",
    "smoke", "fire", "burning smell", "electrical fault",
    "flooding", "water leak", "slippery floor",
    "platform crowding", "platform edge", "overcrowding", "overcrowded", "crowding", "pushed",
    "train door", "door obstruction", "door incident",
    "track intrusion", "trespassing", "fare evasion",
    "escalator fault", "escalator breakdown", "lift breakdown", "lift trapped", "lift fault",
    "theft", "pickpocket", "lost property", "lost item",
    "public nuisance", "intoxicated passenger", "verbal dispute",
    "obstruction", "delay", "service disruption", "collision"
  ];

  function classifyRecord(record) {
    var text = ((record.title || "") + " " + (record.description || "")).toLowerCase();
    var matched = HIGH_SEVERITY_TERMS.filter(function (term) { return text.indexOf(term) !== -1; });
    var keywords = INCIDENT_KEYWORD_PHRASES.filter(function (phrase) { return text.indexOf(phrase) !== -1; });

    var mainCategory = "General Feedback";
    if (/lost|left .*bag|wallet|backpack/.test(text)) mainCategory = "Lost and Found";
    else if (/smoke|fire|injur|slippery|fell|door|assault|violent|weapon|threat|suspicious|breakdown|collision|trespass/.test(text)) mainCategory = "Safety";
    else if (/refund|fare|charged/.test(text)) mainCategory = "Fares";
    else if (/compliment|helpful|excellent|thank/.test(text)) mainCategory = "Compliment";
    else if (/escalator|lift|leak|facility/.test(text)) mainCategory = "Facilities";

    return {
      severity_level: matched.length ? "high" : "low",
      keyevent_monitor_matched: matched.join(", "),
      keywords: keywords.length ? keywords : [mainCategory.toLowerCase()],
      main_category: mainCategory
    };
  }

  // ---------------------------------------------------------------------
  // Seed data
  // ---------------------------------------------------------------------
  function isoMinutesAgo(minutes) {
    return new Date(Date.now() - minutes * 60000).toISOString();
  }

  var SEED_USERS = [
    { email: "admin@demo.local", name: "Demo Admin", full: true },
    { email: "amira@demo.local", name: "Amira Tan" },
    { email: "ben@demo.local", name: "Ben Lim" },
    { email: "chloe@demo.local", name: "Chloe Ng" },
    { email: "daniel@demo.local", name: "Daniel Lee" }
  ];

  var SEED_SOURCE = [
    ["Platform crowding at Bishan", "Severe platform crowding at Bishan MRT during peak hour. A passenger nearly fell near the platform edge.", "Bishan MRT", 8],
    ["Escalator unavailable", "The escalator at Outram Park has been out of service since this morning.", "Outram Park MRT", 18],
    ["Smoke smell in carriage", "Strong smoke smell reported inside a northbound train carriage. Please investigate urgently.", "Northbound train", 31],
    ["Helpful station staff", "A staff member at Tampines was very helpful when I needed directions.", "Tampines MRT", 55],
    ["Train door closed on bag", "The train door closed on a passenger's bag at Clementi and caused panic.", "Clementi MRT", 95],
    ["Refund enquiry", "I was charged twice for the same trip and would like assistance with a refund.", "Online", 180],
    ["Water leak near stairs", "Water is leaking near the stairs at City Hall and the floor is slippery.", "City Hall MRT", 420],
    ["Lost blue backpack", "I left a blue backpack on the eastbound train this afternoon.", "Eastbound train", 900]
  ];

  var GENERATED_SCENARIOS = [
    { title: "Sudden crowding near platform edge", description: "Live monitoring detected severe platform crowding and a passenger nearly fell near the platform edge.", source_at: "Live IFS Feed", incident_at: "Jurong East MRT" },
    { title: "Lift breakdown at station", description: "The passenger lift at the concourse has broken down and assistance is needed for a wheelchair user.", source_at: "Mobile App", incident_at: "Serangoon MRT" },
    { title: "Smoke reported in train carriage", description: "Several passengers reported a smoke smell in a train carriage and requested urgent investigation.", source_at: "Live IFS Feed", incident_at: "North South Line" },
    { title: "Positive feedback for service ambassador", description: "Thank you to the helpful service ambassador who assisted an elderly commuter during boarding.", source_at: "Email", incident_at: "Woodlands MRT" },
    { title: "Wallet left on westbound service", description: "A brown wallet was left on a westbound train approximately ten minutes ago.", source_at: "Web Form", incident_at: "Westbound train" },
    { title: "Water leak creating slippery floor", description: "Water is leaking beside the station stairs and the floor is slippery. A commuter almost fell.", source_at: "Station Report", incident_at: "City Hall MRT" },
    { title: "Train breakdown causing delay", description: "A train breakdown on the East West Line has caused a long delay and the platform is becoming crowded.", source_at: "Live IFS Feed", incident_at: "Paya Lebar MRT" },
    { title: "Suspicious bag left unattended", description: "A suspicious bag was found unattended near the ticketing gates and passengers are concerned.", source_at: "Station Report", incident_at: "Raffles Place MRT" },
    { title: "Violent person on platform", description: "A violent person was seen shouting and pushing other commuters on the platform, causing panic.", source_at: "Social Media", incident_at: "Dhoby Ghaut MRT" },
    { title: "Passenger fell on escalator", description: "A passenger fell on the escalator and appeared injured. Staff assistance was requested immediately.", source_at: "Web Form", incident_at: "Orchard MRT" }
  ];

  function seedData() {
    var users = SEED_USERS.slice();
    var eligible = users.filter(function (u) { return !u.full; });
    var feedback = SEED_SOURCE.map(function (item, index) {
      var record = {
        queue_guid: "DEMO-" + String(index + 1).padStart(4, "0"),
        createdon: isoMinutesAgo(item[3]),
        title: item[0],
        description: item[1],
        source_at: index % 3 === 0 ? "Social Media" : "Web Form",
        incident_at: item[2],
        record_origin: "sample",
        assigned_to: eligible.length ? eligible[index % eligible.length].email : null
      };
      Object.assign(record, classifyRecord(record));
      return record;
    });
    return { users: users, feedback: feedback };
  }

  function loadData() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* fall through to reseed */ }
    var fresh = seedData();
    saveData(fresh);
    return fresh;
  }

  function saveData(data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  function assignStaff(data) {
    var eligible = data.users.filter(function (u) { return !u.full; });
    if (!eligible.length) return null;
    var counts = eligible.map(function (u) {
      return data.feedback.filter(function (f) { return f.assigned_to === u.email; }).length;
    });
    var minIndex = 0;
    for (var i = 1; i < counts.length; i++) if (counts[i] < counts[minIndex]) minIndex = i;
    return eligible[minIndex];
  }

  function addFeedback(data, incoming, createdOnIso) {
    var record = {
      queue_guid: "GEN-" + Date.now() + "-" + Math.floor(Math.random() * 1000),
      createdon: createdOnIso || new Date().toISOString(),
      title: incoming.title,
      description: incoming.description,
      source_at: incoming.source_at || "Manual Input",
      incident_at: incoming.incident_at || "Not specified",
      record_origin: incoming.record_origin || "live-generated",
      assigned_to: null
    };
    Object.assign(record, classifyRecord(record));
    var staff = assignStaff(data);
    if (staff) record.assigned_to = staff.email;
    data.feedback.unshift(record);
    saveData(data);
    return record;
  }

  // ---------------------------------------------------------------------
  // Time-bucket alignment helper for the trend chart. Both the generated
  // bucket grid and each record's own bucket must round to the same
  // absolute-clock boundary, or buckets end up misaligned and most of
  // them render as empty even though data exists.
  // ---------------------------------------------------------------------
  function alignToInterval(date, intervalMinutes) {
    var d = new Date(date);
    d.setSeconds(0, 0);
    var flooredMinute = Math.floor(d.getMinutes() / intervalMinutes) * intervalMinutes;
    d.setMinutes(flooredMinute);
    return d;
  }

  function formatBucketLabel(date) {
    var hh = String(date.getHours()).padStart(2, "0");
    var mm = String(date.getMinutes()).padStart(2, "0");
    return hh + ":" + mm;
  }

  // ---------------------------------------------------------------------
  // App state + rendering
  // ---------------------------------------------------------------------
  var state = { data: null, activeTab: "situational" };

  function staffName(data, email) {
    var u = data.users.find(function (u) { return u.email === email; });
    return u ? u.name : "Unassigned";
  }

  function renderStats() {
    var data = state.data;
    var alerts = data.feedback.filter(function (f) { return f.severity_level === "high"; }).length;
    var assigned = data.feedback.filter(function (f) { return f.assigned_to; }).length;
    document.getElementById("statFeedback").textContent = data.feedback.length;
    document.getElementById("statAlerts").textContent = alerts;
    document.getElementById("statAssigned").textContent = assigned;
    document.getElementById("statStaff").textContent = data.users.filter(function (u) { return !u.full; }).length;
  }

  function renderTrend() {
    var data = state.data;
    var intervalMin = Math.max(1, Number(document.getElementById("trendInterval").value) || 5);
    var windowMin = Math.max(intervalMin, Number(document.getElementById("trendWindow").value) || 60);
    var since = Date.now() - windowMin * 60000;

    var records = data.feedback.filter(function (f) {
      return f.severity_level === "high" && new Date(f.createdon).getTime() >= since;
    });

    var container = document.getElementById("trendChart");
    if (!records.length) {
      container.innerHTML = '<div class="chart-empty">No high-severity feedback in this window yet. Generate some events above.</div>';
      renderCritical(records);
      return;
    }

    var buckets = {};
    var cursor = alignToInterval(since, intervalMin);
    var end = alignToInterval(Date.now(), intervalMin);
    var safety = 0;
    while (cursor.getTime() <= end.getTime() && safety < 2000) {
      buckets[cursor.getTime()] = 0;
      cursor = new Date(cursor.getTime() + intervalMin * 60000);
      safety += 1;
    }
    records.forEach(function (record) {
      var bucketTime = alignToInterval(record.createdon, intervalMin).getTime();
      if (buckets[bucketTime] === undefined) buckets[bucketTime] = 0;
      buckets[bucketTime] += 1;
    });

    var times = Object.keys(buckets).map(Number).sort(function (a, b) { return a - b; });
    var maxCount = Math.max.apply(null, times.map(function (t) { return buckets[t]; }));

    container.innerHTML = "";
    times.forEach(function (t) {
      var count = buckets[t];
      var col = document.createElement("div");
      col.className = "bar-col";
      var bar = document.createElement("div");
      bar.className = "bar";
      bar.style.height = (maxCount ? (count / maxCount) * 100 : 0) + "%";
      bar.title = formatBucketLabel(new Date(t)) + " - " + count + " high-severity record(s)";
      var label = document.createElement("div");
      label.className = "bar-label";
      label.textContent = formatBucketLabel(new Date(t));
      col.appendChild(bar);
      col.appendChild(label);
      container.appendChild(col);
    });

    renderCritical(records);
  }

  function renderCritical(records) {
    var tbody = document.querySelector("#criticalTable tbody");
    tbody.innerHTML = "";
    records
      .slice()
      .sort(function (a, b) { return new Date(b.createdon) - new Date(a.createdon); })
      .forEach(function (record) {
        var tr = document.createElement("tr");
        tr.innerHTML =
          "<td>" + new Date(record.createdon).toLocaleTimeString() + "</td>" +
          "<td>" + escapeHtml(record.title) + "</td>" +
          "<td>" + escapeHtml(record.incident_at) + "</td>" +
          "<td>" + escapeHtml(record.keywords.join(", ")) + "</td>";
        tr.addEventListener("click", function () { showDetail(record); });
        tbody.appendChild(tr);
      });
  }

  function renderSurge() {
    var data = state.data;
    var windowMin = Math.max(1, Number(document.getElementById("surgeWindow").value) || 60);
    var minCount = Math.max(1, Number(document.getElementById("surgeMinCount").value) || 1);
    var since = Date.now() - windowMin * 60000;

    var counts = {};
    data.feedback.forEach(function (f) {
      if (new Date(f.createdon).getTime() < since) return;
      (f.keywords || []).forEach(function (k) {
        counts[k] = (counts[k] || 0) + 1;
      });
    });

    var entries = Object.keys(counts)
      .map(function (k) { return { keyword: k, count: counts[k] }; })
      .filter(function (e) { return e.count >= minCount; })
      .sort(function (a, b) { return b.count - a.count; })
      .slice(0, 10);

    var container = document.getElementById("surgeChart");
    if (!entries.length) {
      container.innerHTML = '<div class="chart-empty">No event surge detected. Lower the minimum count or generate more events.</div>';
      return;
    }

    var maxCount = entries[0].count;
    container.innerHTML = "";
    entries.forEach(function (entry) {
      var row = document.createElement("div");
      row.className = "hbar-row";
      row.innerHTML =
        '<div class="hbar-label">' + escapeHtml(entry.keyword) + '</div>' +
        '<div class="hbar-track"><div class="hbar-fill" style="width:' + ((entry.count / maxCount) * 100) + '%"></div></div>' +
        '<div class="hbar-count">' + entry.count + '</div>';
      container.appendChild(row);
    });
  }

  function renderCaseAssignment() {
    var data = state.data;
    var workloadBody = document.querySelector("#workloadTable tbody");
    workloadBody.innerHTML = "";
    data.users.filter(function (u) { return !u.full; }).forEach(function (u) {
      var count = data.feedback.filter(function (f) { return f.assigned_to === u.email; }).length;
      var tr = document.createElement("tr");
      tr.innerHTML = "<td>" + escapeHtml(u.name) + "</td><td>" + count + "</td>";
      workloadBody.appendChild(tr);
    });

    var caseBody = document.querySelector("#caseTable tbody");
    caseBody.innerHTML = "";
    data.feedback.slice(0, 100).forEach(function (record) {
      var tr = document.createElement("tr");
      tr.innerHTML =
        "<td>" + new Date(record.createdon).toLocaleString() + "</td>" +
        "<td>" + escapeHtml(record.title) + "</td>" +
        '<td class="' + (record.severity_level === "high" ? "sev-high" : "sev-low") + '">' + record.severity_level.toUpperCase() + "</td>" +
        "<td>" + escapeHtml(staffName(data, record.assigned_to)) + "</td>";
      tr.addEventListener("click", function () { showDetail(record); });
      caseBody.appendChild(tr);
    });
  }

  function renderAll() {
    renderStats();
    renderTrend();
    renderSurge();
    renderCaseAssignment();
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function showDetail(record) {
    var data = state.data;
    document.getElementById("detailTitle").textContent = record.title;
    var body = document.getElementById("detailBody");
    var rows = [
      ["Created", new Date(record.createdon).toLocaleString()],
      ["Description", record.description],
      ["Source", record.source_at],
      ["Location", record.incident_at],
      ["Severity", record.severity_level.toUpperCase()],
      ["Category", record.main_category],
      ["Matched keywords", record.keywords.join(", ") || "-"],
      ["Assigned to", staffName(data, record.assigned_to)],
      ["Queue GUID", record.queue_guid]
    ];
    body.innerHTML = rows.map(function (r) {
      return "<dt>" + escapeHtml(r[0]) + "</dt><dd>" + escapeHtml(r[1]) + "</dd>";
    }).join("");
    document.getElementById("detailDialog").showModal();
  }

  function showToast(message) {
    var toast = document.getElementById("toast");
    toast.textContent = message;
    toast.classList.remove("hidden");
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(function () { toast.classList.add("hidden"); }, 3200);
  }

  // ---------------------------------------------------------------------
  // Live feed controls (mirrors the real demo's DemoLiveBar behaviour)
  // ---------------------------------------------------------------------
  var liveTimer = null;

  function generateNow() {
    var data = state.data;
    var advanceSeconds = Number(document.getElementById("advanceSelect").value) || 0;
    var template = GENERATED_SCENARIOS[data.feedback.length % GENERATED_SCENARIOS.length];
    var createdOnIso = new Date(Date.now() + advanceSeconds * 1000).toISOString();
    var record = addFeedback(data, template, createdOnIso);
    renderAll();

    var tag = document.getElementById("lastEventTag");
    tag.textContent = record.title;
    tag.className = "tag" + (record.severity_level === "high" ? " high" : "");
    tag.classList.remove("hidden");
  }

  function setLive(enabled) {
    var dot = document.getElementById("liveDot");
    var statusText = document.getElementById("liveStatusText");
    if (liveTimer) { clearInterval(liveTimer); liveTimer = null; }
    if (enabled) {
      dot.classList.add("live");
      statusText.textContent = "Live dynamic demo feed running";
      var seconds = Number(document.getElementById("intervalSelect").value) || 10;
      liveTimer = setInterval(generateNow, seconds * 1000);
    } else {
      dot.classList.remove("live");
      statusText.textContent = "Lightweight demo mode";
    }
    localStorage.setItem("aidisa-pages-demo-live", enabled ? "true" : "false");
  }

  // ---------------------------------------------------------------------
  // Auth (cosmetic only - matches the real demo's fake login)
  // ---------------------------------------------------------------------
  function isAuthed() { return localStorage.getItem(AUTH_KEY) === "true"; }

  function showApp() {
    document.getElementById("loginView").classList.add("hidden");
    document.getElementById("appView").classList.remove("hidden");
    state.data = loadData();
    renderAll();
    var wasLive = localStorage.getItem("aidisa-pages-demo-live") === "true";
    document.getElementById("liveToggle").checked = wasLive;
    setLive(wasLive);
  }

  function showLogin() {
    document.getElementById("appView").classList.add("hidden");
    document.getElementById("loginView").classList.remove("hidden");
    setLive(false);
  }

  // ---------------------------------------------------------------------
  // Wire up events
  // ---------------------------------------------------------------------
  document.addEventListener("DOMContentLoaded", function () {
    document.getElementById("loginForm").addEventListener("submit", function (e) {
      e.preventDefault();
      localStorage.setItem(AUTH_KEY, "true");
      showApp();
    });

    document.getElementById("logoutBtn").addEventListener("click", function () {
      localStorage.removeItem(AUTH_KEY);
      showLogin();
    });

    document.querySelectorAll(".tab-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        document.querySelectorAll(".tab-btn").forEach(function (b) { b.classList.remove("active"); });
        btn.classList.add("active");
        var tab = btn.getAttribute("data-tab");
        document.getElementById("situationalView").classList.toggle("hidden", tab !== "situational");
        document.getElementById("assignmentView").classList.toggle("hidden", tab !== "assignment");
      });
    });

    document.getElementById("generateNowBtn").addEventListener("click", function () {
      generateNow();
    });

    document.getElementById("liveToggle").addEventListener("change", function (e) {
      setLive(e.target.checked);
    });

    document.getElementById("intervalSelect").addEventListener("change", function () {
      if (document.getElementById("liveToggle").checked) setLive(true);
    });

    ["trendInterval", "trendWindow"].forEach(function (id) {
      document.getElementById(id).addEventListener("change", renderTrend);
    });
    ["surgeWindow", "surgeMinCount"].forEach(function (id) {
      document.getElementById(id).addEventListener("change", renderSurge);
    });

    document.getElementById("resetDemoBtn").addEventListener("click", function () {
      state.data = seedData();
      saveData(state.data);
      renderAll();
      showToast("Demo data restored");
    });

    if (isAuthed()) showApp(); else showLogin();
  });
})();
