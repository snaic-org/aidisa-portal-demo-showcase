// AIDISA Portal - standalone GitHub Pages demo.
// Fully static and client-side: no server, no API routes, no build step.
// All data is synthetic, generated locally with simple rules and kept in
// localStorage. This file is independent of the real aidisa_portal_frontend
// app - nothing here is shared with or read by that codebase.

(function () {
  "use strict";

  var STORAGE_KEY = "aidisa-pages-demo-v2";
  var AUTH_KEY = "aidisa-pages-demo-auth";
  var LIVE_KEY = "aidisa-pages-demo-live";
  var MAX_RECORDS = 400;
  var DUTY_EMAIL = "duty-manager@demo.local";
  var WORKER_TICK_MS = 200;
  var REFRESH_MS = 10000;

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

  function recordText(record) {
    return ((record.title || "") + " " + (record.description || "")).toLowerCase();
  }

  function detectSeverity(text) {
    var matched = HIGH_SEVERITY_TERMS.filter(function (term) { return text.indexOf(term) !== -1; });
    return { severity_level: matched.length ? "high" : "low", keyevent_monitor_matched: matched.join(", ") };
  }

  function extractKeywords(text) {
    return INCIDENT_KEYWORD_PHRASES.filter(function (phrase) { return text.indexOf(phrase) !== -1; });
  }

  function categorize(text) {
    if (/lost|left .*bag|wallet|backpack/.test(text)) return "Lost and Found";
    if (/smoke|fire|injur|slippery|fell|door|assault|violent|weapon|threat|suspicious|breakdown|collision|trespass/.test(text)) return "Safety";
    if (/refund|fare|charged/.test(text)) return "Fares";
    if (/compliment|helpful|excellent|thank/.test(text)) return "Compliment";
    if (/escalator|lift|leak|facility/.test(text)) return "Facilities";
    return "General Feedback";
  }

  // ---------------------------------------------------------------------
  // Processing pipeline. Feedback is *received* first and only becomes
  // visible on the dashboard once a single background worker has taken it
  // through every stage, like the real IFS -> Django -> DB flow. Each stage
  // takes a random amount of time, so a backlog builds when feedback
  // arrives faster than it can be processed.
  // ---------------------------------------------------------------------
  var STAGES = [
    { key: "preprocess", label: "Pre-processing", detail: "Clean & normalise text", ms: [600, 1200],
      apply: function () {} },
    { key: "severity", label: "Severity model", detail: "High-severity terms", ms: [900, 1900],
      apply: function (data, r) { Object.assign(r, detectSeverity(recordText(r))); } },
    { key: "keywords", label: "Keyword / NER", detail: "Incident phrases", ms: [800, 1700],
      apply: function (data, r) { r.keywords = extractKeywords(recordText(r)); } },
    { key: "category", label: "Category classifier", detail: "Main category", ms: [600, 1400],
      apply: function (data, r) { r.main_category = categorize(recordText(r)); } },
    { key: "assign", label: "Case assignment", detail: "Route & pick staff", ms: [500, 1000],
      apply: function (data, r, nowMs) { assignCase(data, r, nowMs); } }
  ];

  var SPEEDS = { fast: 0.35, normal: 1, slow: 2.5 };

  function rand(min, max) { return min + Math.random() * (max - min); }

  function stageDuration(data, stageIndex) {
    var range = STAGES[stageIndex].ms;
    return rand(range[0], range[1]) * (SPEEDS[data.settings.speed] || 1);
  }

  // ---------------------------------------------------------------------
  // Case assignment. Mirrors CaseAssignmentService in aidisa_server:
  //   1. route the case to a team + skill (simplified webform_determine_team)
  //   2. keep staff in that team with that skill       (get_available_users)
  //   3. drop staff on leave                            (get_available_users)
  //   4. keep staff with the fewest cases this hour     (get_next_user)
  //   5. then the fewest cases today                    (get_next_user)
  //   6. round-robin on last-assigned time              (get_next_user)
  // ---------------------------------------------------------------------
  function routeCase(record) {
    var social = record.source_at === "Social Media";
    if (record.main_category === "Lost and Found") return { team: "CW", skill: "lost_and_found", rule: "Lost and found enquiry" };
    if (record.main_category === "Compliment") return { team: "CR", skill: "compliment", rule: "Compliment" };
    if (social) return { team: "CR", skill: "feedback_reply_socialmedia", rule: "Feedback received via social media" };
    if (record.severity_level === "high") return { team: "CR", skill: "feedback_reply", rule: "High-severity feedback" };
    return { team: "CW", skill: "feedback_reply", rule: "Low-severity feedback" };
  }

  function sameDay(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }

  function assignCase(data, record, nowMs) {
    var now = new Date(nowMs);
    var route = routeCase(record);
    var todays = data.feedback.filter(function (f) { return f.assigned_on && sameDay(new Date(f.assigned_on), now); });

    var rows = data.users.filter(function (u) { return !u.full; }).map(function (u) {
      var mine = todays.filter(function (f) { return f.assigned_to === u.email; });
      var last = null;
      mine.forEach(function (f) {
        var t = new Date(f.assigned_on).getTime();
        if (last === null || t > last) last = t;
      });
      return {
        email: u.email, name: u.name, team: u.team, skills: u.skills.slice(), onLeave: !!u.on_leave,
        hourCount: mine.filter(function (f) { return new Date(f.assigned_on).getHours() === now.getHours(); }).length,
        dayCount: mine.length, lastAssigned: last, outStep: null, reason: ""
      };
    });

    var steps = [{ label: "All staff", remaining: rows.length, note: "" }];
    var alive = rows.slice();
    function eliminate(stepIndex, keep, reasonFn) {
      alive = alive.filter(function (r) {
        if (keep(r)) return true;
        r.outStep = stepIndex;
        r.reason = reasonFn(r);
        return false;
      });
    }

    eliminate(1,
      function (r) { return r.team === route.team && r.skills.indexOf(route.skill) !== -1; },
      function (r) { return r.team !== route.team ? "Team " + r.team + " (needs " + route.team + ")" : "No " + route.skill + " skill"; });
    steps.push({ label: "Team & skill", remaining: alive.length, note: route.team + " / " + route.skill });

    eliminate(2, function (r) { return !r.onLeave; }, function () { return "On leave"; });
    steps.push({ label: "Not on leave", remaining: alive.length, note: "" });
    var pool = alive.slice();

    var minHour = alive.length ? Math.min.apply(null, alive.map(function (r) { return r.hourCount; })) : 0;
    eliminate(3, function (r) { return r.hourCount === minHour; },
      function (r) { return r.hourCount + " this hour (min " + minHour + ")"; });
    steps.push({ label: "Fewest this hour", remaining: alive.length, note: "min " + minHour });

    var minDay = alive.length ? Math.min.apply(null, alive.map(function (r) { return r.dayCount; })) : 0;
    eliminate(4, function (r) { return r.dayCount === minDay; },
      function (r) { return r.dayCount + " today (min " + minDay + ")"; });
    steps.push({ label: "Fewest today", remaining: alive.length, note: "min " + minDay });

    // Round-robin: the most recently assigned available user, then the next
    // user after them when eligible users are ordered by last-assigned time.
    var lastUser = null;
    pool.forEach(function (r) {
      if (r.lastAssigned !== null && (lastUser === null || r.lastAssigned > lastUser.lastAssigned)) lastUser = r;
    });
    var sorted = alive.slice().sort(function (a, b) {
      return (a.lastAssigned === null ? -1 : a.lastAssigned) - (b.lastAssigned === null ? -1 : b.lastAssigned);
    });
    var chosen = null;
    if (sorted.length) {
      var idx = lastUser ? sorted.indexOf(lastUser) : -1;
      chosen = idx >= 0 ? sorted[(idx + 1) % sorted.length] : sorted[0];
    }
    sorted.forEach(function (r) {
      if (r === chosen) return;
      r.outStep = 5;
      r.reason = "Round-robin: " + chosen.name + " is next";
    });
    steps.push({
      label: "Round-robin", remaining: chosen ? 1 : 0,
      note: lastUser ? "last assigned: " + lastUser.name : "no one assigned yet"
    });

    record.assigned_to = chosen ? chosen.email : null;
    record.assigned_on = chosen ? new Date(nowMs).toISOString() : null;
    record.assign_trace = {
      route: route, rows: rows, steps: steps, chosen: chosen ? chosen.email : null,
      lastUser: lastUser ? lastUser.name : null, at: new Date(nowMs).toISOString()
    };
  }

  // ---------------------------------------------------------------------
  // Keyword burst detection. The real portal counts each keyword over the
  // last N minutes and shows those above a minimum count. The demo adds a
  // baseline so that a keyword only "bursts" when it is both frequent and
  // unusually frequent:
  //   threshold = max(min count, multiplier x mean count of previous windows)
  //   burst     = count in current window >= threshold
  // ---------------------------------------------------------------------
  function evaluateBursts(data, nowMs) {
    var s = data.settings.burst;
    var W = s.windowMin * 60000;
    var K = s.baselineWindows;
    var start = nowMs - W * (K + 1);
    var stats = {};

    data.feedback.forEach(function (rec) {
      if (rec.status !== "processed") return;
      var t = new Date(rec.createdon).getTime();
      if (t < start) return;
      (rec.keywords || []).forEach(function (k) {
        var st = stats[k];
        if (!st) {
          st = stats[k] = { keyword: k, current: 0, baseline: [], records: [] };
          for (var i = 0; i < K; i++) st.baseline.push(0);
        }
        if (t >= nowMs - W) {
          st.current += 1;
          st.records.push(rec.queue_guid);
        } else {
          var idx = Math.floor((nowMs - W - t) / W);
          if (idx >= 0 && idx < K) st.baseline[K - 1 - idx] += 1;
        }
      });
    });

    return Object.keys(stats).map(function (k) {
      var st = stats[k];
      var sum = st.baseline.reduce(function (a, b) { return a + b; }, 0);
      st.mean = K ? sum / K : 0;
      st.expected = st.mean * s.multiplier;
      st.threshold = Math.max(s.minCount, st.expected);
      st.ratio = st.mean > 0 ? st.current / st.mean : null;
      st.isBurst = st.current > 0 && st.current >= st.threshold;
      return st;
    }).sort(function (a, b) {
      if (a.isBurst !== b.isBurst) return a.isBurst ? -1 : 1;
      return b.current - a.current;
    });
  }

  function findRecord(data, guid) {
    return data.feedback.find(function (f) { return f.queue_guid === guid; });
  }

  function runAlerting(data, nowMs) {
    var fired = [];
    evaluateBursts(data, nowMs).forEach(function (ev) {
      if (!ev.isBurst) return;
      var records = ev.records.map(function (g) { return findRecord(data, g); }).filter(Boolean);
      var open = data.alerts.find(function (a) { return a.keyword === ev.keyword && a.status !== "resolved"; });

      if (open) {
        if (ev.current > open.peakCount) {
          open.peakCount = ev.current;
          open.count = ev.current;
          ev.records.forEach(function (g) { if (open.records.indexOf(g) === -1) open.records.push(g); });
          open.locations = uniqueLocations(data, open.records);
          open.history.push({ at: new Date(nowMs).toISOString(), text: "Escalated: " + ev.current + " reports in window" });
          open.escalations = (open.escalations || 0) + 1;
          if (open.status === "acknowledged") open.status = "active";
          fired.push({ alert: open, escalated: true });
        }
        return;
      }

      // After a resolve, only re-alert once new reports arrive.
      var lastResolved = data.alerts.find(function (a) { return a.keyword === ev.keyword && a.status === "resolved"; });
      if (lastResolved) {
        var resolvedAt = new Date(lastResolved.resolvedon).getTime();
        var fresh = records.some(function (r) { return new Date(r.processedon).getTime() > resolvedAt; });
        if (!fresh) return;
      }

      var critical = records.some(function (r) { return r.severity_level === "high"; });
      var at = new Date(nowMs).toISOString();
      var channels = critical ? ["Portal", "Email (mock)", "SMS (mock)"] : ["Portal", "Email (mock)"];
      var alert = {
        id: "ALR-" + nowMs + "-" + Math.floor(Math.random() * 1000),
        keyword: ev.keyword,
        level: critical ? "critical" : "warning",
        status: "active",
        triggeredon: at,
        count: ev.current,
        peakCount: ev.current,
        mean: ev.mean,
        threshold: ev.threshold,
        windowMin: data.settings.burst.windowMin,
        records: ev.records.slice(),
        locations: uniqueLocations(data, ev.records),
        channels: channels,
        history: [
          { at: at, text: "Burst detected: " + ev.current + " reports vs threshold " + fmtNum(ev.threshold) },
          { at: at, text: "Portal notification raised" },
          { at: at, text: "Mock email sent to " + DUTY_EMAIL }
        ]
      };
      if (critical) alert.history.push({ at: at, text: "Mock SMS sent to on-duty station manager" });
      data.alerts.unshift(alert);
      fired.push({ alert: alert, escalated: false });
    });
    if (data.alerts.length > 60) data.alerts.length = 60;
    return fired;
  }

  function uniqueLocations(data, guids) {
    var seen = [];
    guids.forEach(function (g) {
      var r = findRecord(data, g);
      if (r && seen.indexOf(r.incident_at) === -1) seen.push(r.incident_at);
    });
    return seen;
  }

  function announceAlerts(fired) {
    if (!fired.length) return;
    var f = fired[0];
    var text = f.escalated
      ? "Alert escalated: '" + f.alert.keyword + "' now " + f.alert.count + " reports"
      : "Burst alert: '" + f.alert.keyword + "' - " + f.alert.count + " reports in " + f.alert.windowMin + " min. Mock email sent to " + DUTY_EMAIL;
    showToast(text, "alert");
    var bell = document.getElementById("alertBellBtn");
    bell.classList.remove("ring");
    void bell.offsetWidth;
    bell.classList.add("ring");
  }

  // ---------------------------------------------------------------------
  // Seed data
  // ---------------------------------------------------------------------
  var SEED_USERS = [
    { email: "admin@demo.local", name: "Demo Admin", full: true, team: "ADMIN", skills: [] },
    { email: "amira@demo.local", name: "Amira Tan", team: "CR", skills: ["feedback_reply", "feedback_fyi", "compliment"] },
    { email: "ben@demo.local", name: "Ben Lim", team: "CR", skills: ["feedback_reply", "feedback_reply_socialmedia"] },
    { email: "farah@demo.local", name: "Farah Aziz", team: "CR", skills: ["feedback_reply", "feedback_reply_socialmedia", "compliment"] },
    { email: "chloe@demo.local", name: "Chloe Ng", team: "CW", skills: ["feedback_reply", "lost_and_found"] },
    { email: "daniel@demo.local", name: "Daniel Lee", team: "CW", skills: ["feedback_reply", "lost_and_found"], on_leave: true },
    { email: "evan@demo.local", name: "Evan Goh", team: "CW", skills: ["feedback_reply"] }
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

  // Occasional incidents mixed into the live feed.
  var INCIDENT_TEMPLATES = [
    { title: "Sudden crowding near platform edge", description: "Live monitoring detected severe platform crowding and a passenger nearly fell near the platform edge.", source_at: "Live IFS Feed", incident_at: "Jurong East MRT" },
    { title: "Lift breakdown at station", description: "The passenger lift at the concourse has broken down (lift breakdown) and assistance is needed for a wheelchair user.", source_at: "Mobile App", incident_at: "Serangoon MRT" },
    { title: "Smoke reported in train carriage", description: "Several passengers reported a smoke smell in a train carriage and requested urgent investigation.", source_at: "Live IFS Feed", incident_at: "North South Line" },
    { title: "Water leak creating slippery floor", description: "Water is leaking beside the station stairs and the floor is slippery. A commuter almost fell.", source_at: "Station Report", incident_at: "City Hall MRT" },
    { title: "Train breakdown causing delay", description: "A train breakdown on the East West Line has caused a long delay and the platform is becoming crowded.", source_at: "Live IFS Feed", incident_at: "Paya Lebar MRT" },
    { title: "Suspicious bag left unattended", description: "A suspicious bag was found unattended near the ticketing gates and passengers are concerned.", source_at: "Station Report", incident_at: "Raffles Place MRT" },
    { title: "Violent person on platform", description: "A violent person was seen shouting and pushing other commuters on the platform, causing panic.", source_at: "Social Media", incident_at: "Dhoby Ghaut MRT" },
    { title: "Passenger fell on escalator", description: "A passenger fell on the escalator and appeared injured. Staff assistance was requested immediately.", source_at: "Web Form", incident_at: "Orchard MRT" }
  ];

  // Everyday feedback - deliberately free of incident phrases.
  var ROUTINE_TEMPLATES = [
    { title: "Air-con too cold in carriage", description: "The air-conditioning in the train carriage is far too cold this morning.", source_at: "Web Form", incident_at: "Circle Line" },
    { title: "More seats at concourse", description: "More seating near the concourse would help elderly commuters waiting for friends.", source_at: "Email", incident_at: "Ang Mo Kio MRT" },
    { title: "Compliment for train captain", description: "Thank you to the train captain for the clear and calm announcements.", source_at: "Mobile App", incident_at: "Downtown Line" },
    { title: "Top-up machine not accepting notes", description: "The top-up machine at the ticket office is not accepting notes.", source_at: "Web Form", incident_at: "Bedok MRT" },
    { title: "Charged incorrect fare", description: "I was charged an incorrect fare when tapping out at Bugis.", source_at: "Email", incident_at: "Bugis MRT" },
    { title: "Umbrella left on train", description: "I left my umbrella on the Circle Line train. Can someone check lost and found?", source_at: "Web Form", incident_at: "Circle Line" },
    { title: "Toilet needs cleaning", description: "The station toilet at Yishun needs more frequent cleaning.", source_at: "Social Media", incident_at: "Yishun MRT" },
    { title: "Station Wi-Fi not working", description: "Free Wi-Fi at the station has not been working all week.", source_at: "Social Media", incident_at: "Kallang MRT" },
    { title: "Clearer signage to bus interchange", description: "Signage to the bus interchange exit could be clearer for first-time visitors.", source_at: "Web Form", incident_at: "Boon Lay MRT" },
    { title: "Helpful staff at Punggol", description: "The station staff at Punggol were very helpful with my stroller.", source_at: "Mobile App", incident_at: "Punggol MRT" },
    { title: "Lift slow during peak", description: "The lift at Buangkok is very slow during peak hours.", source_at: "Web Form", incident_at: "Buangkok MRT" }
  ];

  // Clusters of near-simultaneous reports about the same incident.
  var BURST_SCENARIOS = [
    { keyword: "smoke", location: "Tanjong Pagar MRT", reports: [
      ["Smoke on platform", "There is smoke coming out near the platform screen doors at Tanjong Pagar.", "Social Media"],
      ["Smell of smoke in station", "Strong smell of smoke at the Tanjong Pagar concourse, people are coughing.", "Web Form"],
      ["Smoke from tunnel?", "Saw smoke drifting out of the tunnel as the train pulled in.", "Mobile App"],
      ["Urgent: smoke seen", "Passengers are moving away from the platform because of smoke.", "Live IFS Feed"],
      ["Smoke near escalator", "Light smoke near the escalator to exit B, staff not around yet.", "Social Media"],
      ["Is there a fire?", "Lots of smoke and a burning smell at Tanjong Pagar, is there a fire?", "Web Form"]
    ] },
    { keyword: "signal fault", location: "East West Line", reports: [
      ["Train stuck due to signal fault", "Our train has been stopped for 10 minutes, the captain announced a signal fault.", "Social Media"],
      ["Signal fault delay", "Signal fault between Bugis and Lavender, massive delay.", "Web Form"],
      ["Another signal fault?", "Announcement says signal fault again. When will this be fixed?", "Mobile App"],
      ["Stranded because of signal fault", "Stuck in the tunnel for 15 minutes because of a signal fault.", "Live IFS Feed"],
      ["Signal fault - late for work", "The signal fault on the East West Line made me late for work.", "Email"],
      ["Slow trains after signal fault", "Trains crawling after the signal fault, the platform is packed.", "Social Media"]
    ] },
    { keyword: "platform crowding", location: "Jurong East MRT", reports: [
      ["Dangerous platform crowding", "Platform crowding at Jurong East is dangerous, people pushed near the edge.", "Social Media"],
      ["Platform crowding again", "Platform crowding is terrible tonight, cannot even get off the train.", "Web Form"],
      ["Severe platform crowding", "Severe platform crowding at the interchange, need crowd control.", "Mobile App"],
      ["No staff for platform crowding", "No staff managing the platform crowding at Jurong East.", "Live IFS Feed"],
      ["Platform crowding after delay", "After the delay the platform crowding became unbearable.", "Email"],
      ["Crowd control needed", "Please send staff, platform crowding at Jurong East is out of hand.", "Social Media"]
    ] },
    { keyword: "escalator breakdown", location: "Bugis MRT", reports: [
      ["Escalator breakdown at exit C", "Escalator breakdown at Bugis exit C, long queue for the stairs.", "Web Form"],
      ["Another escalator breakdown", "Second escalator breakdown this week at Bugis.", "Social Media"],
      ["Escalator breakdown - elderly stuck", "Escalator breakdown means elderly passengers cannot get up to the concourse.", "Mobile App"],
      ["Queue due to escalator breakdown", "Huge queue because of the escalator breakdown.", "Live IFS Feed"],
      ["Escalator breakdown reported", "Reporting an escalator breakdown near the ticketing gates at Bugis.", "Email"],
      ["Please fix escalator breakdown", "The escalator breakdown at Bugis has lasted over an hour.", "Web Form"]
    ] }
  ];

  function defaultSettings() {
    return { speed: "normal", burst: { windowMin: 15, baselineWindows: 4, minCount: 3, multiplier: 2 } };
  }

  function seedData() {
    var data = { users: JSON.parse(JSON.stringify(SEED_USERS)), feedback: [], alerts: [], settings: defaultSettings() };
    SEED_SOURCE.slice().sort(function (a, b) { return b[3] - a[3]; }).forEach(function (item, index) {
      var created = Date.now() - item[3] * 60000;
      var processed = created + rand(3500, 6500);
      var record = {
        queue_guid: "DEMO-" + String(index + 1).padStart(4, "0"),
        createdon: new Date(created).toISOString(),
        receivedon: new Date(created).toISOString(),
        title: item[0],
        description: item[1],
        source_at: index % 3 === 0 ? "Social Media" : "Web Form",
        incident_at: item[2],
        record_origin: "sample"
      };
      STAGES.forEach(function (stage) { stage.apply(data, record, processed); });
      record.status = "processed";
      record.processedon = new Date(processed).toISOString();
      data.feedback.unshift(record);
    });
    return data;
  }

  function loadData() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && parsed.feedback && parsed.settings) {
          catchUpClock(parsed);
          return parsed;
        }
      }
    } catch (e) { /* fall through to reseed */ }
    var fresh = seedData();
    saveData(fresh);
    return fresh;
  }

  function saveData(data) {
    data.savedAt = Date.now();
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch (e) { /* storage full or blocked */ }
  }

  // The charts only look at the last few minutes, so saved demo data would
  // look empty after a visitor has been away. Treat time as paused while the
  // page was closed: move every stored timestamp forward by the gap.
  function catchUpClock(data) {
    var gap = Date.now() - (data.savedAt || latestTimestamp(data));
    if (!(gap > 60000)) return;
    function iso(v) { return v ? new Date(new Date(v).getTime() + gap).toISOString() : v; }
    data.feedback.forEach(function (f) {
      ["createdon", "receivedon", "processedon", "assigned_on"].forEach(function (k) { f[k] = iso(f[k]); });
      if (f.stageStartedAt) f.stageStartedAt += gap;
      if (f.stageEndsAt) f.stageEndsAt += gap;
      if (f.assign_trace) {
        f.assign_trace.at = iso(f.assign_trace.at);
        f.assign_trace.rows.forEach(function (r) { if (r.lastAssigned !== null) r.lastAssigned += gap; });
      }
    });
    (data.alerts || []).forEach(function (a) {
      a.triggeredon = iso(a.triggeredon);
      a.resolvedon = iso(a.resolvedon);
      a.history.forEach(function (h) { h.at = iso(h.at); });
    });
    saveData(data);
  }

  function latestTimestamp(data) {
    return data.feedback.reduce(function (max, f) {
      return Math.max(max, new Date(f.processedon || f.receivedon || f.createdon).getTime() || 0);
    }, 0);
  }

  function receiveFeedback(incoming, createdOnIso) {
    var data = state.data;
    var now = Date.now();
    var record = {
      queue_guid: "GEN-" + now + "-" + Math.floor(Math.random() * 1000),
      createdon: createdOnIso || new Date(now).toISOString(),
      receivedon: new Date(now).toISOString(),
      title: incoming.title,
      description: incoming.description,
      source_at: incoming.source_at || "Manual Input",
      incident_at: incoming.incident_at || "Not specified",
      record_origin: incoming.record_origin || "live-generated",
      status: "queued"
    };
    data.feedback.unshift(record);
    trimRecords(data);
    saveData(data);
    renderDashboard();

    var tag = document.getElementById("lastEventTag");
    tag.textContent = "Received: " + record.title;
    tag.className = "tag";
    return record;
  }

  function trimRecords(data) {
    if (data.feedback.length <= MAX_RECORDS) return;
    var processed = data.feedback.filter(function (f) { return f.status === "processed"; });
    var excess = data.feedback.length - MAX_RECORDS;
    var drop = processed.slice(-excess);
    data.feedback = data.feedback.filter(function (f) { return drop.indexOf(f) === -1; });
  }

  // ---------------------------------------------------------------------
  // Background worker
  // ---------------------------------------------------------------------
  function workerTick() {
    var data = state.data;
    if (!data) return;
    var now = Date.now();
    var stageChanged = false;
    var completed = false;

    for (var guard = 0; guard < 50; guard++) {
      var current = data.feedback.find(function (f) { return f.status === "processing"; });
      if (!current) {
        var next = oldestQueued(data);
        if (!next) break;
        next.status = "processing";
        next.stage = 0;
        next.stageStartedAt = now;
        next.stageEndsAt = now + stageDuration(data, 0);
        stageChanged = true;
        continue;
      }
      if (now < current.stageEndsAt) break;

      STAGES[current.stage].apply(data, current, now);
      stageChanged = true;
      if (current.stage >= STAGES.length - 1) {
        current.status = "processed";
        current.processedon = new Date(now).toISOString();
        delete current.stage;
        delete current.stageStartedAt;
        delete current.stageEndsAt;
        completed = true;
      } else {
        current.stage += 1;
        current.stageStartedAt = now;
        current.stageEndsAt = now + stageDuration(data, current.stage);
      }
    }

    if (completed) {
      var fired = runAlerting(data, now);
      saveData(data);
      renderAll();
      announceAlerts(fired);
    } else if (stageChanged) {
      saveData(data);
      renderDashboard();
    } else {
      updatePipelineProgress();
    }
  }

  function oldestQueued(data) {
    var oldest = null;
    data.feedback.forEach(function (f) {
      if (f.status === "queued" && (!oldest || f.receivedon < oldest.receivedon)) oldest = f;
    });
    return oldest;
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
  // Formatting helpers
  // ---------------------------------------------------------------------
  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function fmtNum(v) {
    return Math.round(v) === v ? String(v) : v.toFixed(2);
  }

  function fmtSeconds(ms) {
    return (ms / 1000).toFixed(1) + "s";
  }

  function timeAgo(iso) {
    var s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
    if (s < 60) return s + "s ago";
    if (s < 3600) return Math.floor(s / 60) + "m ago";
    return Math.floor(s / 3600) + "h ago";
  }

  function fmtTime(iso) {
    return new Date(iso).toLocaleTimeString();
  }

  function staffName(data, email) {
    var u = data.users.find(function (u) { return u.email === email; });
    return u ? u.name : "Unassigned";
  }

  function processedRecords(data) {
    return data.feedback.filter(function (f) { return f.status === "processed"; });
  }

  // ---------------------------------------------------------------------
  // App state + rendering
  // ---------------------------------------------------------------------
  var state = {
    data: null,
    activeTab: "situational",
    explainKeyword: "",
    explainCase: "",
    replayStep: null,
    pipelineSignature: ""
  };

  function renderStats() {
    var data = state.data;
    var processed = processedRecords(data);
    var inPipeline = data.feedback.length - processed.length;
    var high = processed.filter(function (f) { return f.severity_level === "high"; }).length;
    var openAlerts = data.alerts.filter(function (a) { return a.status !== "resolved"; }).length;

    var recent = processed.filter(function (f) { return f.record_origin !== "sample"; }).slice(0, 20);
    var latency = recent.length
      ? recent.reduce(function (sum, f) { return sum + (new Date(f.processedon) - new Date(f.receivedon)); }, 0) / recent.length
      : null;

    document.getElementById("statReceived").textContent = data.feedback.length;
    document.getElementById("statQueue").textContent = inPipeline;
    document.getElementById("statProcessed").textContent = processed.length;
    document.getElementById("statHigh").textContent = high;
    document.getElementById("statAlerts").textContent = openAlerts;
    document.getElementById("statLatency").textContent = latency === null ? "-" : fmtSeconds(latency);

    var badge = document.getElementById("alertBadge");
    var active = data.alerts.filter(function (a) { return a.status === "active"; }).length;
    badge.textContent = openAlerts;
    badge.classList.toggle("hidden", openAlerts === 0);
    badge.classList.toggle("badge-active", active > 0);
  }

  function renderPipeline() {
    var data = state.data;
    var queued = data.feedback.filter(function (f) { return f.status === "queued"; })
      .sort(function (a, b) { return a.receivedon < b.receivedon ? -1 : 1; });
    var current = data.feedback.find(function (f) { return f.status === "processing"; });
    var done = processedRecords(data).slice()
      .sort(function (a, b) { return a.processedon < b.processedon ? 1 : -1; })
      .slice(0, 4);

    document.getElementById("pipelineStatus").textContent = current
      ? "Worker busy - " + queued.length + " waiting in queue"
      : (queued.length ? queued.length + " waiting" : "Worker idle - queue empty");

    var signature = queued.map(function (f) { return f.queue_guid; }).join(",") + "|" +
      (current ? current.queue_guid + ":" + current.stage : "") + "|" +
      done.map(function (f) { return f.queue_guid; }).join(",");
    if (signature === state.pipelineSignature) {
      updatePipelineProgress();
      return;
    }
    state.pipelineSignature = signature;

    function column(title, sub, body, cls) {
      return '<div class="pipe-col ' + (cls || "") + '"><div class="pipe-head"><div class="pipe-title">' + escapeHtml(title) +
        '</div><div class="pipe-sub">' + escapeHtml(sub) + '</div></div><div class="pipe-body">' + body + "</div></div>";
    }

    var queueBody = queued.slice(0, 4).map(function (f) {
      return '<div class="chip" data-guid="' + escapeHtml(f.queue_guid) + '"><div class="chip-title">' + escapeHtml(f.title) +
        '</div><div class="chip-meta">received ' + fmtTime(f.receivedon) + "</div></div>";
    }).join("");
    if (queued.length > 4) queueBody += '<div class="chip-more">+' + (queued.length - 4) + " more</div>";

    var html = column("Received", queued.length + " queued", queueBody, queued.length ? "has-items" : "");
    STAGES.forEach(function (stage, i) {
      var body = "";
      if (current && current.stage === i) {
        var sev = current.severity_level
          ? ' <span class="' + (current.severity_level === "high" ? "sev-high" : "sev-low") + '">' + current.severity_level.toUpperCase() + "</span>"
          : "";
        body = '<div class="chip chip-active" data-guid="' + escapeHtml(current.queue_guid) + '"><div class="chip-title">' +
          escapeHtml(current.title) + '</div><div class="chip-meta">stage ' + (i + 1) + "/" + STAGES.length + sev +
          '</div><div class="chip-progress"><span id="activeProgress"></span></div></div>';
      }
      html += column(stage.label, stage.detail, body, current && current.stage === i ? "active" : "");
    });
    html += column("Processed", "On dashboard", done.map(function (f) {
      return '<div class="chip chip-done" data-guid="' + escapeHtml(f.queue_guid) + '"><div class="chip-title">' + escapeHtml(f.title) +
        '</div><div class="chip-meta"><span class="' + (f.severity_level === "high" ? "sev-high" : "sev-low") + '">' +
        f.severity_level.toUpperCase() + "</span> &middot; " + fmtSeconds(new Date(f.processedon) - new Date(f.receivedon)) + "</div></div>";
    }).join(""), "done");

    document.getElementById("pipeline").innerHTML = html;
    updatePipelineProgress();
  }

  function updatePipelineProgress() {
    var bar = document.getElementById("activeProgress");
    if (!bar) return;
    var current = state.data.feedback.find(function (f) { return f.status === "processing"; });
    if (!current) return;
    var pct = (Date.now() - current.stageStartedAt) / (current.stageEndsAt - current.stageStartedAt);
    bar.style.width = Math.max(0, Math.min(1, pct)) * 100 + "%";
  }

  function renderTrend() {
    var data = state.data;
    var intervalMin = Math.max(1, Number(document.getElementById("trendInterval").value) || 5);
    var windowMin = Math.max(intervalMin, Number(document.getElementById("trendWindow").value) || 60);
    var since = Date.now() - windowMin * 60000;

    var records = processedRecords(data).filter(function (f) {
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
          "<td>" + fmtTime(record.createdon) + "</td>" +
          "<td>" + escapeHtml(record.title) + "</td>" +
          "<td>" + escapeHtml(record.incident_at) + "</td>" +
          "<td>" + escapeHtml((record.keywords || []).join(", ") || "-") + "</td>";
        tr.addEventListener("click", function () { showDetail(record); });
        tbody.appendChild(tr);
      });
  }

  function renderSurge() {
    var data = state.data;
    var s = data.settings.burst;
    var entries = evaluateBursts(data, Date.now()).filter(function (e) { return e.current > 0; }).slice(0, 10);

    var container = document.getElementById("surgeChart");
    if (!entries.length) {
      container.innerHTML = '<div class="chart-empty">No incident keywords in the last ' + s.windowMin + ' min. Try "Simulate incident burst".</div>';
      return;
    }

    var scale = 1.15 * Math.max.apply(null, entries.map(function (e) { return Math.max(e.current, e.threshold); }));
    container.innerHTML = entries.map(function (e) {
      return '<div class="hbar-row" data-keyword="' + escapeHtml(e.keyword) + '" title="Click to see how this keyword was evaluated">' +
        '<div class="hbar-label">' + escapeHtml(e.keyword) + "</div>" +
        '<div class="hbar-track"><div class="hbar-fill' + (e.isBurst ? " burst" : "") + '" style="width:' + (e.current / scale) * 100 + '%"></div>' +
        '<div class="hbar-threshold" style="left:' + (e.threshold / scale) * 100 + '%"></div></div>' +
        '<div class="hbar-count">' + e.current + "</div>" +
        '<div class="hbar-state">' + (e.isBurst ? '<span class="pill pill-burst">BURST</span>' : "") + "</div></div>";
    }).join("");
  }

  function renderAlerts() {
    var data = state.data;
    var live = {};
    evaluateBursts(data, Date.now()).forEach(function (e) { live[e.keyword] = e; });
    var open = data.alerts.filter(function (a) { return a.status !== "resolved"; });
    var resolved = data.alerts.filter(function (a) { return a.status === "resolved"; }).slice(0, 3);
    var list = document.getElementById("alertList");

    if (!open.length && !resolved.length) {
      list.innerHTML = '<div class="chart-empty small">No burst alerts. An alert fires when a keyword\'s count in the last ' +
        data.settings.burst.windowMin + ' min reaches max(min count, multiplier &times; baseline). Try "Simulate incident burst".</div>';
      return;
    }

    function item(a) {
      var ev = live[a.keyword];
      var trend = a.status === "resolved" ? "" : (ev && ev.isBurst
        ? '<span class="pill pill-burst">still bursting</span>'
        : '<span class="pill">subsided</span>');
      var actions = a.status === "resolved" ? "" :
        (a.status === "active" ? '<button class="btn btn-small" data-action="ack" data-id="' + a.id + '">Acknowledge</button>' : "") +
        '<button class="btn btn-small" data-action="resolve" data-id="' + a.id + '">Resolve</button>';
      return '<div class="alert-item level-' + a.level + " status-" + a.status + '">' +
        '<div class="alert-top"><span class="pill pill-' + a.level + '">' + a.level.toUpperCase() + "</span>" +
        '<span class="alert-kw">' + escapeHtml(a.keyword) + "</span>" +
        '<span class="pill pill-status">' + a.status + "</span>" + trend +
        '<span class="alert-time">' + fmtTime(a.triggeredon) + " &middot; " + timeAgo(a.triggeredon) + "</span></div>" +
        '<div class="alert-body">' + a.count + " reports in " + a.windowMin + " min &middot; baseline " + fmtNum(a.mean) +
        "/window &middot; threshold " + fmtNum(a.threshold) +
        (a.escalations ? " &middot; escalated " + a.escalations + "&times;" : "") +
        "<br>Locations: " + escapeHtml(a.locations.join(", ")) +
        '<br>Notified: ' + a.channels.map(function (c) { return '<span class="channel">' + escapeHtml(c) + "</span>"; }).join(" ") + "</div>" +
        '<div class="alert-actions"><button class="btn btn-small" data-action="reports" data-id="' + a.id + '">View reports</button>' +
        '<button class="btn btn-small" data-action="explain" data-id="' + a.id + '">How was this detected?</button>' + actions + "</div></div>";
    }

    list.innerHTML = open.map(item).join("") +
      (resolved.length ? '<div class="alert-divider">Recently resolved</div>' + resolved.map(item).join("") : "");
  }

  function renderCaseAssignment() {
    var data = state.data;
    var now = new Date();
    var processed = processedRecords(data);
    var staffBody = document.querySelector("#workloadTable tbody");
    staffBody.innerHTML = data.users.filter(function (u) { return !u.full; }).map(function (u) {
      var mine = processed.filter(function (f) { return f.assigned_to === u.email; });
      var today = mine.filter(function (f) { return sameDay(new Date(f.assigned_on), now); });
      var hour = today.filter(function (f) { return new Date(f.assigned_on).getHours() === now.getHours(); });
      return "<tr><td>" + escapeHtml(u.name) + "</td><td>" + u.team + '</td><td class="skills">' +
        u.skills.map(function (s) { return '<span class="skill">' + escapeHtml(s) + "</span>"; }).join(" ") + "</td>" +
        '<td><label class="leave-toggle"><input type="checkbox" data-email="' + escapeHtml(u.email) + '"' + (u.on_leave ? " checked" : "") +
        "> on leave</label></td><td>" + hour.length + "</td><td>" + today.length + "</td><td>" + mine.length + "</td></tr>";
    }).join("");

    var caseBody = document.querySelector("#caseTable tbody");
    caseBody.innerHTML = "";
    data.feedback.slice(0, 100).forEach(function (record) {
      var status, severity, assigned;
      if (record.status === "processed") {
        status = '<span class="pill pill-ok">Processed</span>';
        severity = '<span class="' + (record.severity_level === "high" ? "sev-high" : "sev-low") + '">' + record.severity_level.toUpperCase() + "</span>";
        assigned = record.assigned_to ? escapeHtml(staffName(data, record.assigned_to)) : '<span class="muted">No eligible staff</span>';
      } else {
        status = record.status === "queued"
          ? '<span class="pill">Queued</span>'
          : '<span class="pill pill-busy">' + escapeHtml(STAGES[record.stage].label) + "</span>";
        severity = record.severity_level
          ? '<span class="' + (record.severity_level === "high" ? "sev-high" : "sev-low") + '">' + record.severity_level.toUpperCase() + "</span>"
          : '<span class="muted">-</span>';
        assigned = '<span class="muted">Pending</span>';
      }
      var tr = document.createElement("tr");
      tr.innerHTML =
        "<td>" + new Date(record.createdon).toLocaleString() + "</td>" +
        "<td>" + escapeHtml(record.title) + "</td>" +
        "<td>" + status + "</td>" +
        "<td>" + severity + "</td>" +
        "<td>" + assigned + "</td>";
      tr.addEventListener("click", function () { showDetail(record); });
      caseBody.appendChild(tr);
    });
  }

  // ---------------------------------------------------------------------
  // "How it works" - burst detection explainer
  // ---------------------------------------------------------------------
  function setOptions(select, options, value) {
    var sig = options.map(function (o) { return o[0] + "=" + o[1]; }).join("|");
    if (select.getAttribute("data-sig") !== sig) {
      select.innerHTML = options.map(function (o) {
        return '<option value="' + escapeHtml(o[0]) + '">' + escapeHtml(o[1]) + "</option>";
      }).join("");
      select.setAttribute("data-sig", sig);
    }
    select.value = value;
  }

  function renderBurstExplainer() {
    var data = state.data;
    var s = data.settings.burst;
    var evals = evaluateBursts(data, Date.now());
    var select = document.getElementById("explainKeyword");
    var container = document.getElementById("burstExplain");

    if (!evals.length) {
      setOptions(select, [["", "Auto"]], "");
      container.innerHTML = '<div class="chart-empty">No incident keywords in the last ' + (s.windowMin * (s.baselineWindows + 1)) +
        ' min yet. Generate events or simulate a burst.</div>';
      document.getElementById("burstTable").innerHTML = "";
      return;
    }

    var ev = evals.find(function (e) { return e.keyword === state.explainKeyword; });
    var keywordLost = state.explainKeyword && !ev;
    if (!ev) ev = evals[0];
    setOptions(select, [["", "Auto (top keyword)"]].concat(evals.map(function (e) {
      return [e.keyword, e.keyword + " (" + e.current + ")"];
    })), keywordLost ? "" : state.explainKeyword);

    var verdict = ev.isBurst
      ? '<span class="pill pill-burst">BURST</span> ' + ev.current + " &ge; " + fmtNum(ev.threshold) + " &rarr; alert raised or escalated"
      : '<span class="pill">normal</span> ' + ev.current + " &lt; " + fmtNum(ev.threshold) + " &rarr; no alert";

    container.innerHTML =
      '<div class="explain-grid"><div>' + burstChartSvg(ev, s) +
      '<div class="legend"><span class="lg lg-base"></span>previous windows <span class="lg lg-cur"></span>current window ' +
      '<span class="lg lg-mean"></span>baseline mean <span class="lg lg-thresh"></span>alert threshold</div></div>' +
      '<ol class="steps">' +
      "<li><b>Count</b> processed reports mentioning <code>" + escapeHtml(ev.keyword) + "</code> in the last " + s.windowMin +
      " min: <b>" + ev.current + "</b></li>" +
      "<li><b>Baseline</b> from the " + s.baselineWindows + " windows before that: [" + ev.baseline.join(", ") +
      "] &rarr; mean <b>" + fmtNum(ev.mean) + "</b> per window</li>" +
      "<li><b>Threshold</b> = max(min count " + s.minCount + ", " + fmtNum(s.multiplier) + " &times; " + fmtNum(ev.mean) +
      " = " + fmtNum(ev.expected) + ") = <b>" + fmtNum(ev.threshold) + "</b></li>" +
      "<li><b>Compare</b>: " + verdict + "</li>" +
      "<li><b>De-duplicate</b>: one open alert per keyword. More reports escalate it; after it is resolved a new alert needs new reports.</li>" +
      "</ol></div>" +
      '<div class="contrib"><div class="contrib-title">Reports in the current window</div>' +
      (ev.records.map(function (g) {
        var r = findRecord(data, g);
        return r ? '<div class="contrib-row" data-guid="' + escapeHtml(g) + '"><span>' + fmtTime(r.createdon) + "</span><span>" +
          escapeHtml(r.title) + '</span><span class="muted">' + escapeHtml(r.incident_at) + "</span></div>" : "";
      }).join("") || '<div class="muted">None</div>') + "</div>";

    document.getElementById("burstTable").innerHTML =
      "<thead><tr><th>Keyword</th><th>Now</th><th>Previous windows</th><th>Mean</th><th>Threshold</th><th>vs normal</th><th>State</th></tr></thead><tbody>" +
      evals.map(function (e) {
        return '<tr data-keyword="' + escapeHtml(e.keyword) + '"' + (e.keyword === ev.keyword ? ' class="selected"' : "") + "><td>" +
          escapeHtml(e.keyword) + "</td><td>" + e.current + "</td><td>" + e.baseline.join(" &middot; ") + "</td><td>" + fmtNum(e.mean) +
          "</td><td>" + fmtNum(e.threshold) + "</td><td>" + (!e.current ? "-" : e.ratio === null ? "new" : e.ratio.toFixed(1) + "&times;") +
          "</td><td>" + (e.isBurst ? '<span class="pill pill-burst">BURST</span>' : '<span class="muted">normal</span>') + "</td></tr>";
      }).join("") + "</tbody>";
  }

  function burstChartSvg(ev, s) {
    var values = ev.baseline.concat([ev.current]);
    var maxV = Math.max(ev.threshold, Math.max.apply(null, values), 1) * 1.25;
    var W = 640, H = 250, padL = 34, padR = 118, padT = 14, padB = 42;
    var plotW = W - padL - padR, plotH = H - padT - padB;
    var n = values.length;
    var slot = plotW / n;
    var barW = Math.min(58, slot * 0.62);
    function y(v) { return padT + plotH - (v / maxV) * plotH; }
    var out = [];

    var step = Math.max(1, Math.ceil(maxV / 5));
    for (var g = 0; g <= maxV; g += step) {
      out.push('<line class="grid" x1="' + padL + '" x2="' + (padL + plotW) + '" y1="' + y(g) + '" y2="' + y(g) + '"/>');
      out.push('<text class="axis" x="' + (padL - 6) + '" y="' + (y(g) + 4) + '" text-anchor="end">' + g + "</text>");
    }

    var K = s.baselineWindows;
    values.forEach(function (v, i) {
      var x = padL + slot * i + (slot - barW) / 2;
      var isCur = i === n - 1;
      var cls = isCur ? (ev.isBurst ? "b-burst" : "b-current") : "b-base";
      out.push('<rect class="' + cls + '" x="' + x + '" y="' + y(v) + '" width="' + barW + '" height="' + Math.max(0, y(0) - y(v)) + '" rx="3"/>');
      out.push('<text class="val" x="' + (x + barW / 2) + '" y="' + (y(v) - 5) + '" text-anchor="middle">' + v + "</text>");
      var label = isCur ? "last " + s.windowMin + "m" : "-" + (K + 1 - i) * s.windowMin + " to -" + (K - i) * s.windowMin + "m";
      out.push('<text class="axis" x="' + (x + barW / 2) + '" y="' + (padT + plotH + 16) + '" text-anchor="middle">' + label + "</text>");
    });
    out.push('<text class="axis" x="' + (padL + plotW / 2) + '" y="' + (H - 4) + '" text-anchor="middle">time window (minutes before now)</text>');

    var yMean = y(ev.mean), yThr = y(ev.threshold);
    var meanLabelY = Math.abs(yMean - yThr) < 14 ? yThr + 16 : yMean + 4;
    out.push('<line class="l-mean" x1="' + padL + '" x2="' + (padL + plotW) + '" y1="' + yMean + '" y2="' + yMean + '"/>');
    out.push('<text class="l-mean-t" x="' + (padL + plotW + 6) + '" y="' + meanLabelY + '">mean ' + fmtNum(ev.mean) + "</text>");
    out.push('<line class="l-thresh" x1="' + padL + '" x2="' + (padL + plotW) + '" y1="' + yThr + '" y2="' + yThr + '"/>');
    out.push('<text class="l-thresh-t" x="' + (padL + plotW + 6) + '" y="' + (yThr + 4) + '">threshold ' + fmtNum(ev.threshold) + "</text>");

    return '<svg class="burst-svg" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Keyword counts per time window against the alert threshold">' +
      out.join("") + "</svg>";
  }

  // ---------------------------------------------------------------------
  // "How it works" - case assignment explainer
  // ---------------------------------------------------------------------
  function renderAssignExplainer() {
    var data = state.data;
    var cases = processedRecords(data).filter(function (f) { return f.assign_trace; })
      .sort(function (a, b) { return a.processedon < b.processedon ? 1 : -1; }).slice(0, 30);
    var select = document.getElementById("explainCase");
    var container = document.getElementById("assignExplain");

    if (!cases.length) {
      setOptions(select, [["", "Auto"]], "");
      container.innerHTML = '<div class="chart-empty">No processed cases yet.</div>';
      return;
    }

    var record = cases.find(function (c) { return c.queue_guid === state.explainCase; });
    var caseLost = state.explainCase && !record;
    if (!record) record = cases[0];
    setOptions(select, [["", "Latest case (auto)"]].concat(cases.map(function (c) {
      return [c.queue_guid, fmtTime(c.processedon) + " - " + c.title];
    })), caseLost ? "" : state.explainCase);

    var t = record.assign_trace;
    var reveal = state.replayStep === null ? 99 : state.replayStep;
    var chosenName = t.chosen ? staffName(data, t.chosen) : null;

    var funnel = t.steps.map(function (st, i) {
      var cls = i < reveal ? "done" : (i === reveal ? "active" : "pending");
      var count = i === t.steps.length - 1 && i <= reveal ? (chosenName || "none") : st.remaining;
      return '<div class="funnel-step ' + cls + '"><div class="fs-count">' + escapeHtml(count) + '</div><div class="fs-label">' +
        escapeHtml(st.label) + '</div><div class="fs-note">' + escapeHtml(st.note || "") + "</div></div>";
    }).join('<div class="funnel-arrow">&rsaquo;</div>');

    var rows = t.rows.map(function (r) {
      var out = r.outStep !== null && r.outStep <= reveal;
      var isChosen = r.email === t.chosen;
      var outcome = "";
      if (out) outcome = '<span class="muted">&#10005; ' + escapeHtml(t.steps[r.outStep].label) + ": " + escapeHtml(r.reason) + "</span>";
      else if (isChosen && reveal >= t.steps.length - 1) outcome = '<span class="chosen">&#10003; Assigned</span>';
      else outcome = '<span class="muted">still in</span>';
      var skillMatch = r.skills.indexOf(t.route.skill) !== -1;
      return '<tr class="' + (out ? "row-out" : "") + (isChosen && reveal >= t.steps.length - 1 ? " row-chosen" : "") + '"><td>' +
        escapeHtml(r.name) + "</td><td" + (r.team === t.route.team ? "" : ' class="miss"') + ">" + r.team + "</td><td" +
        (skillMatch ? "" : ' class="miss"') + ">" + (skillMatch ? "yes" : "no") + "</td><td" + (r.onLeave ? ' class="miss"' : "") + ">" +
        (r.onLeave ? "yes" : "no") + "</td><td>" + r.hourCount + "</td><td>" + r.dayCount + "</td><td>" +
        (r.lastAssigned ? new Date(r.lastAssigned).toLocaleTimeString() : "-") + "</td><td>" + outcome + "</td></tr>";
    }).join("");

    container.innerHTML =
      '<div class="case-summary"><b>' + escapeHtml(record.title) + "</b> &middot; " +
      '<span class="' + (record.severity_level === "high" ? "sev-high" : "sev-low") + '">' + record.severity_level.toUpperCase() + "</span> &middot; " +
      escapeHtml(record.main_category) + " &middot; via " + escapeHtml(record.source_at) + "</div>" +
      '<div class="route">Routing rule: <b>' + escapeHtml(t.route.rule) + '</b> &rarr; team <span class="skill">' + t.route.team +
      '</span> with skill <span class="skill">' + escapeHtml(t.route.skill) + "</span></div>" +
      '<div class="funnel">' + funnel + "</div>" +
      '<div class="table-wrap"><table class="explain-table"><thead><tr><th>Staff</th><th>Team</th><th>Has skill</th><th>On leave</th>' +
      "<th>This hour</th><th>Today</th><th>Last assigned</th><th>Outcome</th></tr></thead><tbody>" + rows + "</tbody></table></div>" +
      '<p class="card-sub">Counts are a snapshot taken at ' + fmtTime(t.at) + ", when the case was assigned. " +
      (t.chosen ? "" : "No one survived the filters, so the case waits for manual assignment.") + "</p>";
  }

  var replayTimer = null;

  function replayAssignment() {
    clearTimeout(replayTimer);
    var total = 6;
    state.replayStep = 0;
    renderAssignExplainer();
    (function nextStep() {
      replayTimer = setTimeout(function () {
        state.replayStep += 1;
        if (state.replayStep >= total) {
          state.replayStep = null;
          renderAssignExplainer();
          return;
        }
        renderAssignExplainer();
        nextStep();
      }, 900);
    })();
  }

  function renderDashboard() {
    renderStats();
    renderPipeline();
    renderAlerts();
    renderTrend();
    renderSurge();
    renderCaseAssignment();
  }

  function renderExplainers() {
    renderBurstExplainer();
    if (state.replayStep === null) renderAssignExplainer();
  }

  function renderAll() {
    renderDashboard();
    renderExplainers();
  }

  // ---------------------------------------------------------------------
  // Dialogs + toast
  // ---------------------------------------------------------------------
  function openDialog(title, rows, explain) {
    document.getElementById("detailTitle").textContent = title;
    document.getElementById("detailBody").innerHTML = rows.map(function (r) {
      return "<dt>" + escapeHtml(r[0]) + "</dt><dd>" + (r[2] ? r[1] : escapeHtml(r[1])) + "</dd>";
    }).join("");
    var btn = document.getElementById("detailExplainBtn");
    btn.classList.toggle("hidden", !explain);
    btn.textContent = explain ? explain.label : "";
    btn.onclick = explain ? function () { document.getElementById("detailDialog").close(); explain.run(); } : null;
    document.getElementById("detailDialog").showModal();
  }

  function showDetail(record) {
    var data = state.data;
    var processed = record.status === "processed";
    var statusText = processed ? "Processed" : (record.status === "queued" ? "Queued - waiting for the worker" : "Processing - " + STAGES[record.stage].label);
    var rows = [
      ["Status", statusText],
      ["Feedback time", new Date(record.createdon).toLocaleString()],
      ["Received", new Date(record.receivedon).toLocaleString()]
    ];
    if (processed) rows.push(["Processing time", fmtSeconds(new Date(record.processedon) - new Date(record.receivedon))]);
    rows.push(["Description", record.description], ["Source", record.source_at], ["Location", record.incident_at]);
    rows.push(["Severity", record.severity_level ? record.severity_level.toUpperCase() : "Pending"]);
    rows.push(["Keywords", record.keywords ? (record.keywords.join(", ") || "-") : "Pending"]);
    rows.push(["Category", record.main_category || "Pending"]);
    if (processed) {
      rows.push(["Routed to", record.assign_trace ? "Team " + record.assign_trace.route.team + " / " + record.assign_trace.route.skill : "-"]);
      rows.push(["Assigned to", record.assigned_to ? staffName(data, record.assigned_to) : "No eligible staff"]);
    } else {
      rows.push(["Assigned to", "Pending"]);
    }
    rows.push(["Queue GUID", record.queue_guid]);
    openDialog(record.title, rows, record.assign_trace ? {
      label: "Why this staff member?",
      run: function () { state.explainCase = record.queue_guid; switchTab("howto"); renderAssignExplainer(); scrollToId("assignCard"); }
    } : null);
  }

  function showAlertDetail(alert) {
    var data = state.data;
    var reports = alert.records.map(function (g) {
      var r = findRecord(data, g);
      return r ? escapeHtml(fmtTime(r.createdon) + " - " + r.title + " (" + r.source_at + ")") : "";
    }).filter(Boolean).join("<br>");
    var history = alert.history.map(function (h) { return escapeHtml(fmtTime(h.at) + " - " + h.text); }).join("<br>");
    openDialog("Burst alert: " + alert.keyword, [
      ["Level", alert.level.toUpperCase()],
      ["Status", alert.status],
      ["Triggered", new Date(alert.triggeredon).toLocaleString()],
      ["Reports", alert.count + " in " + alert.windowMin + " min (threshold " + fmtNum(alert.threshold) + ")"],
      ["Locations", alert.locations.join(", ")],
      ["Notified", alert.channels.join(", ")],
      ["Timeline", history, true],
      ["Linked reports", reports || "-", true]
    ], {
      label: "How was this detected?",
      run: function () { explainKeyword(alert.keyword); }
    });
  }

  function explainKeyword(keyword) {
    state.explainKeyword = keyword;
    switchTab("howto");
    renderBurstExplainer();
    scrollToId("burstCard");
  }

  function scrollToId(id) {
    var el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function showToast(message, kind) {
    var toast = document.getElementById("toast");
    toast.textContent = message;
    toast.className = "toast" + (kind === "alert" ? " toast-alert" : "");
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(function () { toast.classList.add("hidden"); }, kind === "alert" ? 6000 : 3200);
  }

  function switchTab(tab) {
    state.activeTab = tab;
    document.querySelectorAll(".tab-btn").forEach(function (b) {
      b.classList.toggle("active", b.getAttribute("data-tab") === tab);
    });
    document.getElementById("situationalView").classList.toggle("hidden", tab !== "situational");
    document.getElementById("assignmentView").classList.toggle("hidden", tab !== "assignment");
    document.getElementById("howtoView").classList.toggle("hidden", tab !== "howto");
  }

  // ---------------------------------------------------------------------
  // Live feed controls (mirrors the real demo's DemoLiveBar behaviour)
  // ---------------------------------------------------------------------
  var liveTimer = null;
  var workerTimer = null;
  var refreshTimer = null;
  var burstTimers = [];

  function pickTemplate() {
    var pool = Math.random() < 0.3 ? INCIDENT_TEMPLATES : ROUTINE_TEMPLATES;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function generateNow() {
    var advanceSeconds = Number(document.getElementById("advanceSelect").value) || 0;
    var createdOnIso = new Date(Date.now() + advanceSeconds * 1000).toISOString();
    receiveFeedback(pickTemplate(), createdOnIso);
  }

  function simulateBurst() {
    var scenario = BURST_SCENARIOS[Math.floor(Math.random() * BURST_SCENARIOS.length)];
    var count = 5 + Math.floor(Math.random() * 2);
    var delay = 0;
    for (var i = 0; i < count; i++) {
      (function (report, at) {
        burstTimers.push(setTimeout(function () {
          receiveFeedback({
            title: report[0], description: report[1], source_at: report[2],
            incident_at: scenario.location, record_origin: "burst-sim"
          });
        }, at));
      })(scenario.reports[i % scenario.reports.length], delay);
      delay += rand(1200, 3000);
    }
    showToast("Simulating " + count + " reports about '" + scenario.keyword + "' at " + scenario.location + " over ~" + Math.round(delay / 1000) + "s");
  }

  function setLive(enabled) {
    var dot = document.getElementById("liveDot");
    var statusText = document.getElementById("liveStatusText");
    if (liveTimer) { clearInterval(liveTimer); liveTimer = null; }
    if (enabled) {
      dot.classList.add("live");
      statusText.textContent = "Live feed running";
      var seconds = Number(document.getElementById("intervalSelect").value) || 10;
      liveTimer = setInterval(generateNow, seconds * 1000);
    } else {
      dot.classList.remove("live");
      statusText.textContent = "Live feed paused";
    }
    try { localStorage.setItem(LIVE_KEY, enabled ? "true" : "false"); } catch (e) { /* ignore */ }
  }

  function readBurstSettings() {
    var s = state.data.settings.burst;
    s.windowMin = Math.max(1, Number(document.getElementById("burstWindow").value) || 15);
    s.baselineWindows = Math.max(1, Math.min(12, Number(document.getElementById("burstBaseline").value) || 4));
    s.minCount = Math.max(1, Number(document.getElementById("burstMinCount").value) || 3);
    s.multiplier = Math.max(1, Number(document.getElementById("burstMultiplier").value) || 2);
  }

  function writeSettingsToInputs() {
    var s = state.data.settings;
    document.getElementById("burstWindow").value = s.burst.windowMin;
    document.getElementById("burstBaseline").value = s.burst.baselineWindows;
    document.getElementById("burstMinCount").value = s.burst.minCount;
    document.getElementById("burstMultiplier").value = s.burst.multiplier;
    document.getElementById("speedSelect").value = s.speed;
  }

  function stopTimers() {
    setLive(false);
    clearInterval(workerTimer);
    clearInterval(refreshTimer);
    burstTimers.forEach(clearTimeout);
    burstTimers = [];
  }

  // ---------------------------------------------------------------------
  // Auth (cosmetic only - matches the real demo's fake login)
  // ---------------------------------------------------------------------
  function isAuthed() {
    try { return localStorage.getItem(AUTH_KEY) === "true"; } catch (e) { return false; }
  }

  function showApp() {
    document.getElementById("loginView").classList.add("hidden");
    document.getElementById("appView").classList.remove("hidden");
    state.data = loadData();
    state.pipelineSignature = "";
    writeSettingsToInputs();
    renderAll();
    var wasLive = false;
    try { wasLive = localStorage.getItem(LIVE_KEY) === "true"; } catch (e) { /* ignore */ }
    document.getElementById("liveToggle").checked = wasLive;
    setLive(wasLive);
    clearInterval(workerTimer);
    clearInterval(refreshTimer);
    workerTimer = setInterval(workerTick, WORKER_TICK_MS);
    refreshTimer = setInterval(function () {
      var fired = runAlerting(state.data, Date.now());
      if (fired.length) saveData(state.data);
      renderAll();
      announceAlerts(fired);
    }, REFRESH_MS);
  }

  function showLogin() {
    document.getElementById("appView").classList.add("hidden");
    document.getElementById("loginView").classList.remove("hidden");
    stopTimers();
  }

  // ---------------------------------------------------------------------
  // Wire up events
  // ---------------------------------------------------------------------
  document.addEventListener("DOMContentLoaded", function () {
    document.getElementById("loginForm").addEventListener("submit", function (e) {
      e.preventDefault();
      try { localStorage.setItem(AUTH_KEY, "true"); } catch (err) { /* ignore */ }
      showApp();
    });

    document.getElementById("logoutBtn").addEventListener("click", function () {
      try { localStorage.removeItem(AUTH_KEY); } catch (e) { /* ignore */ }
      showLogin();
    });

    document.querySelectorAll(".tab-btn").forEach(function (btn) {
      btn.addEventListener("click", function () { switchTab(btn.getAttribute("data-tab")); });
    });

    document.getElementById("alertBellBtn").addEventListener("click", function () {
      switchTab("situational");
      scrollToId("alertsCard");
    });

    document.getElementById("generateNowBtn").addEventListener("click", generateNow);
    document.getElementById("burstBtn").addEventListener("click", simulateBurst);

    document.getElementById("liveToggle").addEventListener("change", function (e) {
      setLive(e.target.checked);
    });

    document.getElementById("intervalSelect").addEventListener("change", function () {
      if (document.getElementById("liveToggle").checked) setLive(true);
    });

    document.getElementById("speedSelect").addEventListener("change", function (e) {
      state.data.settings.speed = e.target.value;
      saveData(state.data);
    });

    ["trendInterval", "trendWindow"].forEach(function (id) {
      document.getElementById(id).addEventListener("change", renderTrend);
    });

    ["burstWindow", "burstBaseline", "burstMinCount", "burstMultiplier"].forEach(function (id) {
      document.getElementById(id).addEventListener("change", function () {
        readBurstSettings();
        var fired = runAlerting(state.data, Date.now());
        saveData(state.data);
        renderAll();
        announceAlerts(fired);
      });
    });

    document.getElementById("surgeChart").addEventListener("click", function (e) {
      var row = e.target.closest("[data-keyword]");
      if (row) explainKeyword(row.getAttribute("data-keyword"));
    });

    document.getElementById("pipeline").addEventListener("click", function (e) {
      var chip = e.target.closest("[data-guid]");
      if (!chip) return;
      var record = findRecord(state.data, chip.getAttribute("data-guid"));
      if (record) showDetail(record);
    });

    document.getElementById("alertList").addEventListener("click", function (e) {
      var btn = e.target.closest("[data-action]");
      if (!btn) return;
      var alert = state.data.alerts.find(function (a) { return a.id === btn.getAttribute("data-id"); });
      if (!alert) return;
      var action = btn.getAttribute("data-action");
      var at = new Date().toISOString();
      if (action === "ack") {
        alert.status = "acknowledged";
        alert.history.push({ at: at, text: "Acknowledged by Demo Admin" });
      } else if (action === "resolve") {
        alert.status = "resolved";
        alert.resolvedon = at;
        alert.history.push({ at: at, text: "Resolved by Demo Admin" });
      } else if (action === "reports") {
        showAlertDetail(alert);
        return;
      } else if (action === "explain") {
        explainKeyword(alert.keyword);
        return;
      }
      saveData(state.data);
      renderDashboard();
    });

    document.getElementById("workloadTable").addEventListener("change", function (e) {
      var email = e.target.getAttribute("data-email");
      var user = email && state.data.users.find(function (u) { return u.email === email; });
      if (!user) return;
      user.on_leave = e.target.checked;
      saveData(state.data);
      renderDashboard();
      showToast(user.name + (user.on_leave ? " is now on leave and will be skipped" : " is back and eligible for new cases"));
    });

    document.getElementById("explainKeyword").addEventListener("change", function (e) {
      state.explainKeyword = e.target.value;
      renderBurstExplainer();
    });

    document.getElementById("burstTable").addEventListener("click", function (e) {
      var row = e.target.closest("[data-keyword]");
      if (!row) return;
      state.explainKeyword = row.getAttribute("data-keyword");
      renderBurstExplainer();
    });

    document.getElementById("burstExplain").addEventListener("click", function (e) {
      var row = e.target.closest("[data-guid]");
      if (!row) return;
      var record = findRecord(state.data, row.getAttribute("data-guid"));
      if (record) showDetail(record);
    });

    document.getElementById("explainCase").addEventListener("change", function (e) {
      state.explainCase = e.target.value;
      clearTimeout(replayTimer);
      state.replayStep = null;
      renderAssignExplainer();
    });

    document.getElementById("replayBtn").addEventListener("click", replayAssignment);

    document.getElementById("resetDemoBtn").addEventListener("click", function () {
      burstTimers.forEach(clearTimeout);
      burstTimers = [];
      clearTimeout(replayTimer);
      state.replayStep = null;
      state.explainKeyword = "";
      state.explainCase = "";
      state.pipelineSignature = "";
      state.data = seedData();
      saveData(state.data);
      writeSettingsToInputs();
      renderAll();
      document.getElementById("lastEventTag").className = "tag hidden";
      showToast("Demo data restored");
    });

    if (isAuthed()) showApp(); else showLogin();
  });
})();
