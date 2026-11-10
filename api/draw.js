// Mr. Paul's AI Library — draws one diagram for the screen, from the description a tool asked for.
// Repeat diagrams are saved on Vercel's network (instant + free).
// Env: ANTHROPIC_API_KEY (required), BOARD_MODEL (optional)

const BOARD_MODEL = process.env.BOARD_MODEL || "claude-haiku-5-5";

const SYSTEM = `You are the diagram artist for an educational website. Given a description of a diagram and its caption, draw ONE clear, accurate, labeled diagram, the kind found in a well-made illustrated reference book.

Reply with SVG ELEMENTS ONLY: no <svg> wrapper, no markdown, no code fence, no words before or after. If the description asks for something that is not suitable for a general audience that includes children, reply with exactly: NONE

THE CANVAS: 800 wide x 450 tall, on a warm white page.
- Use single quotes for attribute values.
- Allowed elements: g, path, line, circle, ellipse, rect, polyline, polygon, text. Nothing else.
- Colors only: #1f2a44 (navy ink, main outlines and all labels), #2563eb (blue), #0f766e (teal), #b45309 (amber, arrows and motion), #be185d (rose, highlights), #4d7c0f (green). Fills, if any, use fill-opacity='0.14'. Outlines use fill='none' unless filled that way.
- Lines: stroke-width 2 to 3, stroke-linecap='round', stroke-linejoin='round'. Dashed lines use stroke-dasharray='6 6'.
- Text: font-family='Inter', font-size 15 to 22, fill='#1f2a44'. A title is not needed (the page shows the caption).
- TEXT SIZE MATH: at font-size 16, each character is about 9px wide (20px font: 11px). Any box holding text must be at least (characters x 9) + 24px wide. Prefer short labels of 1-3 words. Never let text run past a box edge or off the canvas.
- LINES NEVER CROSS TEXT: leader lines end 8px before a label starts; no line passes through a label; text never sits on a shape's outline.
- LAYOUT: plan every position first. Nothing overlaps; leave 16px between things; keep everything inside x 20-780, y 20-430. At most 40 elements.
- CHOOSE THE FORM that fits: a labeled cutaway or object drawing with leader lines; a left-to-right timeline with 3-7 dated points; a numbered step sequence of boxes joined by arrows; a side-by-side comparison; a simple bar chart with labeled axes; a cycle of 3-6 stages in a ring; or a simple map-like layout. Use only facts that are well established; do not invent numbers.`;

function cleanSvg(svg) {
  let s = String(svg || "").replace(/```[a-z]*\n?/gi, "").replace(/<\/?svg[^>]*>/gi, "");
  ["<script", "<style", "<image", "<foreignObject", "<iframe", "<use", "javascript:", "href="].forEach(bad => { s = s.split(bad).join(""); });
  return s.trim();
}

module.exports = async (req, res) => {
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });
  if (!process.env.ANTHROPIC_API_KEY) { res.setHeader("Cache-Control", "no-store"); return res.status(500).json({ error: "oops", reason: "K1" }); }
  const d = String(req.query.d || "").trim().slice(0, 500);
  const c = String(req.query.c || "").trim().slice(0, 160);
  if (!d) { res.setHeader("Cache-Control", "no-store"); return res.status(400).json({ error: "empty" }); }
  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: BOARD_MODEL, max_tokens: 4000, system: SYSTEM, thinking: { type: "disabled" },
          messages: [{ role: "user", content: `Diagram to draw: ${d}${c ? `\nCaption: ${c}` : ""}` }] })
      });
      if (!r.ok) throw new Error("api_" + r.status);
      const data = await r.json();
      const text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("");
      const svg = /^\s*NONE\s*$/.test(text) ? "" : cleanSvg(text);
      if (!svg && !/NONE/.test(text)) throw new Error("blank");
      res.setHeader("Cache-Control", "public, s-maxage=2592000, stale-while-revalidate=604800");
      return res.status(200).json({ svg });
    } catch (e) { lastErr = e; console.error("draw attempt", attempt + 1, "failed:", e.message); }
  }
  res.setHeader("Cache-Control", "no-store");
  return res.status(500).json({ error: "oops" });
};
