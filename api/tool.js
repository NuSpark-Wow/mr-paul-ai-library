// Mr. Paul's AI Library — hands back one tool's instructions, exactly as Mr. Paul wrote them,
// for the "Copy instructions" button (so a visitor can paste them into another AI for a second perspective).

const TOOLS = require("./_data/tools.json");

module.exports = async (req, res) => {
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });
  const tool = TOOLS[String(req.query.id || "")];
  if (!tool) { res.setHeader("Cache-Control", "no-store"); return res.status(404).json({ error: "no_tool" }); }
  res.setHeader("Cache-Control", "public, s-maxage=86400");
  return res.status(200).json({ title: tool.title, instructions: tool.body });
};
