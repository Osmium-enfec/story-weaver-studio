## Plan: make export reliable and smooth

### 1. Stop using the current browser recorder as the primary export path

- The current export starts a realtime `MediaRecorder`, then tries to snapshot React/DOM frames with `html-to-image` while the clock is already running.
- When snapshots are slow, the recorder captures the blank/last canvas for long periods, causing white starts, dropped motion, and audio/visual desync.
- MP4 conversion in-browser is also fragile, as shown by the ffmpeg-core import failure.

### 2. Make server-side rendering the main export flow

- Use the existing `render_jobs` queue and render worker architecture as the primary export button behavior.
- On export start, enqueue a job with selected canvases, quality, format, audio setting, and scene scope.
- Show job status/progress on the export page and provide the final downloadable MP4 URL when the render is done.
- Keep cancellation/status UI, but avoid pretending the browser tab is rendering the final video.

### 3. Rebuild the worker’s Remotion renderer to match the real scene data

- Replace the placeholder Remotion scene renderer with a deterministic renderer that uses:
  - scene backgrounds: color, gradient, image, video where possible
  - `scene_elements` positions and z-index
  - text blocks with fonts, colors, scaling, and text backgrounds
  - images/icons/shapes/static assets
  - animation/video assets rendered at their timeline position
- Use `start_ms`, `end_ms`, and `content.start_word_index` to reveal elements at the correct voice timing.
- Convert CSS/timer-based reveals into frame-based Remotion animation so every frame is reproducible and smooth.

### 4. Fix timing and audio in the worker render

- Compute scene durations from `duration_ms` and selected scope.
- Render at fixed FPS with Remotion instead of realtime browser capture.
- Add scene voice audio to the Remotion timeline, respecting existing trim/cut/fade settings as closely as practical.
- Ensure visual element reveal times use the same trimmed/cut scene-local timeline as the audible voice.

### 5. Update the export page UX around queued rendering

- Replace the current “keep this tab open” browser render copy with queued render status.
- Show latest render jobs, progress, failed errors, and completed download links.
- If the worker is not configured, show a clear setup/configuration message instead of falling back to the broken browser export silently.

### 6. Keep a browser preview-only renderer separate

- Keep the existing client-side renderer only for preview/debug if needed, not for production export.
- Remove or de-emphasize in-browser MP4 transcoding for the main path; final output should come from the worker as MP4.

### Technical notes

- No database schema change is likely needed because `render_jobs` already exists.
- The main code changes will be in:
  - `src/routes/projects.$projectId.export.tsx`
  - `src/server/render-jobs.functions.ts`
  - `worker/remotion/MainVideo.tsx`
  - `worker/remotion/Root.tsx`
  - `worker/src/render.ts`
- This turns export from “record what the browser can keep up with” into “render every frame deterministically,” which is the proper architecture for export-heavy video apps.  
  
  
few chat gpt options  
Best approach:
  ### 1. Use one timeline source
  Create a single timeline clock:
  ```

  ```
  ```
  const fps = 30;
  const frameDuration = 1000 / fps;

  for (let frame = 0; frame < totalFrames; frame++) {
    const timeMs = frame * frameDuration;
    renderCanvasAtTime(timeMs);
    captureFrame();
  }
  ```
  Do **not** use `requestAnimationFrame`, CSS animation timing, or real-time delays during export.
  ### 2. Render animations manually
  Every object should calculate its state from `timeMs`:
  ```

  ```
  ```
  function getAnimatedValue(keyframes, timeMs) {
    // find surrounding keyframes
    // interpolate value
  }
  ```
  Example:
  ```

  ```
  ```
  const x = lerp(startX, endX, progress);
  const opacity = lerp(0, 1, progress);
  ```
  This ensures frame 45 is always exactly frame 45.
  ### 3. Export frame-by-frame
  For video export:
  1.   
  Render frame to canvas  

  2.   
  Convert canvas to image frame  

  3.   
  Feed frames into encoder  

  Use:
  - **WebCodecs** for modern browser video encoding  

  - **ffmpeg.wasm** if you need broader export features  

  -   
  Server-side FFmpeg for best quality and speed  

  ### 4. Avoid recording the live canvas
  This usually causes:
  -   
  animation timing mismatch  

  -   
  dropped frames  

  -   
  low-quality output  

  -   
  lag on heavy designs  

  Avoid relying on:
  ```

  ```
  ```
  canvas.captureStream()
  MediaRecorder
  ```
  for final professional export.
  It is okay for preview, not ideal for Canva-like export.
  ### 5. Separate preview and export
  Preview can use real time:
  ```

  ```
  ```
  currentTime = performance.now() - startTime;
  ```
  Export should use fixed time:
  ```

  ```
  ```
  currentTime = frameIndex * (1000 / fps);
  ```
  ### 6. Use high-resolution export canvas
  For export, create a separate canvas:
  ```

  ```
  ```
  exportCanvas.width = designWidth * scale;
  exportCanvas.height = designHeight * scale;
  ctx.scale(scale, scale);
  ```
  Example:
  ```

  ```
  ```
  scale = 2; // for better quality
  ```
  ### Recommended architecture
  ```

  ```
  ```
  Design JSON
     ↓
  Timeline Engine
     ↓
  Renderer
     ↓
  Frame Exporter
     ↓
  Video Encoder
  ```
  Your design JSON should store:
  ```

  ```
  ```
  {
    "objects": [
      {
        "type": "text",
        "x": 100,
        "y": 100,
        "animations": [
          {
            "property": "opacity",
            "from": 0,
            "to": 1,
            "start": 500,
            "duration": 1000,
            "easing": "easeOut"
          }
        ]
      }
    ]
  }
  ```
  Then export by evaluating every object at each timestamp.
  Most likely fix: **stop recording the animation live** and instead **render each frame at exact timestamps**.