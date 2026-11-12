// Mr. Paul's AI Library — hands back one tool's instructions, exactly as Mr. Paul wrote them,
// for the "Copy instructions" button (so a visitor can paste them into another AI for a second perspective).

const TOOLS = require("./_data/tools.json");

module.exports = async (req, res) => {
  if (!allowedRequest(req)) return blockRequest(res);
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });
  const tool = TOOLS[String(req.query.id || "")];
  if (!tool) { res.setHeader("Cache-Control", "no-store"); return res.status(404).json({ error: "no_tool" }); }
  res.setHeader("Cache-Control", "public, s-maxage=86400");
  return res.status(200).json({ title: tool.title, instructions: tool.body });
};

// ---------- website lock ----------
// Only answer this tool's own pages and Paul's websites, so nobody else can run the tool on his credits.
// Add more sites in Vercel with an ALLOWED_SITES setting (comma separated); set LOCK_OFF to 1 to switch the lock off.
function allowedRequest(req) {
  if (String(process.env.LOCK_OFF || "") === "1") return true;
  const sites = ["nusparkpublishing.com", "nusparkmarketing.com", "nusparklearnwow.com"]
    .concat(String(process.env.ALLOWED_SITES || "").split(",").map(s => s.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "")).filter(Boolean));
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").toLowerCase().split(":")[0];
  const ok = u => {
    try {
      const h = new URL(u).hostname.toLowerCase();
      return h === host || h === "localhost" || h === "127.0.0.1" || sites.some(d => h === d || h.endsWith("." + d));
    } catch (e) { return false; }
  };
  const origin = req.headers.origin, ref = req.headers.referer || req.headers.referrer;
  if (origin && origin !== "null") return ok(origin);
  if (ref) return ok(ref);
  return req.method === "GET"; // quick status checks; browsers always say where a POST comes from
}
function blockRequest(res) {
  res.statusCode = 403;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ error: "not_allowed", message: "This tool only works on NuSpark websites." }));
}
