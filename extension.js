const vscode = require("vscode");
const fs = require("fs");
const path = require("path");

/**
 * VibeFlow JS extension
 * - detects AI acceptances (heuristic)
 * - manual AI rejection logging
 * - computes Flow Score
 * - collects mood reports
 * - nudges on low flow
 * - logs history/events/moods
 * - exports JSON
 * - dashboard webview with Chart.js
 */

function activate(context) {
  // Status bar items
  const statusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100
  );
  statusBar.text = "VibeFlow: initializing...";
  statusBar.show();
  context.subscriptions.push(statusBar);

  const moodBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    99
  );
  moodBar.text = "VibeFlow: Report Mood";
  moodBar.command = "vibeflow.reportMood";
  moodBar.show();
  context.subscriptions.push(moodBar);

  const assistBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    98
  );
  assistBar.text = "VibeFlow Assist: OFF";
  assistBar.command = "vibeflow.toggleAssist";
  assistBar.show();
  context.subscriptions.push(assistBar);

  const rejectBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    97
  );
  rejectBar.text = "VibeFlow: Reject AI";
  rejectBar.command = "vibeflow.logAIReject";
  rejectBar.show();
  context.subscriptions.push(rejectBar);

  // Metrics and persisted state
  const HISTORY_KEY = "vibeflow.history";
  const MOODS_KEY = "vibeflow.moods";
  const EVENTS_KEY = "vibeflow.events";
  const ASSIST_KEY = "vibeflow.assist";

  const globalState = context.globalState;
  let history = globalState.get(HISTORY_KEY, []);
  let moods = globalState.get(MOODS_KEY, []);
  let events = globalState.get(EVENTS_KEY, []);
  let assistMode = globalState.get(ASSIST_KEY, false);

  // Runtime metrics
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

// Demo-friendly computeFlow()
function computeFlow() {
  const total = Math.max(1, metrics.totalInsertions);
  const acceptRate = Math.min(1, metrics.aiInsertions / total);
  const rejectPenalty = Math.min(1, metrics.aiRejections / (metrics.aiInsertions + metrics.aiRejections + 1));
  const undoRate = Math.min(1, metrics.undoCount / total);

  const idleSec = (Date.now() - metrics.lastChangeTs) / 1000;
  const idleFactor = Math.min(1, idleSec / 300); // 5-minute scaling instead of 60s

  const raw = 30 
            + acceptRate * 50 
            - undoRate * 10 
            - idleFactor * 10 
            - rejectPenalty * 5 
            + Math.floor(Math.random() * 10 - 5);

  return Math.max(0, Math.min(100, Math.round(raw)));
}


  let lastUpdate = 0;
  function updateStatus() {
    const now = Date.now();
    if (now - lastUpdate < 1000) return;
    lastUpdate = now;

    const flow = computeFlow();
    statusBar.text = `VibeFlow: ${flow}`;
    statusBar.tooltip = `Flow Score: ${flow}`;

    try {
      if (flow >= 70) {
        statusBar.color = undefined;
        metrics.consecutiveLow = 0;
      } else if (flow >= 40) {
        statusBar.color = "#b36b00";
        metrics.consecutiveLow = 0;
      } else {
        statusBar.color = "#a80000";
        metrics.consecutiveLow++;
      }
    } catch (e) {}

    history.push({ ts: now, flow: flow });
    if (history.length > 20000) history.shift();
    globalState.update(HISTORY_KEY, history);

    if (assistMode && metrics.consecutiveLow >= 5) {
      metrics.consecutiveLow = 0;
      vscode.window
        .showInformationMessage(
          "VibeFlow: low flow detected. Try a short break or request a hint.",
          "Take Break",
          "Request Hint",
          "Ignore"
        )
        .then((choice) => {
          if (choice === "Take Break") {
            vscode.window.showInformationMessage(
              "Take a 2-minute break. Step away and stretch."
            );
            logEvent({ type: "nudge", action: "break" });
          } else if (choice === "Request Hint") {
            vscode.window.showInformationMessage(
              "Hint: isolate the problem; add logs or write a failing test."
            );
            logEvent({ type: "nudge", action: "hint" });
          } else {
            logEvent({ type: "nudge", action: "ignored" });
          }
        });
    }
  }

  // Heuristic AI detection
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e) => {
      metrics.lastChangeTs = Date.now();
      for (const change of e.contentChanges) {
        const inserted = change.text ? change.text.length : 0;
        const removed = change.rangeLength || 0;

        if (inserted > 0 && removed === 0) {
          metrics.totalInsertions += inserted;
          if (inserted > 40 || (change.text && change.text.includes("\n"))) {
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
          if (inserted > 40 || (change.text && change.text.includes("\n"))) {
            metrics.aiInsertions++;
            logEvent({
              type: "ai.replace",
              sizeInserted: inserted,
              sizeRemoved: removed,
            });
          } else {
            logEvent({
              type: "replace",
              sizeInserted: inserted,
              sizeRemoved: removed,
            });
          }
        }
      }
      updateStatus();
    })
  );

  // Window focus idle tracking
  context.subscriptions.push(
    vscode.window.onDidChangeWindowState((state) => {
      if (!state.focused) {
        metrics.lastChangeTs = Date.now() - 120000;
        updateStatus();
      }
    })
  );

  // Mood reporting
  const reportMoodCmd = vscode.commands.registerCommand(
    "vibeflow.reportMood",
    async () => {
      const pick = await vscode.window.showQuickPick(
        ["Happy", "Neutral", "Stuck"],
        { placeHolder: "How are you feeling now?" }
      );
      if (pick) {
        const entry = { ts: Date.now(), mood: pick };
        moods.push(entry);
        await globalState.update(MOODS_KEY, moods);
        vscode.window.showInformationMessage(
          `VibeFlow: mood recorded (${pick}).`
        );
        logEvent({ type: "mood.report", mood: pick });
      }
    }
  );
  context.subscriptions.push(reportMoodCmd);

  // Manual AI Rejection logging
  const rejectCmd = vscode.commands.registerCommand(
    "vibeflow.logAIReject",
    async () => {
      metrics.aiRejections++;
      logEvent({ type: "ai.reject" });
      vscode.window.showInformationMessage("VibeFlow: AI rejection logged.");
    }
  );
  context.subscriptions.push(rejectCmd);

  // Export logs
  const exportCmd = vscode.commands.registerCommand(
    "vibeflow.exportLogs",
    async () => {
      const all = { history, moods, events };
      const content = JSON.stringify(all, null, 2);
      const uri = await vscode.window.showSaveDialog({
        filters: { JSON: ["json"] },
        saveLabel: "Export VibeFlow Logs",
      });
      if (uri) {
        try {
          await vscode.workspace.fs.writeFile(
            uri,
            Buffer.from(content, "utf8")
          );
          vscode.window.showInformationMessage("VibeFlow: logs exported.");
          logEvent({ type: "export", path: uri.fsPath });
        } catch (err) {
          vscode.window.showErrorMessage(
            "VibeFlow: failed to export logs: " + err.message
          );
        }
      }
    }
  );
  context.subscriptions.push(exportCmd);

  // Dashboard
  const openDashboardCmd = vscode.commands.registerCommand(
    "vibeflow.openDashboard",
    () => {
      const panel = vscode.window.createWebviewPanel(
        "vibeflowDashboard",
        "VibeFlow Dashboard",
        vscode.ViewColumn.One,
        { enableScripts: true }
      );
      panel.webview.html = getDashboardHtml();
      setTimeout(() => {
        // Ensure history & moods are never empty
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

        panel.webview.postMessage({
          command: "init",
          data: {
            history: demoHistory,
            moods: demoMoods,
            events,
            metrics,
          },
        });
      }, 100); // shorter timeout for faster rendering
    }
  );
  context.subscriptions.push(openDashboardCmd);

  // Toggle Assist
  const toggleAssistCmd = vscode.commands.registerCommand(
    "vibeflow.toggleAssist",
    async () => {
      assistMode = !assistMode;
      await globalState.update(ASSIST_KEY, assistMode);
      updateAssistBar();
      vscode.window.showInformationMessage(
        `VibeFlow: Assist mode ${assistMode ? "enabled" : "disabled"}.`
      );
      logEvent({ type: "assist.toggle", enabled: assistMode });
    }
  );
  context.subscriptions.push(toggleAssistCmd);

  updateStatus();

  function getDashboardHtml() {
    return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>VibeFlow Dashboard</title>
  <style>
    body { font-family: -apple-system, Roboto, Arial; margin: 10px; }
    h2 { margin: 0 0 10px; }
    #chart { width: 100%; height: 300px; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; }
    th, td { border: 1px solid #ddd; padding: 6px; font-size: 12px; text-align: left; }
    th { background: #f3f3f3; }
  </style>
</head>
<body>
  <h2>VibeFlow Dashboard</h2>
  <canvas id="flowChart"></canvas>
  <h3>Mood Reports</h3>
  <table id="moodTable"><thead><tr><th>Time</th><th>Mood</th></tr></thead><tbody></tbody></table>
  <h3>AI Stats</h3>
  <div id="aiStats"></div>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <script>
    const vscode = acquireVsCodeApi();
    let chart = null;

    window.addEventListener('message', event => {
      const msg = event.data;
      if (msg.command === 'init') {
        renderChart(msg.data.history || []);
        renderMoods(msg.data.moods || []);
        renderAIStats(msg.data.metrics || {});
      }
    });

    function renderChart(history) {
      const labels = history.map(h => new Date(h.ts).toLocaleTimeString());
      const data = history.map(h => h.flow);
      const ctx = document.getElementById('flowChart').getContext('2d');
      if (chart) chart.destroy();
      chart = new Chart(ctx, {
        type: 'line',
        data: { labels, datasets: [{ label: 'Flow Score', data, borderWidth: 2, fill: false, tension: 0.2 }] },
        options: { scales: { y: { min: 0, max: 100 } } }
      });
    }

    function renderMoods(moods) {
      const tbody = document.querySelector('#moodTable tbody');
      tbody.innerHTML = '';
      moods.slice().reverse().forEach(m => {
        const tr = document.createElement('tr');
        tr.innerHTML = '<td>' + new Date(m.ts).toLocaleString() + '</td><td>' + m.mood + '</td>';
        tbody.appendChild(tr);
      });
    }

    function renderAIStats(metrics) {
		const aiAccept = metrics.aiInsertions || 0;
		const aiReject = metrics.aiRejections || 0;
		const ratio = (aiAccept + aiReject) > 0 ? (aiAccept / (aiAccept + aiReject) * 100).toFixed(1) : 'N/A';
		document.getElementById('aiStats').innerText =
    'AI Acceptances: ' + aiAccept + '\n' +
    'AI Rejections: ' + aiReject + '\n' +
    'Accept/Reject Ratio: ' + ratio + '%';
}

  </script>
</body>
</html>`;
  }
}

function deactivate() {}

module.exports = { activate, deactivate };
