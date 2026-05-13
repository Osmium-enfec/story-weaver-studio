// Web Audio helpers for the exporter.
// Bakes per-scene voice settings (segment range, trim, cuts, volume, fades)
// into a single AudioBuffer, then schedules each scene's buffer at its
// cumulative timeline position on a shared AudioContext.

export interface SceneAudioInput {
  voice_url: string | null;
  voice_start_ms: number | null;
  voice_end_ms: number | null;
  voice_trim_start_ms: number;
  voice_trim_end_ms: number | null;
  voice_cuts: { start_ms: number; end_ms: number }[];
  voice_volume: number;
  voice_fade_in_ms: number;
  voice_fade_out_ms: number;
  duration_ms: number;
}

const cache = new Map<string, Promise<AudioBuffer>>();

async function fetchAndDecode(ctx: AudioContext, url: string): Promise<AudioBuffer> {
  if (!cache.has(url)) {
    const p = (async () => {
      const res = await fetch(url, { credentials: "omit" });
      if (!res.ok) throw new Error(`audio fetch ${res.status}`);
      const buf = await res.arrayBuffer();
      return await ctx.decodeAudioData(buf);
    })();
    cache.set(url, p);
  }
  return cache.get(url)!;
}

/**
 * Bake a scene's effective voice into a single AudioBuffer trimmed to the
 * scene's duration_ms. Honors segment range, trim in/out, cuts, volume, and
 * fades. Returns null when the scene has no audio.
 */
export async function bakeSceneAudio(
  ctx: AudioContext,
  scene: SceneAudioInput,
): Promise<AudioBuffer | null> {
  if (!scene.voice_url || scene.voice_start_ms == null || scene.voice_end_ms == null) {
    return null;
  }
  const source = await fetchAndDecode(ctx, scene.voice_url);

  const segStartSec = Math.max(0, scene.voice_start_ms / 1000);
  const segEndSec = Math.min(source.duration, scene.voice_end_ms / 1000);
  const trimInSec = Math.max(0, scene.voice_trim_start_ms / 1000);
  const trimOutSec =
    scene.voice_trim_end_ms != null
      ? scene.voice_trim_end_ms / 1000
      : segEndSec - segStartSec;

  // Build keep-ranges (inside segment, after applying trim and removing cuts).
  // All ranges are seconds relative to the SEGMENT START.
  let keep: { a: number; b: number }[] = [{ a: trimInSec, b: trimOutSec }];
  for (const cut of scene.voice_cuts ?? []) {
    const ca = cut.start_ms / 1000;
    const cb = cut.end_ms / 1000;
    const next: { a: number; b: number }[] = [];
    for (const k of keep) {
      if (cb <= k.a || ca >= k.b) {
        next.push(k);
        continue;
      }
      if (ca > k.a) next.push({ a: k.a, b: Math.min(k.b, ca) });
      if (cb < k.b) next.push({ a: Math.max(k.a, cb), b: k.b });
    }
    keep = next.filter((r) => r.b - r.a > 0.005);
  }
  if (keep.length === 0) return null;

  const sampleRate = source.sampleRate;
  const totalKeepSec = keep.reduce((s, r) => s + (r.b - r.a), 0);
  // Cap to scene duration so audio never spills into the next scene.
  const sceneDurSec = Math.max(0.1, scene.duration_ms / 1000);
  const outDurSec = Math.min(totalKeepSec, sceneDurSec);
  const outFrames = Math.max(1, Math.ceil(outDurSec * sampleRate));

  const offline = new OfflineAudioContext(
    Math.min(2, source.numberOfChannels),
    outFrames,
    sampleRate,
  );

  const gain = offline.createGain();
  const vol = Math.max(0, Math.min(2, scene.voice_volume ?? 1));
  gain.gain.value = vol;
  // Fades on the final concatenated track
  const fadeInSec = Math.min(outDurSec * 0.5, (scene.voice_fade_in_ms ?? 0) / 1000);
  const fadeOutSec = Math.min(outDurSec * 0.5, (scene.voice_fade_out_ms ?? 0) / 1000);
  if (fadeInSec > 0) {
    gain.gain.setValueAtTime(0, 0);
    gain.gain.linearRampToValueAtTime(vol, fadeInSec);
  }
  if (fadeOutSec > 0) {
    gain.gain.setValueAtTime(vol, Math.max(0, outDurSec - fadeOutSec));
    gain.gain.linearRampToValueAtTime(0, outDurSec);
  }
  gain.connect(offline.destination);

  let cursor = 0;
  for (const r of keep) {
    const segOffsetSec = segStartSec + r.a;
    const partDurSec = Math.min(r.b - r.a, outDurSec - cursor);
    if (partDurSec <= 0) break;
    const node = offline.createBufferSource();
    node.buffer = source;
    node.connect(gain);
    node.start(cursor, segOffsetSec, partDurSec);
    cursor += partDurSec;
    if (cursor >= outDurSec) break;
  }

  return await offline.startRendering();
}

export interface ScheduledSceneAudio {
  /** Cumulative seconds since render start where this scene begins. */
  startSec: number;
  buffer: AudioBuffer | null;
}

/**
 * Pre-bake every scene's audio in parallel. Returns an array aligned to
 * `scenes` with cumulative start times.
 */
export async function prepareScenesAudio(
  ctx: AudioContext,
  scenes: SceneAudioInput[],
): Promise<ScheduledSceneAudio[]> {
  const baked = await Promise.all(scenes.map((s) => bakeSceneAudio(ctx, s).catch(() => null)));
  let acc = 0;
  return scenes.map((s, i) => {
    const entry = { startSec: acc, buffer: baked[i] };
    acc += s.duration_ms / 1000;
    return entry;
  });
}

/**
 * Schedule all baked scene audio onto a destination node, starting from
 * `ctx.currentTime + leadInSec`. Returns the planned end time.
 */
export function scheduleScenesAudio(
  ctx: AudioContext,
  scheduled: ScheduledSceneAudio[],
  destination: AudioNode,
  leadInSec = 0.05,
): { endSec: number; nodes: AudioBufferSourceNode[] } {
  const nodes: AudioBufferSourceNode[] = [];
  const t0 = ctx.currentTime + leadInSec;
  let endSec = t0;
  for (const s of scheduled) {
    if (!s.buffer) continue;
    const n = ctx.createBufferSource();
    n.buffer = s.buffer;
    n.connect(destination);
    const startAt = t0 + s.startSec;
    n.start(startAt);
    nodes.push(n);
    endSec = Math.max(endSec, startAt + s.buffer.duration);
  }
  return { endSec, nodes };
}
