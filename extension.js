const vscode = require("vscode");

/**
 * VibeFlow – VS Code Flow/Mood Tracker
 * Now includes dashboard handshake debug logging
 */

function activate(context) {
  const activity = []; // track typing events
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBar.text = "VibeFlow: initializing...";
  statusBar.show();
  context.subscriptions.push(statusBar);

  const moodBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
  moodBar.text = "VibeFlow: Report Mood";
  moodBar.command = "vibeflow.reportMood";
  moodBar.show();
  context.subscriptions.push(moodBar);

  const assistBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 98);
  assistBar.text = "VibeFlow Assist: OFF";
  assistBar.command = "vibeflow.toggleAssist";
  assistBar.show();
  context.subscriptions.push(assistBar);

  const rejectBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 97);
  rejectBar.text = "VibeFlow: Reject AI";
  rejectBar.command = "vibeflow.logAIReject";
  rejectBar.show();
  context.subscriptions.push(rejectBar);

  const HISTORY_KEY = "vibeflow.history";
  const MOODS_KEY = "vibeflow.moods";
  const EVENTS_KEY = "vibeflow.events";
  const ASSIST_KEY = "vibeflow.assist";

  const globalState = context.globalState;
  let history = globalState.get(HISTORY_KEY, []);
  let moods = globalState.get(MOODS_KEY, []);
  let events = globalState.get(EVENTS_KEY, []);
  let assistMode = globalState.get(ASSIST_KEY, false);

  const metrics = {
    lastChangeTs: Date.now(),
    totalInsertions: 0,
    totalDeletions: 0,
    aiInsertions: 0,
    aiRejections: 0,
    undoCount: 0,
    consecutiveLow: 0,
  };

  function updateAssistBar() {
    assistBar.text = `VibeFlow Assist: ${assistMode ? "ON" : "OFF"}`;
  }
  updateAssistBar();

  function logEvent(obj) {
    obj.ts = Date.now();
    events.push(obj);
    globalState.update(EVENTS_KEY, events);
  }

  function computeFlow() {
    const now = Date.now();
    const windowSize = 60000; // last 60s
    const recent = activity.filter(a => now - a.ts < windowSize);

    let keystrokeScore = 0;
    recent.forEach(a => {
      const ageSec = (now - a.ts) / 1000;
      const weight = Math.max(0, 1 - ageSec / 60);
      keystrokeScore += weight * Math.min(a.size || 1, 20);
    });
    keystrokeScore = Math.min(keystrokeScore, 50);

    const gaps = recent.map((a, i) => (i === 0 ? 0 : a.ts - recent[i - 1].ts));
    const avgGap = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0;
    const rhythmBonus = avgGap < 10000 ? Math.max(0, 20 - avgGap / 1000) : 0;

    const lastActivity = recent.at(-1)?.ts || metrics.lastChangeTs || 0;
    const idleTime = now - lastActivity;
    const idleDecay = Math.min(50, idleTime / 1000); // 1pt/sec idle, max 50

    const total = Math.max(1, metrics.totalInsertions);
    const aiAcceptRate = Math.min(1, metrics.aiInsertions / total);
    const undoPenalty = Math.min(1, metrics.undoCount / total);

    const metricScore = 30 + aiAcceptRate * 30 - undoPenalty * 10;

    let rawFlow = keystrokeScore + rhythmBonus - idleDecay + metricScore;
    rawFlow += Math.floor(Math.random() * 6 - 3); // ±3

    return Math.max(0, Math.min(100, Math.round(rawFlow)));
  }

  let lastUpdate = 0;
  function updateStatus() {
    const now = Date.now();
    if (now - lastUpdate < 1000) return; // throttle updates
    lastUpdate = now;

    const flow = computeFlow();
    statusBar.text = `VibeFlow: ${flow}`;
    statusBar.tooltip = `Flow Score: ${flow}`;

    if (flow >= 70) {
      statusBar.color = undefined;
      metrics.consecutiveLow = 0;
    } else if (flow >= 45) {
      statusBar.color = "#b36b00";
      metrics.consecutiveLow = 0;
    } else {
      statusBar.color = "#a80000";
      metrics.consecutiveLow++;
    }

    // --- Assist mode nudges ---
    if (assistMode && metrics.consecutiveLow >= 5) {
      metrics.consecutiveLow = 0;
      vscode.window.showInformationMessage(
        "VibeFlow: low flow detected. Try a short break or request a hint.",
        "Take Break",
        "Request Hint",
        "Ignore"
      ).then(choice => {
        if (choice === "Take Break") {
          vscode.window.showInformationMessage("Take a 2-minute break. Step away and stretch.");
          logEvent({ type: "nudge", action: "break" });
        } else if (choice === "Request Hint") {
          vscode.window.showInformationMessage("Hint: isolate the problem; add logs or write a failing test.");
          logEvent({ type: "nudge", action: "hint" });
        } else {
          logEvent({ type: "nudge", action: "ignored" });
        }
      });
    }

    // --- Log history ---
    history.push({ ts: now, flow });
    if (history.length > 20000) history.shift();
    globalState.update(HISTORY_KEY, history);
  }

  // --- Typing listener ---
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(e => {
      const now = Date.now();
      metrics.lastChangeTs = now;

      for (const change of e.contentChanges) {
        const inserted = change.text?.length || 0;
        const removed = change.rangeLength || 0;

        if (inserted > 0) activity.push({ ts: now, size: inserted });

        const cutoff = now - 5 * 60 * 1000; // last 5 min
        while (activity.length && activity[0].ts < cutoff) activity.shift();

        if (inserted > 0 && removed === 0) {
          metrics.totalInsertions += inserted;
          if (inserted > 40 || change.text.includes("\n")) {
            metrics.aiInsertions++;
            logEvent({ type: "ai.accept", size: inserted });
          } else {
            logEvent({ type: "insert", size: inserted });
          }
        } else if (removed > 0 && inserted === 0) {
          metrics.totalDeletions += removed;
          metrics.undoCount++;
          logEvent({ type: "delete", size: removed });
        } else if (removed > 0 && inserted > 0) {
          metrics.totalInsertions += inserted;
          metrics.totalDeletions += removed;
          if (inserted > 40 || change.text.includes("\n")) {
            metrics.aiInsertions++;
            logEvent({ type: "ai.replace", sizeInserted: inserted, sizeRemoved: removed });
          } else {
            logEvent({ type: "replace", sizeInserted: inserted, sizeRemoved: removed });
          }
        }
      }

      updateStatus();
    })
  );

  // --- Window focus idle ---
  context.subscriptions.push(
    vscode.window.onDidChangeWindowState(state => {
      if (!state.focused) metrics.lastChangeTs = Date.now() - 120000;
      updateStatus();
    })
  );

  // --- Assist mode interval ---
  const flowInterval = setInterval(updateStatus, 1000); // check flow every second
  context.subscriptions.push({ dispose: () => clearInterval(flowInterval) });

  // Mood report
  context.subscriptions.push(
    vscode.commands.registerCommand("vibeflow.reportMood", async () => {
      const pick = await vscode.window.showQuickPick(["Happy", "Neutral", "Stuck"], {
        placeHolder: "How are you feeling now?",
      });
      if (pick) {
        const entry = { ts: Date.now(), mood: pick };
        moods.push(entry);
        await globalState.update(MOODS_KEY, moods);
        vscode.window.showInformationMessage(`VibeFlow: mood recorded (${pick}).`);
        logEvent({ type: "mood.report", mood: pick });
      }
    })
  );

  // Manual reject
  context.subscriptions.push(
    vscode.commands.registerCommand("vibeflow.logAIReject", async () => {
      metrics.aiRejections++;
      logEvent({ type: "ai.reject" });
      vscode.window.showInformationMessage("VibeFlow: AI rejection logged.");
    })
  );

  // Export logs
  context.subscriptions.push(
    vscode.commands.registerCommand("vibeflow.exportLogs", async () => {
      const all = { history, moods, events };
      const content = JSON.stringify(all, null, 2);
      const uri = await vscode.window.showSaveDialog({
        filters: { JSON: ["json"] },
        saveLabel: "Export VibeFlow Logs",
      });
      if (uri) {
        await vscode.workspace.fs.writeFile(uri, Buffer.from(content, "utf8"));
        vscode.window.showInformationMessage("VibeFlow: logs exported.");
        logEvent({ type: "export", path: uri.fsPath });
      }
    })
  );

  // Dashboard command
  context.subscriptions.push(
    vscode.commands.registerCommand("vibeflow.openDashboard", () => {
      const panel = vscode.window.createWebviewPanel(
        "vibeflowDashboard",
        "VibeFlow Dashboard",
        vscode.ViewColumn.One,
        { enableScripts: true }
      );

      panel.webview.html = getDashboardHtml();

      function sendInitData() {
        console.log("Preparing to send init data to webview...");
        const demoHistory = history.length
          ? history.slice(-1000)
          : [
              { ts: Date.now() - 60000, flow: 55 },
              { ts: Date.now() - 30000, flow: 60 },
              { ts: Date.now(), flow: computeFlow() },
            ];

        const demoMoods = moods.length
          ? moods
          : [{ ts: Date.now() - 45000, mood: "Neutral" }];

        const payload = { command: "init", data: { history: demoHistory, moods: demoMoods, events, metrics } };
        console.log("Sending payload:", payload);
        panel.webview.postMessage(payload);
      }

      panel.webview.onDidReceiveMessage((msg) => {
        console.log("VibeFlow: received message from webview:", msg);
        if (msg.command === "ready") {
          vscode.window.showInformationMessage("Webview ready — sending data!");
          sendInitData();
        }
      });

      // Fallback in case "ready" message fails
      setTimeout(() => {
        vscode.window.showInformationMessage("Fallback: sending data directly after 2s");
        sendInitData();
      }, 2000);
    })
  );

  // Assist toggle
  context.subscriptions.push(
    vscode.commands.registerCommand("vibeflow.toggleAssist", async () => {
      assistMode = !assistMode;
      await globalState.update(ASSIST_KEY, assistMode);
      updateAssistBar();
      vscode.window.showInformationMessage(`VibeFlow: Assist mode ${assistMode ? "enabled" : "disabled"}.`);
      logEvent({ type: "assist.toggle", enabled: assistMode });
    })
  );

  updateStatus();

  function getDashboardHtml() {
    return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>VibeFlow Dashboard</title>
  <style>
    body { font-family: -apple-system, Roboto, Arial; margin: 10px; }
    h2 { margin: 0 0 10px; }
    #chart { width: 100%; height: 300px; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; }
    th, td { border: 1px solid #ddd; padding: 6px; font-size: 12px; text-align: left; }
    th { background: #f3f3f3; }
    pre { white-space: pre-wrap; }
  </style>
</head>
<body>
  <h2>VibeFlow Dashboard</h2>
  <canvas id="flowChart"></canvas>
  <h3>Mood Reports</h3>
  <table id="moodTable"><thead><tr><th>Time</th><th>Mood</th></tr></thead><tbody></tbody></table>
  <h3>AI Stats</h3>
  <pre id="aiStats"></pre>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <script>
    const vscode = acquireVsCodeApi();
    console.log("VibeFlow webview script loaded!");

    window.addEventListener("load", () => {
      console.log("Webview loaded — posting ready message");
      vscode.postMessage({ command: "ready" });
    });

    window.addEventListener("message", event => {
      const msg = event.data;
      console.log("Received message from extension:", msg);
      if (msg.command === "init") {
        renderChart(msg.data.history || []);
        renderMoods(msg.data.moods || []);
        renderAIStats(msg.data.metrics || {});
      }
    });

    let chart = null;
    function renderChart(history) {
      const labels = history.map(h => new Date(h.ts).toLocaleTimeString());
      const data = history.map(h => h.flow);
      const ctx = document.getElementById("flowChart").getContext("2d");
      if (chart) chart.destroy();
      chart = new Chart(ctx, {
        type: "line",
        data: { labels, datasets: [{ label: "Flow Score", data, borderWidth: 2, fill: false, tension: 0.2 }] },
        options: { scales: { y: { min: 0, max: 100 } } }
      });
    }

    function renderMoods(moods) {
      const tbody = document.querySelector("#moodTable tbody");
      tbody.innerHTML = "";
      moods.slice().reverse().forEach(m => {
        const tr = document.createElement("tr");
        tr.innerHTML = "<td>" + new Date(m.ts).toLocaleString() + "</td><td>" + m.mood + "</td>";
        tbody.appendChild(tr);
      });
    }

    function renderAIStats(metrics) {
      const aiAccept = metrics.aiInsertions || 0;
      const aiReject = metrics.aiRejections || 0;
      const ratio = (aiAccept + aiReject) > 0 ? (aiAccept / (aiAccept + aiReject) * 100).toFixed(1) : "N/A";
      document.getElementById("aiStats").innerText =
        "AI Acceptances: " + aiAccept + "\\n" +
        "AI Rejections: " + aiReject + "\\n" +
        "Accept/Reject Ratio: " + ratio + "%";
    }
  </script>
</body>
</html>`;
  }
}

function deactivate() {}

module.exports = { activate, deactivate };
