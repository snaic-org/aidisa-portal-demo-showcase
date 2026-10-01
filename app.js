// AIDISA Portal - standalone GitHub Pages demo.
// Fully static and client-side: no server, no API routes, no build step.
// All data is synthetic, generated locally with simple rules and kept in
// localStorage. This file is independent of the real aidisa_portal_frontend
// app - nothing here is shared with or read by that codebase.

(function () {
  "use strict";

  // Bumped when the saved data shape or sample set changes, so returning
  // visitors get the current seed data instead of an incompatible old save.
  var STORAGE_KEY = "aidisa-pages-demo-v3";
  var OLD_STORAGE_KEYS = ["aidisa-pages-demo-v2"];
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
    "suspicious bag", "suspicious item", "explosion", "flood", "electrocut", "burning smell",
    "track fault", "signal fault", "train fault", "power fault"
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
    "obstruction", "delay", "service disruption", "collision",
    "track fault", "train fault", "no aircon", "escalator jerk"
  ];

  // Assumption used to contrast AI detection with a manual inbox review.
  var MANUAL_REVIEW_MIN = 15;

  var SUGGESTED_ACTIONS = {
    "burning smell": "Ask the control centre to hold the train at the next station, send engineers to inspect it, and tell passengers what is happening.",
    "track fault": "Notify the operations control centre, start bridging buses, and put staff on platforms with clear updates and travel chits.",
    "train door": "Notify the control centre, check the door closing time and sensors on the affected line, and follow up with injured passengers.",
    "no aircon": "Log the train car numbers, ask engineering to inspect the air-conditioning, and withdraw the cars if the fault is confirmed.",
    "escalator fault": "Stop the escalator, put up a barrier, and ask engineering to inspect it before it is used again.",
    "smoke": "Dispatch station staff to the platform, alert the control centre, and prepare a passenger advisory.",
    "fire": "Dispatch station staff, alert the control centre, and prepare an evacuation advisory.",
    "signal fault": "Notify the operations control centre, check the affected line segment, and prepare a service-disruption advisory.",
    "signal failure": "Notify the operations control centre and prepare a service-disruption advisory.",
    "train breakdown": "Notify the operations control centre, arrange recovery, and publish a delay advisory.",
    "power fault": "Notify engineering, check traction power, and publish a delay advisory.",
    "medical emergency": "Send first-aid staff and call emergency services.",
    "suspicious bag": "Alert security, cordon off the area, and follow the unattended-item procedure.",
    "unattended bag": "Alert security, cordon off the area, and follow the unattended-item procedure.",
    "flooding": "Dispatch maintenance, block off affected areas, and warn passengers of slippery floors.",
    "physical assault": "Alert security and the police, and send staff to the location."
  };

  function suggestedAction(alert) {
    return SUGGESTED_ACTIONS[alert.keyword] ||
      (alert.level === "critical"
        ? "Notify the duty manager, send staff to the listed locations, and review the linked reports."
        : "Review the linked reports and watch the trend; escalate if the count keeps rising.");
  }

  function detectionLatency(data, alert) {
    var times = alert.records.map(function (g) {
      var r = findRecord(data, g);
      return r ? new Date(r.createdon).getTime() : NaN;
    }).filter(function (t) { return !isNaN(t); });
    if (!times.length) return null;
    var first = Math.min.apply(null, times);
    return { firstIso: new Date(first).toISOString(), ms: Math.max(0, new Date(alert.triggeredon).getTime() - first) };
  }

  function highlightTerms(text, terms) {
    var list = terms.filter(Boolean).sort(function (a, b) { return b.length - a.length; });
    if (!list.length) return escapeHtml(text);
    var re = new RegExp("(" + list.map(function (t) { return t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }).join("|") + ")", "ig");
    return text.split(re).map(function (part, i) {
      return i % 2 ? '<mark class="ai-mark">' + escapeHtml(part) + "</mark>" : escapeHtml(part);
    }).join("");
  }

  // Fills {t}, {t1}.. and {d} tokens in raw channel text with the receive time.
  function fillTokens(text, ms) {
    var d = new Date(ms);
    function hhmm(extra) {
      var x = new Date(ms + extra * 60000);
      return String(x.getHours()).padStart(2, "0") + ":" + String(x.getMinutes()).padStart(2, "0");
    }
    return String(text || "")
      .replace(/\{t(\d*)\}/g, function (m, n) { return hhmm(Number(n) || 0); })
      .replace(/\{d\}/g, String(d.getDate()).padStart(2, "0") + "/" + String(d.getMonth() + 1).padStart(2, "0") + "/" + d.getFullYear());
  }

  function recordText(record) {
    return ((record.title || "") + " " + (record.description || "")).toLowerCase();
  }

  // Service-affecting but not safety-critical.
  var MEDIUM_SEVERITY_TERMS = [
    "lift fault", "escalator fault", "escalator jerk", "water leak", "no aircon", "delay",
    "crowding", "overcrowded", "stuck", "lift breakdown"
  ];

  function detectSeverity(text) {
    function hits(list) { return list.filter(function (term) { return text.indexOf(term) !== -1; }); }
    var high = hits(HIGH_SEVERITY_TERMS);
    if (high.length) return { severity_level: "high", keyevent_monitor_matched: high.join(", ") };
    var medium = hits(MEDIUM_SEVERITY_TERMS);
    return { severity_level: medium.length ? "medium" : "low", keyevent_monitor_matched: medium.join(", ") };
  }

  // Sentiment index, 1 (Very Negative) to 5 (Very Positive). In production
  // this is TranSent-X (Transport Sentiment Experience), a fine-tuned RoBERTa
  // model; the demo approximates it with simple cues so it runs offline.
  var SENTIMENT_NAMES = ["", "Very Negative", "Negative", "Neutral", "Positive", "Very Positive"];
  function scoreSentiment(record) {
    // Ignore operator replies and email boilerplate - only the customer's words count.
    var text = recordText(record).split(/\n/).filter(function (line) {
      return !/smrt snap rep|caution: this email originated/.test(line);
    }).join(" ");
    // Praise needs real compliment wording; a polite "thanks" at the end of a
    // complaint is not positive.
    var strongPos = /thank you so much|very grateful|exceptional|kudos|well done|keep up the good|truly appreciate|deserves a raise|best services/.test(text);
    var pos = strongPos || /compliment|commend|grateful|appreciate|helpful|helped|kindness|thanks to|thank you very much|very happy|thank you for (helping|your help|the help)/.test(text);
    var strongNeg = /unacceptable|ridiculous|rude|dangerous|disgust|angry|\bsia\b|cannot tahan|wtf|sauna|bbq|kena|!!!/.test(text);
    if (pos && !strongNeg && record.severity_level !== "high") return strongPos ? 5 : 4;
    if (pos && strongPos && !strongNeg) return 4;
    if (record.severity_level === "high") return strongNeg || /!!/.test(text) ? 1 : 2;
    if (strongNeg) return 1;
    if (record.severity_level === "medium") return 2;
    return /\?|can i|may i|please advise|please clarify|suggest|would like to (check|know|enquire)/.test(text) ? 3 : 2;
  }

  function sevClass(level) { return "sev-" + (level || "low"); }

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
    { key: "preprocess", label: "Pre-processing", detail: "Clean & normalise text", kind: "rule", method: "Rule-based", ms: [600, 1200],
      apply: function () {} },
    { key: "severity", label: "Severity model", detail: "Few-shot LLM prompt", kind: "ai", method: "AI · LLM", ms: [900, 1900],
      apply: function (data, r) { Object.assign(r, detectSeverity(recordText(r))); } },
    { key: "keywords", label: "Keyword / NER", detail: "Few-shot LLM extraction", kind: "ai", method: "AI · LLM", ms: [800, 1700],
      apply: function (data, r) { r.keywords = extractKeywords(recordText(r)); } },
    { key: "sentiment", label: "Sentiment index", detail: "TranSent-X (RoBERTa)", kind: "tx", method: "AI · RoBERTa", ms: [700, 1500],
      apply: function (data, r) { r.sentiment = scoreSentiment(r); } },
    { key: "category", label: "Category classifier", detail: "Trained SVC model", kind: "ml", method: "ML · SVC", ms: [600, 1400],
      apply: function (data, r) { r.main_category = categorize(recordText(r)); } },
    { key: "assign", label: "Case assignment", detail: "Route & pick staff", kind: "rule", method: "Rule-based", ms: [500, 1000],
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
  var TEAM_NAMES = { CR: "Customer Relations", CW: "Customer Welfare", ADMIN: "Admin" };
  function teamName(code) { return TEAM_NAMES[code] || code; }

  function routeCase(record) {
    var social = record.source_at === "Social Media";
    if (record.main_category === "Lost and Found") return { team: "CW", skill: "lost_and_found", rule: "Lost and found enquiry" };
    if (record.main_category === "Compliment") return { team: "CR", skill: "compliment", rule: "Compliment" };
    if (social) return { team: "CR", skill: "feedback_reply_socialmedia", rule: "Feedback received via social media" };
    if (record.severity_level === "high") return { team: "CR", skill: "feedback_reply", rule: "High-severity feedback" };
    return { team: "CW", skill: "feedback_reply", rule: record.severity_level === "medium" ? "Medium-severity feedback" : "Low-severity feedback" };
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
      function (r) { return r.team !== route.team ? teamName(r.team) + " (needs " + teamName(route.team) + ")" : "No " + route.skill + " skill"; });
    steps.push({ label: "Team & skill", remaining: alive.length, note: teamName(route.team) + " / " + route.skill });

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
  // Keyword surge detection. Only reports whose AI severity is one of the
  // selected levels (default: High only) are counted. A keyword surges when
  // its count in the last N minutes reaches the threshold:
  //   surge = count of selected-severity reports in window >= threshold
  // A few earlier windows are counted too, purely for the history chart.
  // ---------------------------------------------------------------------
  var HISTORY_WINDOWS = 6;
  var SEVERITY_LABELS = { high: "High", medium: "Medium", low: "Low" };

  function severityText(sevs) {
    return sevs.map(function (v) { return SEVERITY_LABELS[v]; }).join(" + ");
  }

  function evaluateBursts(data, nowMs) {
    var s = data.settings.burst;
    var W = s.windowMin * 60000;
    var K = HISTORY_WINDOWS;
    var start = nowMs - W * (K + 1);
    var sevs = s.severities;
    var stats = {};

    data.feedback.forEach(function (rec) {
      if (rec.status !== "processed" || sevs.indexOf(rec.severity_level) === -1) return;
      var t = new Date(rec.createdon).getTime();
      if (t < start) return;
      (rec.keywords || []).forEach(function (k) {
        var st = stats[k];
        if (!st) {
          st = stats[k] = { keyword: k, current: 0, history: [], records: [] };
          for (var i = 0; i < K; i++) st.history.push(0);
        }
        if (t >= nowMs - W) {
          st.current += 1;
          st.records.push(rec.queue_guid);
        } else {
          var idx = Math.floor((nowMs - W - t) / W);
          if (idx >= 0 && idx < K) st.history[K - 1 - idx] += 1;
        }
      });
    });

    return Object.keys(stats).map(function (k) {
      var st = stats[k];
      st.threshold = s.minCount;
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
        threshold: ev.threshold,
        windowMin: data.settings.burst.windowMin,
        records: ev.records.slice(),
        locations: uniqueLocations(data, ev.records),
        channels: channels,
        history: [
          { at: at, text: "Surge detected: " + ev.current + " reports vs threshold " + fmtNum(ev.threshold) },
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
      : "Surge alert: '" + f.alert.keyword + "' - " + f.alert.count + " reports in " + f.alert.windowMin + " min. Mock email sent to " + DUTY_EMAIL;
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
    { email: "evan@demo.local", name: "Evan Goh", team: "CW", skills: ["feedback_reply"] },
    { email: "grace@demo.local", name: "Grace Koh", team: "CR", skills: ["feedback_reply", "compliment", "feedback_fyi"] },
    { email: "hafiz@demo.local", name: "Hafiz Rahman", team: "CR", skills: ["feedback_reply", "feedback_reply_socialmedia"] },
    { email: "irene@demo.local", name: "Irene Lau", team: "CR", skills: ["feedback_reply_socialmedia", "compliment"], on_leave: true },
    { email: "jason@demo.local", name: "Jason Teo", team: "CW", skills: ["feedback_reply", "lost_and_found"] },
    { email: "kavitha@demo.local", name: "Kavitha Raj", team: "CW", skills: ["feedback_reply", "lost_and_found", "feedback_fyi"] }
  ];

  // Sample feedback lives in samples.js so the sentiment dashboard can reuse it.
  var SEED_SOURCE = window.AIDISA_SAMPLES.seeds;
  var INCIDENT_TEMPLATES = window.AIDISA_SAMPLES.incidents;
  var ROUTINE_TEMPLATES = window.AIDISA_SAMPLES.routines;
  var BURST_SCENARIOS = window.AIDISA_SAMPLES.scenarios;

  function defaultSettings() {
    return { speed: "normal", burst: { windowMin: 15, minCount: 3, severities: ["high"] } };
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
        description: fillTokens(item[1], created),
        source_at: item[4] || (index % 3 === 0 ? "Social Media" : "Web Form"),
        incident_at: item[2],
        record_origin: "sample"
      };
      STAGES.forEach(function (stage) { stage.apply(data, record, processed); });
      record.status = "processed";
      record.processedon = new Date(processed).toISOString();
      data.feedback.unshift(record);
    });

    // Default bursts so the Alerts button and the incident count have
    // something to show on first load: [scenario keyword, report indexes,
    // minutes-ago for each report].
    var seq = 0;
    [
      ["burning smell", [0, 1, 2, 3], [11, 8, 5, 2]],
      ["track fault", [0, 2, 3], [13, 9, 4]],
      ["train door", [0, 1, 3], [12, 7, 3]]
    ].forEach(function (b) {
      var sc = BURST_SCENARIOS.find(function (x) { return x.keyword === b[0]; });
      b[1].forEach(function (ri, i) {
        var created = Date.now() - b[2][i] * 60000;
        var processed = created + rand(3500, 6500);
        var rep = sc.reports[ri];
        seq += 1;
        var record = {
          queue_guid: "DEMO-BURST-" + seq,
          createdon: new Date(created).toISOString(),
          receivedon: new Date(created).toISOString(),
          title: rep[0],
          description: fillTokens(rep[1], created),
          source_at: rep[2],
          incident_at: sc.location,
          record_origin: "sample"
        };
        STAGES.forEach(function (stage) { stage.apply(data, record, processed); });
        record.status = "processed";
        record.processedon = new Date(processed).toISOString();
        data.feedback.unshift(record);
      });
    });
    runAlerting(data, Date.now());
    return data;
  }

  function loadData() {
    try { OLD_STORAGE_KEYS.forEach(function (k) { localStorage.removeItem(k); }); } catch (e) { /* ignore */ }
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && parsed.feedback && parsed.settings) {
          // Older saves used a baseline/multiplier rule; keep window + threshold.
          var b = parsed.settings.burst || {};
          parsed.settings.burst = {
            windowMin: b.windowMin || 15,
            minCount: b.minCount || 3,
            severities: Array.isArray(b.severities) && b.severities.length ? b.severities : ["high"]
          };
          // Add any staff introduced since this save was made.
          SEED_USERS.forEach(function (u) {
            if (!parsed.users.some(function (x) { return x.email === u.email; })) parsed.users.push(JSON.parse(JSON.stringify(u)));
          });
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
      description: fillTokens(incoming.description, now),
      source_at: incoming.source_at || "Manual Input",
      incident_at: incoming.incident_at || "Not specified",
      record_origin: incoming.record_origin || "live-generated",
      status: "queued"
    };
    data.feedback.unshift(record);
    trimRecords(data);
    saveData(data);
    renderDashboard();
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
    var openAlerts = data.alerts.filter(function (a) { return a.status !== "resolved"; }).length;

    renderOverview(processed, inPipeline, openAlerts);

    var badge = document.getElementById("alertBadge");
    var active = data.alerts.filter(function (a) { return a.status === "active"; }).length;
    badge.textContent = openAlerts;
    badge.classList.toggle("badge-active", active > 0);
  }

  // User-facing overview: incident counts, active alerts, the top issue and a
  // heartbeat line of the last hour (all feedback vs critical incidents).
  function renderOverview(processed, inPipeline, openAlerts) {
    var data = state.data;
    var now = Date.now();
    var HOUR = 3600000;
    var inLast = function (f, from, to) {
      var t = new Date(f.createdon).getTime();
      return t >= from && t < to;
    };
    var hour = processed.filter(function (f) { return inLast(f, now - HOUR, now + 1); });
    var crit = hour.filter(function (f) { return f.severity_level === "high"; });

    // Incidents = burst incidents: alerts triggered in the last hour.
    var bursts = data.alerts.filter(function (a) { return inLast({ createdon: a.triggeredon }, now - HOUR, now + 1); });
    var incEl = document.getElementById("ovIncidents");
    document.getElementById("ovIncidentsValue").textContent = bursts.length;
    incEl.classList.toggle("ov-danger", bursts.length > 0);
    var reports = bursts.reduce(function (n, a) { return n + a.count; }, 0);
    document.getElementById("ovIncidentsSub").textContent = bursts.length
      ? reports + " reports across " + bursts.length + " surge" + (bursts.length > 1 ? "s" : "") +
        " · latest: " + bursts[0].keyword + " at " + (bursts[0].locations[0] || "multiple locations")
      : "No incident surges detected";

    var open = data.alerts.filter(function (a) { return a.status !== "resolved"; });
    // Top issue follows the bursts: the open alert with the most reports,
    // falling back to the busiest keyword when nothing is bursting.
    var topAlert = open.slice().sort(function (x, y) {
      return (y.level === "critical") - (x.level === "critical") || y.count - x.count;
    })[0];
    var top = topAlert ? null : evaluateBursts(data, now).filter(function (e) { return e.current > 0; })[0];
    document.getElementById("ovTopValue").textContent = topAlert ? topAlert.keyword : (top ? top.keyword : "None");
    document.getElementById("ovTopSub").textContent = topAlert
      ? topAlert.count + " reports in " + data.settings.burst.windowMin + " min · " + (topAlert.locations[0] || "multiple locations")
      : (top
        ? top.current + " report" + (top.current > 1 ? "s" : "") + " in " + data.settings.burst.windowMin + " min · below threshold"
        : "No " + severityText(data.settings.burst.severities) + "-severity incidents in the current window");
    document.getElementById("ovTopIssue").classList.toggle("ov-danger", !!topAlert);

    document.getElementById("ovFeedbackValue").textContent = hour.length;
    document.getElementById("ovFeedbackSub").textContent = inPipeline
      ? inPipeline + " being analysed by AI now"
      : "All analysed and routed";

    renderHeartbeat(hour, now);
  }

  function renderHeartbeat(hour, now) {
    var N = 20, STEP = 3 * 60000, start = now - N * STEP;
    var all = [], crit = [];
    for (var i = 0; i < N; i++) { all.push(0); crit.push(0); }
    hour.forEach(function (f) {
      var idx = Math.floor((new Date(f.createdon).getTime() - start) / STEP);
      if (idx < 0 || idx >= N) return;
      all[idx] += 1;
      if (f.severity_level === "high") crit[idx] += 1;
    });
    var max = Math.max(2, Math.max.apply(null, all));
    var W = 600, H = 80, pad = 6;
    function pts(arr) {
      return arr.map(function (v, i) {
        return (i * W / (N - 1)).toFixed(1) + "," + (H - pad - v / max * (H - 2 * pad)).toFixed(1);
      });
    }
    var a = pts(all), c = pts(crit);
    document.getElementById("hbChart").innerHTML =
      '<svg viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="none" role="img" aria-label="Feedback and critical incidents over the last hour">' +
      '<line x1="0" y1="' + (H - pad) + '" x2="' + W + '" y2="' + (H - pad) + '" class="hb-base"/>' +
      '<polygon points="0,' + (H - pad) + " " + a.join(" ") + " " + W + "," + (H - pad) + '" class="hb-area"/>' +
      '<polyline points="' + a.join(" ") + '" class="hb-line-all"/>' +
      '<polyline points="' + c.join(" ") + '" class="hb-line-crit"/></svg>';
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

    function column(title, sub, body, cls, stage) {
      var badge = stage ? '<span class="method method-' + stage.kind + '">' + escapeHtml(stage.method) + "</span>" : "";
      return '<div class="pipe-col ' + (cls || "") + '"><div class="pipe-head">' + badge + '<div class="pipe-title">' + escapeHtml(title) +
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
          ? ' <span class="' + sevClass(current.severity_level) + '">' + current.severity_level.toUpperCase() + "</span>"
          : "";
        body = '<div class="chip chip-active" data-guid="' + escapeHtml(current.queue_guid) + '"><div class="chip-title">' +
          escapeHtml(current.title) + '</div><div class="chip-meta">stage ' + (i + 1) + "/" + STAGES.length + sev +
          '</div><div class="chip-progress"><span id="activeProgress"></span></div></div>';
      }
      html += column(stage.label, stage.detail, body, current && current.stage === i ? "active" : "", stage);
    });
    html += column("Processed", "On dashboard", done.map(function (f) {
      return '<div class="chip chip-done" data-guid="' + escapeHtml(f.queue_guid) + '"><div class="chip-title">' + escapeHtml(f.title) +
        '</div><div class="chip-meta"><span class="' + sevClass(f.severity_level) + '">' +
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
      container.innerHTML = '<div class="chart-empty">No incident keywords in the last ' + s.windowMin + ' min. Try "Simulate incident surge".</div>';
      return;
    }

    var scale = 1.15 * Math.max.apply(null, entries.map(function (e) { return Math.max(e.current, e.threshold); }));
    container.innerHTML = entries.map(function (e) {
      return '<div class="hbar-row" data-keyword="' + escapeHtml(e.keyword) + '" title="Click to see how this keyword was evaluated">' +
        '<div class="hbar-label">' + escapeHtml(e.keyword) + "</div>" +
        '<div class="hbar-track"><div class="hbar-fill' + (e.isBurst ? " burst" : "") + '" style="width:' + (e.current / scale) * 100 + '%"></div>' +
        '<div class="hbar-threshold" style="left:' + (e.threshold / scale) * 100 + '%"></div></div>' +
        '<div class="hbar-count">' + e.current + "</div>" +
        '<div class="hbar-state">' + (e.isBurst ? '<span class="pill pill-burst">SURGE</span>' : "") + "</div></div>";
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
      list.innerHTML = '<div class="chart-empty small">No surge alerts. An alert fires when a keyword gets ' + data.settings.burst.minCount + ' or more ' +
        severityText(data.settings.burst.severities) + '-severity reports within ' + data.settings.burst.windowMin + ' min. Try "Simulate incident surge".</div>';
      return;
    }

    function item(a) {
      var ev = live[a.keyword];
      var trend = a.status === "resolved" ? "" : (ev && ev.isBurst
        ? '<span class="pill pill-burst">still surging</span>'
        : '<span class="pill">subsided</span>');
      var actions = a.status === "resolved" ? "" :
        (a.status === "active" ? '<button class="btn btn-small" data-action="ack" data-id="' + a.id + '">Acknowledge</button>' : "") +
        '<button class="btn btn-small" data-action="resolve" data-id="' + a.id + '">Resolve</button>';
      return '<div class="alert-item level-' + a.level + " status-" + a.status + '">' +
        '<div class="alert-top"><span class="pill pill-' + a.level + '">' + a.level.toUpperCase() + "</span>" +
        '<span class="alert-kw">' + escapeHtml(a.keyword) + "</span>" +
        '<span class="pill pill-status">' + a.status + "</span>" + trend +
        '<span class="alert-time">' + fmtTime(a.triggeredon) + " &middot; " + timeAgo(a.triggeredon) + "</span></div>" +
        '<div class="alert-body">' + a.count + " reports in " + data.settings.burst.windowMin + " min &middot; threshold " + fmtNum(a.threshold) +
        (a.escalations ? " &middot; escalated " + a.escalations + "&times;" : "") +
        "<br>Locations: " + escapeHtml(a.locations.join(", ")) +
        '<br><b>Suggested action:</b> ' + escapeHtml(suggestedAction(a)) +
        (detectionLatency(state.data, a) ? "<br>Detected " + fmtSeconds(detectionLatency(state.data, a).ms) + " after the first report (manual review: up to " + MANUAL_REVIEW_MIN + " min)" : "") +
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
      return "<tr><td>" + escapeHtml(u.name) + "</td><td>" + teamName(u.team) + '</td><td class="skills">' +
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
        severity = '<span class="' + sevClass(record.severity_level) + '">' + record.severity_level.toUpperCase() + "</span>";
        assigned = record.assigned_to ? escapeHtml(staffName(data, record.assigned_to)) : '<span class="muted">No eligible staff</span>';
      } else {
        status = record.status === "queued"
          ? '<span class="pill">Queued</span>'
          : '<span class="pill pill-busy">' + escapeHtml(STAGES[record.stage].label) + "</span>";
        severity = record.severity_level
          ? '<span class="' + sevClass(record.severity_level) + '">' + record.severity_level.toUpperCase() + "</span>"
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

    document.getElementById("settingsExample").innerHTML =
      "<b>With your current settings:</b> only reports the AI rated <b>" + severityText(s.severities) + "</b> are counted. " +
      "A keyword surges when it gets <b>" + s.minCount + " or more</b> of those reports within the last <b>" + s.windowMin + " min</b>.";

    if (!evals.length) {
      setOptions(select, [["", "Auto"]], "");
      container.innerHTML = '<div class="chart-empty">No ' + severityText(s.severities) + '-severity incident keywords in the last ' +
        (s.windowMin * (HISTORY_WINDOWS + 1)) + ' min yet. Generate events or simulate a surge.</div>';
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
      ? '<span class="pill pill-burst">SURGE</span> ' + ev.current + " &ge; " + fmtNum(ev.threshold) + " &rarr; alert raised or escalated"
      : '<span class="pill">below threshold</span> ' + ev.current + " &lt; " + fmtNum(ev.threshold) + " &rarr; no alert";

    container.innerHTML =
      '<div class="explain-grid"><div>' + burstChartSvg(ev, s) +
      '<div class="legend"><span class="lg lg-base"></span>earlier windows (context only) <span class="lg lg-cur"></span>current window ' +
      '<span class="lg lg-thresh"></span>alert threshold</div></div>' +
      '<ol class="steps">' +
      "<li><b>Filter</b>: keep only reports the AI rated <b>" + severityText(s.severities) + "</b> severity.</li>" +
      "<li><b>Count</b> those reports mentioning <code>" + escapeHtml(ev.keyword) + "</code> in the last " + s.windowMin +
      " min: <b>" + ev.current + "</b></li>" +
      "<li><b>Threshold</b>: <b>" + fmtNum(ev.threshold) + "</b> reports, set in the Event Surge Tracker.</li>" +
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
      "<thead><tr><th>Keyword</th><th>Now</th><th>Earlier windows</th><th>Threshold</th><th>State</th></tr></thead><tbody>" +
      evals.map(function (e) {
        return '<tr data-keyword="' + escapeHtml(e.keyword) + '"' + (e.keyword === ev.keyword ? ' class="selected"' : "") + "><td>" +
          escapeHtml(e.keyword) + "</td><td>" + e.current + "</td><td>" + e.history.join(" &middot; ") +
          "</td><td>" + fmtNum(e.threshold) +
          "</td><td>" + (e.isBurst ? '<span class="pill pill-burst">SURGE</span>' : '<span class="muted">below threshold</span>') + "</td></tr>";
      }).join("") + "</tbody>";
  }

  function burstChartSvg(ev, s) {
    var values = ev.history.concat([ev.current]);
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

    var K = HISTORY_WINDOWS;
    var now = Date.now();
    // Label each window by its start time; skip labels when bars get narrow
    // so they never overlap. The current window is always labelled.
    var every = Math.max(1, Math.ceil(46 / slot));
    function clock(ms) {
      var d = new Date(ms);
      return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
    }
    values.forEach(function (v, i) {
      var x = padL + slot * i + (slot - barW) / 2;
      var isCur = i === n - 1;
      var cls = isCur ? (ev.isBurst ? "b-burst" : "b-current") : "b-base";
      out.push('<rect class="' + cls + '" x="' + x + '" y="' + y(v) + '" width="' + barW + '" height="' + Math.max(0, y(0) - y(v)) + '" rx="3"/>');
      out.push('<text class="val" x="' + (x + barW / 2) + '" y="' + (y(v) - 5) + '" text-anchor="middle">' + v + "</text>");
      var showLabel = isCur || ((n - 1 - i) % every === 0 && (n - 1 - i) >= every);
      if (showLabel) {
        var label = isCur ? "now" : clock(now - (K + 1 - i) * s.windowMin * 60000);
        out.push('<text class="axis' + (isCur ? " axis-now" : "") + '" x="' + (x + barW / 2) + '" y="' + (padT + plotH + 16) + '" text-anchor="middle">' + label + "</text>");
      }
    });
    out.push('<text class="axis" x="' + (padL + plotW / 2) + '" y="' + (H - 4) + '" text-anchor="middle">start of each ' + s.windowMin + '-min window</text>');

    var yThr = y(ev.threshold);
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
        escapeHtml(r.name) + "</td><td" + (r.team === t.route.team ? "" : ' class="miss"') + ">" + teamName(r.team) + "</td><td" +
        (skillMatch ? "" : ' class="miss"') + ">" + (skillMatch ? "yes" : "no") + "</td><td" + (r.onLeave ? ' class="miss"' : "") + ">" +
        (r.onLeave ? "yes" : "no") + "</td><td>" + r.hourCount + "</td><td>" + r.dayCount + "</td><td>" +
        (r.lastAssigned ? new Date(r.lastAssigned).toLocaleTimeString() : "-") + "</td><td>" + outcome + "</td></tr>";
    }).join("");

    container.innerHTML =
      '<div class="case-summary"><b>' + escapeHtml(record.title) + "</b> &middot; " +
      '<span class="' + sevClass(record.severity_level) + '">' + record.severity_level.toUpperCase() + "</span> &middot; " +
      escapeHtml(record.main_category) + " &middot; via " + escapeHtml(record.source_at) + "</div>" +
      '<div class="route">Routing rule: <b>' + escapeHtml(t.route.rule) + '</b> &rarr; team <span class="skill">' + teamName(t.route.team) +
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
    document.getElementById("detailBody").classList.remove("hidden");
    document.getElementById("reportBody").classList.add("hidden");
    document.getElementById("detailDialog").classList.remove("report-dialog");
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
    var matched = record.keyevent_monitor_matched ? record.keyevent_monitor_matched.split(", ") : [];
    var terms = matched.concat(record.keywords || []);
    rows.push(["Description", processed ? highlightTerms(record.description, terms) : escapeHtml(record.description), true]);
    rows.push(["Source", record.source_at], ["Location", record.incident_at]);
    rows.push(["Severity", record.severity_level ? record.severity_level.toUpperCase() : "Pending"]);
    if (processed) {
      rows.push(["AI severity reason", matched.length
        ? "Rated " + record.severity_level.toUpperCase() + ": matched " + matched.join(", ")
        : "Rated LOW: no high or medium severity terms found"]);
    }
    rows.push(["Keywords", record.keywords ? (record.keywords.join(", ") || "-") : "Pending"]);
    rows.push(["Sentiment (TranSent-X)", record.sentiment ? record.sentiment + " - " + SENTIMENT_NAMES[record.sentiment] : "Pending"]);
    rows.push(["Category", record.main_category || "Pending"]);
    if (processed && record.assign_trace) rows.push(["AI routing reason", record.assign_trace.route.rule]);
    if (processed) {
      rows.push(["Routed to", record.assign_trace ? teamName(record.assign_trace.route.team) + " / " + record.assign_trace.route.skill : "-"]);
      rows.push(["Assigned to", record.assigned_to ? staffName(data, record.assigned_to) : "No eligible staff"]);
    } else {
      rows.push(["Assigned to", "Pending"]);
    }
    rows.push(["Queue GUID", record.queue_guid]);
    openDialog(record.title, rows, record.assign_trace ? {
      label: "Why this staff member?",
      run: function () { state.explainCase = record.queue_guid; switchTab("assignment"); renderAssignExplainer(); scrollToId("assignCard"); }
    } : null);
  }

  function showAlertDetail(alert) {
    var data = state.data;
    var lat = detectionLatency(data, alert);
    var linked = alert.records.map(function (g) { return findRecord(data, g); }).filter(Boolean)
      .sort(function (x, y) { return new Date(x.createdon) - new Date(y.createdon); });

    var html =
      '<div class="rp-head">' +
        '<span class="pill pill-' + alert.level + '">' + alert.level.toUpperCase() + "</span>" +
        '<span class="pill pill-status">' + escapeHtml(alert.status) + "</span>" +
        '<span class="rp-when">Triggered ' + escapeHtml(fmtTime(alert.triggeredon)) + " &middot; " + escapeHtml(timeAgo(alert.triggeredon)) + "</span>" +
      "</div>" +
      '<div class="rp-action"><b>Suggested action</b>' + escapeHtml(suggestedAction(alert)) + "</div>" +
      '<div class="rp-stats">' +
        '<div><b>' + alert.count + '</b><span>reports in ' + data.settings.burst.windowMin + ' min</span><em>threshold ' + escapeHtml(fmtNum(alert.threshold)) + "</em></div>" +
        '<div><b>' + (lat ? escapeHtml(fmtSeconds(lat.ms)) : "-") + '</b><span>to detect</span><em>manual review: up to ' + MANUAL_REVIEW_MIN + " min</em></div>" +
        '<div><b>' + alert.channels.length + '</b><span>channels notified</span><em>' + escapeHtml(alert.channels.join(", ")) + "</em></div>" +
      "</div>" +
      '<h4 class="rp-h">Locations</h4><div class="rp-chips">' +
        alert.locations.map(function (l) { return '<span class="channel">' + escapeHtml(l) + "</span>"; }).join("") + "</div>" +
      '<h4 class="rp-h">Timeline</h4><ol class="rp-timeline">' +
        alert.history.map(function (h) {
          return "<li><time>" + escapeHtml(fmtTime(h.at)) + "</time><span>" + escapeHtml(h.text) + "</span></li>";
        }).join("") + "</ol>" +
      '<h4 class="rp-h">Linked reports (' + linked.length + ')</h4><ul class="rp-reports">' +
        (linked.map(function (r) {
          return "<li><time>" + escapeHtml(fmtTime(r.createdon)) + "</time><div><b>" + escapeHtml(r.title) + "</b>" +
            '<span>' + escapeHtml(r.source_at) + " &middot; " + escapeHtml(r.incident_at) + "</span></div></li>";
        }).join("") || "<li>No linked reports</li>") + "</ul>";

    document.getElementById("detailTitle").textContent = "Surge alert: " + alert.keyword;
    document.getElementById("detailBody").classList.add("hidden");
    var body = document.getElementById("reportBody");
    body.innerHTML = html;
    body.classList.remove("hidden");
    var dlg = document.getElementById("detailDialog");
    dlg.classList.add("report-dialog");
    var btn = document.getElementById("detailExplainBtn");
    btn.classList.remove("hidden");
    btn.textContent = "How was this detected?";
    btn.onclick = function () { dlg.close(); explainKeyword(alert.keyword); };
    dlg.showModal();
  }

  function explainKeyword(keyword) {
    state.explainKeyword = keyword;
    switchTab("situational");
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
    document.getElementById("sentimentView").classList.toggle("hidden", tab !== "sentiment");
    // The live-feed bar only drives the portal views.
    document.getElementById("liveBarOk").classList.toggle("hidden", tab === "sentiment");
    if (tab === "sentiment") {
      var frame = document.getElementById("sentimentFrame");
      if (!frame.getAttribute("src")) frame.setAttribute("src", "dashboard/index.html");
      sizeSentimentFrame();
    }
  }

  // The dashboard is a separate static page shown in an iframe so its own
  // styles and scaling stay isolated; it fills the space below the header.
  function sizeSentimentFrame() {
    var header = document.querySelector(".topbar");
    var h = window.innerHeight - (header ? header.getBoundingClientRect().bottom : 0);
    document.getElementById("sentimentFrame").style.height = Math.max(400, h) + "px";
  }
  window.addEventListener("resize", function () {
    if (state.activeTab === "sentiment") sizeSentimentFrame();
  });

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

  function simulateBurst(chosen) {
    var sevs = state.data.settings.burst.severities;
    var pool = BURST_SCENARIOS.filter(function (sc) {
      return sevs.indexOf(detectSeverity((sc.reports[0][0] + " " + sc.reports[0][1]).toLowerCase()).severity_level) !== -1;
    });
    if (!pool.length) pool = BURST_SCENARIOS;
    var scenario = chosen && chosen.reports ? chosen : pool[Math.floor(Math.random() * pool.length)];
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
    s.minCount = Math.max(1, Number(document.getElementById("burstMinCount").value) || 3);
    var sevs = ["high", "medium", "low"].filter(function (v) { return document.getElementById("sev_" + v).checked; });
    if (!sevs.length) {
      sevs = ["high"];
      document.getElementById("sev_high").checked = true;
    }
    s.severities = sevs;
  }

  function writeSettingsToInputs() {
    var s = state.data.settings;
    document.getElementById("burstWindow").value = s.burst.windowMin;
    document.getElementById("burstMinCount").value = s.burst.minCount;
    ["high", "medium", "low"].forEach(function (v) {
      document.getElementById("sev_" + v).checked = s.burst.severities.indexOf(v) !== -1;
    });
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
      document.getElementById("alertsDialog").showModal();
    });
    // Close any popup when the click lands outside its box (on the backdrop).
    document.querySelectorAll("dialog").forEach(function (dlg) {
      dlg.addEventListener("click", function (e) {
        if (e.target !== dlg) return;
        var r = dlg.getBoundingClientRect();
        var inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
        if (!inside) dlg.close();
      });
    });

    document.getElementById("alertsCloseBtn").addEventListener("click", function () {
      document.getElementById("alertsDialog").close();
    });

    document.getElementById("generateNowBtn").addEventListener("click", generateNow);
    document.getElementById("burstBtn").addEventListener("click", function () { simulateBurst(); });

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
      document.getElementById(id).addEventListener("input", renderTrend);
    });

    // Surge settings update the charts on every keystroke / spinner click.
    // Alerting runs shortly after the user stops typing, so a half-typed
    // value (e.g. "1" on the way to "15") doesn't raise alerts.
    var alertingTimer = null;
    ["burstWindow", "burstMinCount", "sev_high", "sev_medium", "sev_low"].forEach(function (id) {
      var el = document.getElementById(id);
      el.addEventListener(el.type === "checkbox" ? "change" : "input", function () {
        readBurstSettings();
        saveData(state.data);
        renderAll();
        clearTimeout(alertingTimer);
        alertingTimer = setTimeout(function () {
          var fired = runAlerting(state.data, Date.now());
          if (fired.length) saveData(state.data);
          renderAll();
          announceAlerts(fired);
        }, 700);
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
        document.getElementById("alertsDialog").close();
        showAlertDetail(alert);
        return;
      } else if (action === "explain") {
        document.getElementById("alertsDialog").close();
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
      showToast("Demo data restored");
    });

    if (isAuthed()) showApp(); else showLogin();
  });
})();
