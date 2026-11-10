// Mr. Paul's AI Library — the search box's helper. When a keyword search finds no tool (for example
// "football", when the library has sports tools but none just about football), the AI reads the
// catalog and picks the closest tools. Answers are saved, so the same search costs nothing again.
// Env: ANTHROPIC_API_KEY (required)

const CATALOG = require("../catalog.json");
// one short line per tool: id | title | topic | description
const LIST = CATALOG.tools.map(t => `${t.id} | ${t.t} | ${CATALOG.topics[t.k]} | ${String(t.d).slice(0, 110)}`).join("\n");
const IDS = new Set(CATALOG.tools.map(t => t.id));

module.exports = async (req, res) => {
  const q = String(req.query.q || "").replace(/[<>{}"]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  if (q.length < 2) return res.json({ ids: [] });
  if (!process.env.ANTHROPIC_API_KEY) return res.json({ ids: [] });
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", signal: AbortSignal.timeout(20000),
      headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-haiku-5-5", max_tokens: 600,
        system: [
          { type: "text", text: "You help visitors find the right learning tool in a library of guided lessons. Each line of the catalog is: id | title | topic | description. Given what a visitor typed, pick up to 6 tools that would best teach or cover it, best first. A broader tool that covers the subject counts (for example a sports history tool for \"football\", an Earth science teacher for \"volcano\"). Never invent ids. If the search is not appropriate for a family learning site, or nothing fits at all, return an empty list. Reply with one JSON object only: {\"ids\": [\"id\", ...], \"note\": \"one short friendly sentence for the visitor, e.g. No tool is just about football, but these cover it.\"}\n\nCATALOG:" },
          { type: "text", text: LIST, cache_control: { type: "ephemeral" } }
        ],
        messages: [{ role: "user", content: `The visitor typed: ${q}` }]
      })
    });
    if (!r.ok) return res.json({ ids: [] });
    const text = ((await r.json()).content || []).map(c => c.text || "").join("");
    let j = {};
    try { j = JSON.parse(text.replace(/```[a-z]*\n?/gi, "").replace(/^[^{]*/, "").replace(/[^}]*$/, "")); } catch (e) {}
    const ids = (Array.isArray(j.ids) ? j.ids : []).map(String).filter(id => IDS.has(id)).slice(0, 6);
    res.setHeader("Cache-Control", "public, s-maxage=2592000, stale-while-revalidate=604800");
    return res.json({ ids, note: ids.length ? String(j.note || "").slice(0, 160) : "" });
  } catch (e) {
    return res.json({ ids: [] });
  }
};
