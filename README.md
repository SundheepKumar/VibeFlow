#VibeFlow 

VibeFlow is a VS Code extension prototype designed to enhance understanding of developer flow and AI-assisted coding behavior. It helps track productivity, mood, and AI interactions in your coding sessions.

##Key Features

Flow Score (0–100): Infers developer flow heuristically based on coding activity and AI acceptance.
AI Suggestion Tracking: Detects accepted and rejected AI-generated code changes.
Mood Self-Reports: Collect your current mood to validate flow and productivity.
Assist Mode: Provides contextual nudges when low flow persists (e.g., breaks or coding hints).
Session Logging: Logs events, AI interactions, and mood reports; export logs as JSON for analysis.
Dashboard Visualization: Webview dashboard with Chart.js to track Flow Score trends and mood history.

##Installation & Run Locally
1. Clone or download this repository.
2. Open the folder in VS Code.
3. Press F5 to launch the Extension Development Host.
4. Open the Command Palette (Ctrl+Shift+P / Cmd+Shift+P) and use the following commands:

##Features Overview
-VibeFlow: Report Mood – Record your current mood (Happy, Neutral, Stuck).
-VibeFlow: Toggle Assist Mode – Enable or disable automatic nudges during low flow.
-VibeFlow: Open Dashboard – Open the webview dashboard to visualize Flow Score and mood trends.
-VibeFlow: Export Logs – Save all session logs (events, moods, Flow Score) to a JSON file.

##Usage Notes
-Flow Score: Calculated heuristically based on coding activity, AI-acceptance, undo actions, and idle time.
-Assist Nudges: Triggered after consecutive low-flow events when Assist Mode is ON. Suggestions include short breaks or hints for resolving coding blocks.
-Dashboard: Shows the most recent 1000 events and mood reports with an interactive line chart for Flow Score.

##Development
-Built with JavaScript using the VS Code Extension API.
-Dashboard uses Chart.js via CDN.
-Logs and state are persisted using VS Code globalState.