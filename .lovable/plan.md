## Voice upload + speech-to-text + auto-canvas-split + word→animation mapping

### Goal
On the Voice step, user uploads an audio file. We transcribe it (with word-level timestamps), auto-split it into N canvases by sentence/duration, save narration per scene, store per-scene audio segment, and let users add animations bound to words. Playback uses the real uploaded voice (instead of browser TTS) and reveals each animation exactly when its bound word is spoken.

### Provider
Use **ElevenLabs Scribe v2 batch STT** (already documented). It returns `{ text, words: [{ text, start, end }] }`. Requires `ELEVENLABS_API_KEY` secret — we'll request it after approval.

### UX flow
1. **Voice page** (`projects.$projectId.voice.tsx`) — full implementation:
   - Drag-drop / file picker for audio (mp3/wav/m4a, ≤25MB).
   - Upload to `voice-uploads` storage bucket (new, private; signed URLs for playback).
   - Show waveform + Play/Pause once uploaded.
   - "Transcribe & build canvases" button → calls server fn → shows progress.
   - After transcription: preview the script with sentence chunks; user picks **target canvas count** (default = auto, based on sentence count or ~8s per canvas) and clicks "Apply".
   - Apply replaces existing scenes for the project (with confirm dialog) and pushes the user to the Script step.
2. **Script page** — already supports per-scene narration, animation binding by word + occurrence. After apply, each scene is pre-populated with its narration text and a `voice_segment` (audio URL + start/end ms within the master file).
3. **Playback** — `PlaybackDialog` switches: if a scene has `voice_segment`, play the sliced audio (HTMLAudioElement with `currentTime = start`, stop at `end`) and drive word reveals from the **stored word timestamps** instead of `speechSynthesis.onboundary`. Falls back to TTS when no voice.

### Auto-split algorithm
Server-side, after STT:
1. Split `text` into sentences (regex on `.?!` with abbreviation guard).
2. Map each sentence back to its first/last word in the timestamp list to get `start_ms`, `end_ms`, and the word array.
3. Greedy-pack sentences into canvases targeting **6–10 s** each (configurable). Never split a sentence.
4. Result: array of `{ narration, start_ms, end_ms, words: [{text,start,end}] }`.

### Database changes (migration)
- New table `voice_tracks` already exists — extend with `is_master boolean default false` so we can mark the full upload (vs per-scene segments).
- New columns on `scenes`:
  - `voice_url text` — URL of master audio (same per scene from one upload).
  - `voice_start_ms int`, `voice_end_ms int` — slice within master.
  - `word_timings jsonb` — `[{text,start_ms,end_ms}]` for the scene's words. Used by playback to reveal bound animations on time.
- New storage bucket `voice-uploads` (private) with RLS allowing the workspace to read/write.

### Word → animation mapping
Already implemented on the canvas side: clicking a word in the script populates the search and elements get `content.word` + `content.occurrence`. With this plan, animation reveal uses `word_timings` for precise timing instead of TTS boundary events. Occurrence counter is computed per scene from `word_timings`.

### Files to add / change

**New**
- `supabase/migrations/<ts>_voice_uploads.sql` — bucket + RLS + new scene columns.
- `src/server/voice.functions.ts`
  - `uploadVoiceUrl()` — returns signed upload URL (or just lets client use supabase-js storage).
  - `transcribeAndSplit({ projectId, voiceUrl, targetCanvasCount? })` — calls ElevenLabs, splits, deletes old scenes/elements for the project, inserts new scenes with narration + voice slice + word_timings, returns the new scene list.
- `src/lib/sentence-split.ts` — pure helper for sentence segmentation + greedy packing (unit-testable).
- `src/components/Waveform.tsx` — light waveform via `<audio>` + canvas (no extra deps; or use `wavesurfer.js` if approved).

**Edited**
- `src/routes/projects.$projectId.voice.tsx` — full UI replacing placeholder.
- `src/routes/projects.$projectId.script.tsx` — when scene has `voice_url`, hide the manual narration textarea's "Done" save behaviour (still editable but won't change timings); show a small "Voice synced" badge.
- `src/components/PlaybackDialog.tsx` — voice-driven playback path:
  - If `scene.voice_url` exists: create one shared `<audio>` element, `currentTime = voice_start_ms/1000`, schedule reveals via `setTimeout` from `word_timings` (relative to scene start), advance to next scene at `voice_end_ms`.
  - Else: keep current TTS path.
- `src/lib/db-types.ts` — add the new scene fields to `Scene`.

### Secrets
Need `ELEVENLABS_API_KEY`. After plan approval, I'll request it via `add_secret` (with link to elevenlabs.io/app/settings/api-keys) and won't proceed with the server fn until it's set.

### Tech notes (technical section)
- Server fn uses `requireSupabaseAuth` + admin client only for the bulk delete/insert of scenes (workspace-scoped).
- Audio is uploaded directly from the browser to Storage (no payload through the worker — ElevenLabs is called server-side with a fetched stream from the signed URL).
- ElevenLabs response is large; we only persist `{text,start_ms,end_ms}` per word per scene, not the full payload.
- For the master-audio approach we don't physically slice the file — we just store offsets and seek the `<audio>` element at playback. Cheap, fast, no ffmpeg needed in the worker.

### Out of scope (future)
- Per-scene re-recording / trimming.
- AI synonym matching (word "explain" reveals an "explanation" animation).
- SRT export from `word_timings`.
- Auto-suggesting animations from the transcript.
