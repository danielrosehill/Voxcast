# Voxcast

**Speak. Reshape. Send.**

A serious voice-to-text Android keyboard. Hold the button, talk, release — your speech is transcribed and reformatted into the active preset's output style, then auto-copied to the clipboard.

Derivative of [Crazy-Keyboard](https://github.com/danielrosehill/Crazy-Keyboard) — same plumbing (Expo / React Native, OpenRouter audio input, Gemini Flash Lite), serious-tool framing instead of novelty.

## Presets

Grouped in the picker:

- **Cleanup**
  - **Basic Cleanup** — light cleanup of punctuation, casing, filler words. Preserves the speaker's voice.
- **Work**
  - **Business Email** — professional English email (subject + body, both copyable).
  - **AI Prompt** — restructured general-purpose LLM prompt.
  - **Dev Prompt** — engineering-focused prompt for a coding agent.
- **Personal**
  - **To-Do List** — bulleted action items.
  - **Note to Self** — concise first-person note.
- **Hebrew**
  - **Casual Hebrew** — casual conversational Hebrew text (Hebrew script).
  - **Email (Hebrew)** — professional Hebrew email (subject + body, both copyable).

Exactly one preset is active at a time. No layering.

## Settings

- **Your name** — used as context. You are the *sender*; never addressed as the recipient or signed off with.
- **OpenRouter API key** — required. Stored via `expo-secure-store`.

## Architecture

- `App.js` — single-screen UI. Hold-to-talk button, mode picker modal, settings/history modals.
- `src/modes.js` — preset catalog, system-prompt builder, and email subject/body parser.
- `src/api.js` — single OpenRouter call with inline base64 audio. Model: `google/gemini-3.1-flash-lite-preview`. Temperature 0.3 (low — these are serious presets).
- `src/storage.js` — SecureStore (API key) + AsyncStorage (settings, history). History keeps the last 10 entries.

Email modes (`businessEmail`, `emailHebrew`) instruct the model to return:

```
SUBJECT: <one line>

BODY:
<multi-line body>
```

`parseEmailOutput()` splits this into `{ subject, body }` so the UI can render two copy buttons.

## Build & install (dev loop)

Same flow as Crazy-Keyboard:

```bash
cd android
ANDROID_HOME=$HOME/android/Sdk ./gradlew assembleRelease
adb install -r app/build/outputs/apk/release/app-release.apk
```

Package: `com.danielrosehill.voxcast` (so it installs alongside Crazy-Keyboard, not on top of it).

## Never do

- Do **not** reintroduce `expo-file-system` `File` API or `readAsStringAsync` — they fail on release builds. Audio→base64 goes through `fetch(uri) → blob → FileReader.readAsDataURL`.
- Do **not** `expo prebuild --clean` — wipes the `android/` native folder including signing config.
- Do **not** skip signing or use `--no-verify`.
