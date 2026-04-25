# PTT (push-to-talk) mode — deferred

The original Voxcast main screen had a multi-clip recording flow with Pause / Add / Undo / Retake / Delete controls. This was removed in v0.2.0 in favour of a single-row Record + Transcribe layout — much cleaner for the 90% case (one take, transcribe, done).

The multi-clip / PTT controls are still useful for some workflows:
- Recording a long dictation with mid-flight pauses to think
- Stitching multiple takes before sending one transcription job
- Re-doing the last clip without losing earlier ones

## Plan

Surface PTT as a **separate mode / screen**, not the default. Options:

1. **Settings toggle** — "Advanced recording" — replaces the main row with the v0.1 multi-clip control deck.
2. **Long-press the record button** — quick gesture to enter PTT mode for that session.
3. **Dedicated tab/route** — a second screen reachable from the header (icon next to Settings).

Leaning towards option 1 or 3. Option 2 is undiscoverable.

## State machine to preserve

The `recState` machine (`idle | recording | paused`) and the `clips[]` array were already wired up — we just removed the UI surfaces. Keep the underlying state in `App.js` so PTT mode can be re-enabled cheaply. The functions still present and ready: `togglePause`, `addClip`, `redoLast`, `retakeAll`, `deleteAll`.

## Components to revive

- The 5-control icon row (`ControlIcon` component + `controlsRow` style — both still in code).
- "STANDBY · n CLIPS" status — already rendered conditionally in the status pill.
