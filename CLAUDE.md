# CLAUDE.md — Voxcast

Serious voice-to-text reformatter. Derived from Crazy-Keyboard but reframed as a productivity tool with single-purpose presets and no layering. Android-first, release APK installed over adb.

## Iteration loop

Identical to Crazy-Keyboard:

1. Phone connected via USB, `adb devices` shows it.
2. Edit JS — pure JS changes don't require `expo prebuild`.
3. Build release APK:
   ```bash
   cd android
   ANDROID_HOME=$HOME/android/Sdk ./gradlew assembleRelease
   ```
4. Install:
   ```bash
   adb install -r app/build/outputs/apk/release/app-release.apk
   ```

One-liner from repo root:
```bash
cd android && ANDROID_HOME=$HOME/android/Sdk ./gradlew assembleRelease && \
adb install -r /home/daniel/repos/github/my-repos/Voxcast/android/app/build/outputs/apk/release/app-release.apk
```

## Architecture

- `App.js` — single screen, hold-to-talk PTT, mode picker / settings / history modals.
- `src/modes.js` — `MODES` catalog (8 presets), `GROUPS` for picker layout, `buildSystemPrompt(mode, { userName, recipient })`, and `parseEmailOutput(text)` for email-mode dual output.
- `src/api.js` — OpenRouter call, model `google/gemini-3.1-flash-lite-preview`, temperature 0.3.
- `src/storage.js` — SecureStore for API key, AsyncStorage for settings + history (last 10).

## Email modes (dual output)

`businessEmail` and `emailHebrew` instruct the model to return:
```
SUBJECT: <one line>

BODY:
<body>
```
The UI parses this and shows two separate copy buttons. Body is auto-copied on release; subject requires its own tap. The Hebrew mode keeps the `SUBJECT:` / `BODY:` labels in English (caps) so the parser is language-independent.

## Differences from Crazy-Keyboard

- Single active mode (no `activeModes` array, no layering, no per-mode dials).
- No emoji-flavored chip rail — modes live behind a "PRESET" card that opens a grouped picker modal.
- Different package ID (`com.danielrosehill.voxcast`) so both apps coexist on-device.
- New storage keys (`voxcast_settings_v1`, `voxcast_history_v1`) — no migration from Crazy-Keyboard data.
- Lower temperature (0.3 vs 0.9) since these presets value fidelity, not creativity.

## Never do

- Don't reintroduce `expo-file-system` `File` API or `readAsStringAsync` (broken on release).
- Don't `expo prebuild --clean` — wipes `android/` including signing config.
- Don't skip signing or use `--no-verify`.
- Don't add multi-mode layering. The whole point is one preset at a time.
