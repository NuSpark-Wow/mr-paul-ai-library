// Mr. Paul's AI Library voice — ElevenLabs text-to-speech, one short passage at a time
// Env: ELEVENLABS_API_KEY (required for the voice; without it the page uses the browser voice)
// Optional: ELEVENLABS_VOICE_ID (Man) and ELEVENLABS_VOICE_ID_WOMAN (Woman) to swap in different voices
// Only the narrator's own words are sent here. No visitor audio ever reaches this server.

const DEFAULT_MAN = "fIoDqeVKE9jI9AGvEvZU";   // CJ - Articulate & Educational
const DEFAULT_WOMAN = "5MxhuJFpo9hpzbxa88y6"; // Megan - Crisp, Clean Educator
const cache = new Map(); // repeat answers don't cost twice (resets when the server sleeps)

module.exports = async (req, res) => {
  const key = process.env.ELEVENLABS_API_KEY;
  // Health check you can open in a browser: /api/speak  (never shows the key)
  if (req.method === "GET") {
    const out = { api_key_set: !!key, man_voice_id: process.env.ELEVENLABS_VOICE_ID || DEFAULT_MAN, woman_voice_id: process.env.ELEVENLABS_VOICE_ID_WOMAN || DEFAULT_WOMAN };
    if (key) {
      for (const who of ["man", "woman"]) {
        try {
          const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${out[who + "_voice_id"]}?output_format=mp3_22050_32`, {
            method: "POST", headers: { "xi-api-key": key, "content-type": "application/json" },
            body: JSON.stringify({ text: "Hi.", model_id: process.env.ELEVENLABS_MODEL || "eleven_flash_v2_5" })
          });
          out[who] = r.ok ? "working" : `error ${r.status}: ${(await r.text()).slice(0, 200)}`;
        } catch (e) { out[who] = "error: " + e.message; }
      }
    }
    return res.json(out);
  }
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!key) return res.status(501).json({ error: "voice_off" });
  const who = (req.body || {}).voice === "woman" ? "woman" : "man";
  const voice = who === "woman"
    ? (process.env.ELEVENLABS_VOICE_ID_WOMAN || DEFAULT_WOMAN)
    : (process.env.ELEVENLABS_VOICE_ID || DEFAULT_MAN);

  const text = String((req.body || {}).text || "").trim().slice(0, 2600);
  if (!text) return res.status(400).json({ error: "empty" });
  const speed = (req.body || {}).speed === "slow" ? 0.85 : 1.0;
  const ck = who + "|" + speed + "|" + text;
  if (cache.has(ck)) return res.json(cache.get(ck));

  try {
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}/with-timestamps?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { "xi-api-key": key, "content-type": "application/json" },
      body: JSON.stringify({
        text,
        model_id: process.env.ELEVENLABS_MODEL || "eleven_flash_v2_5",
        voice_settings: who === "man"
          ? { stability: 0.5, similarity_boost: 0.8, style: 0.2, use_speaker_boost: true, speed }
          : { stability: 0.5, similarity_boost: 0.8, style: 0.2, use_speaker_boost: true, speed }
      })
    });
    if (!r.ok) return res.status(502).json({ error: "voice_failed" });
    const d = await r.json();
    const out = { audio: d.audio_base64, alignment: d.alignment || d.normalized_alignment || null };
    if (cache.size > 200) cache.clear();
    cache.set(ck, out);
    return res.json(out);
  } catch (e) {
    return res.status(502).json({ error: "voice_failed" });
  }
};
