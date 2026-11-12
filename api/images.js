// Free, legal photo finder for Mr. Paul's AI Library.
// Sources, all free to show: Wikimedia Commons (public domain / CC0 only), Library of Congress
// ("no known restrictions" only), Openverse (CC0 + public domain mark), The Met and the Cleveland
// Museum of Art (open access, CC0), the Smithsonian (open access, CC0; needs the free
// SMITHSONIAN_API_KEY in Vercel), and NASA.
// When none of those has a good match, the best photo from a Google Images search (Serper, needs
// SERPER_API_KEY in Vercel) is shown instead, credited with its website and a link back to it. Each web
// photo is first checked by a quick AI look: family-safe, really showing the subject, not a watermarked
// stock image or a page of text.
// The search words come from the tool's own answer, or from a visitor using "Replace it" under a photo;
// either way they pass the same word filter and only free-to-show sources are searched.

const UA = "MrPaulsAILibrary/1.0 (educational site; nusparkpublishing.com)";
const BAD = /\b(nude|naked|nsfw|sex|erotic|corpse|dead body|gore|blood|weapon|gun|execution|war crime|torture|skull|drug)\b/i;
// A report asking for a photo should not get a map, logo or chart, unless it asked for one.
const NOT_A_PHOTO = /\b(map|topo|topography|topographic|relief|satellite|landsat|locator|location|diagram|logo|chart|graph|flag|coat of arms|icon|floor plan|blueprint|seal|emblem|signature|stamp)\b/i;
const wasShown = (seen, src) => !!(seen && src && seen.has(String(src).slice(-80)));
// Wikimedia's own wording for an unnamed author is tidied into a plain name
const tidyCredit = s => String(s || "").replace(/no machine-readable author provided\.?/i, "").replace(/\s*assumed \(based on copyright claims\)\.?/i, "").replace(/\s+/g, " ").trim();
const strip = s => String(s || "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim().slice(0, 90);
const get = (url, headers) => fetch(url, { headers: { "User-Agent": UA, ...(headers || {}) }, signal: AbortSignal.timeout(8000) });

// the meaningful words of the search, used to check a result is really about the subject
const STOP = new Set(["the", "and", "for", "with", "from", "photo", "photograph", "picture", "image", "old", "early", "modern", "vintage", "historic", "historical", "famous",
  "portrait", "painting", "sculpture", "statue", "drawing", "engraving", "artwork", "print", "illustration", "original", "museum"]);
const keywords = q => q.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 4 && !STOP.has(w));
function about(q, text) {
  const words = keywords(q); if (!words.length) return true;
  const hay = String(text || "").toLowerCase();
  return words.some(w => hay.includes(w) || hay.includes(w.replace(/s$/, "")));
}
const wrongKind = (q, title) => NOT_A_PHOTO.test(title) && !NOT_A_PHOTO.test(q);
const strip2 = s => String(s || "").replace(/<[^>]*>/g, " ").slice(0, 600);
// Stricter check for the biggest source: the first search word (the main subject) must be in the photo's
// title or description, and so must most of the other words. Keeps out photos that only mention the subject in passing.
function onSubject(q, title, desc) {
  const words = keywords(q); if (!words.length) return true;
  const hay = (title + " " + desc).toLowerCase();
  const has = w => hay.includes(w) || hay.includes(w.replace(/s$/, ""));
  if (!has(words[0])) return false;
  const found = words.filter(has).length;
  return found === words.length || (words.length >= 4 && found >= words.length - 1);
}

async function fromCommons(q, quoted, seen) {
  const url = "https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*&generator=search"
    + "&gsrnamespace=6&gsrlimit=15&gsrsearch=" + encodeURIComponent(q + " filetype:bitmap")
    + "&prop=imageinfo&iiprop=url|size|extmetadata&iiurlwidth=900";
  const r = await get(url);
  if (!r.ok) throw new Error("HTTP " + r.status);
  const pages = Object.values((await r.json()).query?.pages || {}).sort((a, b) => (a.index || 0) - (b.index || 0));
  for (const p of pages) {
    const info = p.imageinfo?.[0]; const m = info?.extmetadata || {};
    const lic = (m.LicenseShortName?.value || "") + " " + (m.License?.value || "");
    if (!info || !/public domain|\bpd\b|cc0|pdm/i.test(lic)) continue;
    if ((info.width || 0) < 500) continue;   // too small to see well on a phone or for older eyes
    const file = p.title.replace(/^File:/, "");
    const title = file.replace(/\.[a-z]+$/i, "").replace(/_/g, " ");
    if (BAD.test(title) || BAD.test(m.ImageDescription?.value || "")) continue;
    if (!/\.(jpe?g|tiff?|webp)$/i.test(file) && !NOT_A_PHOTO.test(q)) continue;   // drawings and maps are mostly .png/.gif
    if (wrongKind(q, title)) continue;
    if (!onSubject(q, title, strip2(m.ImageDescription?.value) + " " + strip2(m.ObjectName?.value))) continue;
    if (wasShown(seen, info.thumburl || info.url)) continue;   // "Show another photo" skips the ones already shown
    return { src: info.thumburl || info.url, title: strip(title), credit: strip(tidyCredit(String(m.Artist?.value || "").replace(/<[^>]*>/g, " "))) || "Unknown",
      license: /cc0/i.test(lic) ? "CC0" : "Public domain", source: "Wikimedia Commons", link: info.descriptionurl };
  }
  return null;
}

async function fromLoc(q, quoted, seen) {
  const r = await get("https://www.loc.gov/photos/?fo=json&c=10&q=" + encodeURIComponent(q));
  if (!r.ok) throw new Error("HTTP " + r.status);
  for (const it of (await r.json()).results || []) {
    const item = it.item || {};
    const rights = [item.rights_advisory, item.rights_information].flat().filter(Boolean).join(" ");
    if (!/no known restrictions/i.test(rights) || it.access_restricted) continue;
    const imgs = (it.image_url || []).filter(u => /\.jpe?g/i.test(u));
    if (!imgs.length) continue;
    const title = strip(it.title).replace(/^\[|\]$/g, "");
    if (BAD.test(title) || wrongKind(q, title) || !onSubject(q, title, [it.subject].flat().join(" ") + " " + [it.description].flat().join(" "))) continue;
    const by = [it.contributor].flat().filter(Boolean)[0];
    if (wasShown(seen, imgs[imgs.length - 1].split("#")[0])) continue;   // "Show another photo" skips the ones already shown
    return { src: imgs[imgs.length - 1].split("#")[0], title, credit: by ? strip(by).replace(/\b[a-z]/g, c => c.toUpperCase()) : "Library of Congress",
      license: "No known restrictions", source: "Library of Congress", link: it.url || it.id };
  }
  return null;
}

// Smithsonian Open Access: only items whose image is marked CC0. Skipped quietly if no key is set.
async function fromSmithsonian(q, quoted, seen) {
  const key = String(process.env.SMITHSONIAN_API_KEY || "").trim(); if (!key) return null;   // trimmed: a stray space after a pasted key makes it fail
  const r = await get("https://api.si.edu/openaccess/api/v1.0/search?rows=8&api_key=" + encodeURIComponent(key)
    + "&q=" + encodeURIComponent(q + ' AND online_media_type:"Images"'));
  if (!r.ok) { const why = await r.text().catch(() => ""); throw new Error("HTTP " + r.status + " " + why.replace(/\s+/g, " ").slice(0, 60)); }
  for (const row of (await r.json()).response?.rows || []) {
    const d = row.content?.descriptiveNonRepeating || {};
    const m = (d.online_media?.media || []).find(x => x.type === "Images" && x.usage?.access === "CC0" && x.content);
    if (!m) continue;
    const title = strip(row.title);
    if (BAD.test(title) || wrongKind(q, title) || !onSubject(q, title, "")) continue;
    if (wasShown(seen, m.content + (m.content.includes("?") ? "&" : "?") + "max=900")) continue;   // "Show another photo" skips the ones already shown
    return { src: m.content + (m.content.includes("?") ? "&" : "?") + "max=900", title, credit: strip(d.data_source) || "Smithsonian Institution",
      license: "CC0", source: "Smithsonian", link: d.record_link || "https://www.si.edu/openaccess" };
  }
  return null;
}

async function fromOpenverse(q, quoted, seen) {
  const r = await get("https://api.openverse.org/v1/images/?license=cc0,pdm&mature=false&page_size=10&q=" + encodeURIComponent(q));
  if (!r.ok) throw new Error("HTTP " + r.status);
  for (const it of (await r.json()).results || []) {
    if (BAD.test(it.title || "") || it.mature || wrongKind(q, it.title || "")) continue;
    if (wasShown(seen, it.thumbnail || it.url)) continue;   // "Show another photo" skips the ones already shown
    return { src: it.thumbnail || it.url, title: strip(it.title), credit: strip(it.creator) || "Unknown",
      license: it.license === "cc0" ? "CC0" : "Public domain", source: "Openverse", link: it.foreign_landing_url };
  }
  return null;
}

// The Met's search moved to v1.1 in October 2026; each object is then looked up on its own.
async function fromMet(q, quoted, seen) {
  const r = await get("https://collectionapi.metmuseum.org/public/collection/v1.1/search?hasImages=true&isPublicDomain=true&limit=6&q=" + encodeURIComponent(q));
  if (!r.ok) throw new Error("HTTP " + r.status);
  for (const id of ((await r.json()).objectIDs || []).slice(0, 4)) {
    const o = await get("https://collectionapi.metmuseum.org/public/collection/v1/objects/" + id).then(x => x.ok ? x.json() : null).catch(() => null);
    if (!o || !o.isPublicDomain || !o.primaryImageSmall) continue;
    if (BAD.test(o.title || "") || !onSubject(q, o.title || "", [o.objectName, o.artistDisplayName, o.culture].join(" "))) continue;
    if (wasShown(seen, o.primaryImageSmall)) continue;   // "Show another photo" skips the ones already shown
    return { src: o.primaryImageSmall, title: strip(o.title), credit: strip(o.artistDisplayName) || "The Metropolitan Museum of Art",
      license: "CC0", source: "The Met", link: o.objectURL };
  }
  return null;
}

async function fromCleveland(q, quoted, seen) {
  const r = await get("https://openaccess-api.clevelandart.org/api/artworks/?cc0=1&has_image=1&limit=6&fields=id,title,creators,images,share_license_status,url&q=" + encodeURIComponent(q));
  if (!r.ok) throw new Error("HTTP " + r.status);
  for (const it of (await r.json()).data || []) {
    const src = it.images?.web?.url;
    if (!src || it.share_license_status !== "CC0") continue;
    const by = it.creators?.[0]?.description || "";
    if (BAD.test(it.title || "") || !onSubject(q, it.title || "", by)) continue;
    if (wasShown(seen, src)) continue;   // "Show another photo" skips the ones already shown
    return { src, title: strip(it.title), credit: strip(by) || "Cleveland Museum of Art", license: "CC0", source: "Cleveland Museum of Art", link: it.url };
  }
  return null;
}

// Google Images through Serper. Stock-photo sellers and social sites are skipped (watermarks, broken links).
const SKIP_SITES = /(fbsbx|facebook|instagram|tiktok|twitter|x\.com|threads\.net|pinterest|pinimg|shutterstock|alamy|gettyimages|istockphoto|dreamstime|depositphotos|123rf|stock\.adobe|agefotostock|bigstock|vectorstock|freepik|ebay|amazon|etsy|walmart|redbubble|teepublic)/i;
async function serper(q, safe) {
  const key = String(process.env.SERPER_API_KEY || "").trim();
  return fetch("https://google.serper.dev/images", { method: "POST", signal: AbortSignal.timeout(8000),
    headers: { "X-API-KEY": key, "content-type": "application/json" },
    body: JSON.stringify(safe ? { q, num: 20, gl: "us", hl: "en", safe: "active" } : { q, num: 20, gl: "us", hl: "en" }) });
}
// A quick AI look at one web photo before it is shown. The server downloads Google's small preview copy
// of the photo and sends it to the AI, which is more reliable than asking the AI to open other websites.
let lastWebNote = "";
async function looksRight(q, it) {
  const key = process.env.ANTHROPIC_API_KEY; if (!key) return "no anthropic key";
  try {
    const pic = await fetch(it.thumbnailUrl || it.imageUrl, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(6000) });
    if (!pic.ok) return "preview " + pic.status;
    let type = (pic.headers.get("content-type") || "image/jpeg").split(";")[0].trim();
    if (!/^image\/(jpeg|png|gif|webp)$/.test(type)) type = "image/jpeg";
    const raw = Buffer.from(await pic.arrayBuffer());
    if (raw.length > 4500000) return "too big";   // a very large archive file is let through unchecked
    const data = raw.toString("base64");
    const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", signal: AbortSignal.timeout(12000),
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-haiku-5-5", max_tokens: 1024, messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: type, data } },
        { type: "text", text: `This picture would appear on a family learning website; readers include children. The picture is meant to show: "${q}". Answer YES only if it is a clear photograph (or a still or promotional photo from a show or film, or the artwork, drawing or museum object itself when that is the subject) that really shows that subject, not just something with the same name or colors, is family-safe, and is not mostly text, a meme, a collage of many small pictures, or covered with a watermark. Otherwise answer NO. One word.` }
      ] }] }) });
    if (!r.ok) { const t = await r.text().catch(() => ""); return "ai " + r.status + " " + t.slice(0, 80); }
    const d = await r.json();
    const ans = (d.content || []).map(c => c.text || "").join("").trim();
    return /^\W*yes/i.test(ans) ? true : "ai said [" + ans.slice(0, 20) + "] stop " + d.stop_reason;
  } catch (e) { return "error " + String(e.message || e).slice(0, 60); }
}
async function fromWeb(q, quoted, seen) {
  lastWebNote = "";
  if (!String(process.env.SERPER_API_KEY || "").trim()) return null;
  const gq = quoted || q;
  let r = await serper(gq, true);
  // Serper's free plan refuses quotation marks; then the same words go without them
  if (r.status === 400 && quoted) r = await serper(quoted.replace(/"/g, ""), true);
  if (r.status === 400) r = await serper(quoted ? quoted.replace(/"/g, "") : q, false);
  // an exact-name search that finds nothing tries again without the quotes
  if (r.ok && quoted) { const j = await r.clone().json().catch(() => ({})); if (!(j.images || []).length) r = await serper(quoted.replace(/"/g, ""), true); }
  if (!r.ok) { const why = await r.text().catch(() => ""); throw new Error("HTTP " + r.status + " " + why.replace(/\s+/g, " ").slice(0, 60)); }
  const all = (await r.json()).images || [];
  const list = all.filter(it => it.imageUrl && /^https:\/\//i.test(it.imageUrl)
    && !/\.(svg|gif)(\?|$)/i.test(it.imageUrl) && !SKIP_SITES.test((it.domain || "") + " " + (it.link || "")) && !/(fbsbx|cdninstagram|pinimg|tiktokcdn|twimg)/i.test(it.imageUrl)
    && (it.imageWidth || 0) >= 450 && !BAD.test(it.title || "") && !wrongKind(q, it.title || "") && !wasShown(seen, it.imageUrl)).slice(0, 4);
  if (!list.length) { lastWebNote = all.length + " results, none passed the filters"; return null; }
  const ok = await Promise.all(list.map(it => looksRight(quoted || q, it)));
  lastWebNote = list.map((it, i) => (it.domain || "") + ": " + (ok[i] === true ? "yes" : ok[i])).join(" ; ");
  const it = list[ok.indexOf(true)]; if (!it) return null;
  const site = strip(it.source || it.domain || "").replace(/^www\./, "");
  return { src: it.imageUrl, thumb: it.thumbnailUrl || "", title: strip(it.title), credit: site || "the web", license: "From the web",
    source: site || "the web", link: it.link || "", web: true };
}

// ---------- real labeled diagrams ----------
// A tool asks for a diagram; for a real thing (the skull, a flower, a volcano) the site first looks for a
// real labeled diagram, from Wikimedia Commons (public domain or free with credit) and then the web.
// The AI looks at each one and keeps it only if it shows the parts the lesson names, with labels
// big enough to read. Otherwise the page draws the diagram from the lesson's own words.
const FREE_LIC = /public domain|\bpd\b|cc0|pdm|cc[ -]by(?:[ -]sa)?[ -]?\d|cc[ -]by(?:[ -]sa)?\b|attribution/i;
async function commonsDiagrams(q) {
  const url = "https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*&generator=search"
    + "&gsrnamespace=6&gsrlimit=20&gsrsearch=" + encodeURIComponent(q.replace(/\blabell?ed\b/gi, " ").replace(/\s+/g, " ").trim())
    + "&prop=imageinfo&iiprop=url|size|extmetadata&iiurlwidth=1100";
  const r = await get(url); if (!r.ok) throw new Error("HTTP " + r.status);
  const pages = Object.values((await r.json()).query?.pages || {}).sort((a, b) => (a.index || 0) - (b.index || 0));
  const out = [];
  for (const p of pages) {
    const info = p.imageinfo?.[0]; const m = info?.extmetadata || {};
    const lic = (m.LicenseShortName?.value || "") + " " + (m.License?.value || "");
    if (!info || !info.thumburl || !FREE_LIC.test(lic) || /\bnc\b|noncommercial|\bnd\b|noderiv/i.test(lic)) continue;
    if ((info.width || 0) < 500) continue;
    const title = p.title.replace(/^File:/, "").replace(/\.[a-z]+$/i, "").replace(/_/g, " ");
    if (BAD.test(title) || BAD.test(m.ImageDescription?.value || "")) continue;
    const short = strip(m.LicenseShortName?.value) || "Free license";
    out.push({ src: info.thumburl, check: info.thumburl, title: strip(title), credit: strip(tidyCredit(String(m.Artist?.value || "").replace(/<[^>]*>/g, " "))) || "Unknown",
      license: short, source: "Wikimedia Commons", link: info.descriptionurl, kind: "diagram" });
    if (out.length >= 4) break;
  }
  return out;
}
async function webDiagrams(q) {
  if (!String(process.env.SERPER_API_KEY || "").trim()) return [];
  let r = await serper(q, true); if (r.status === 400) r = await serper(q, false);
  if (!r.ok) throw new Error("serper " + r.status);
  const out = [];
  for (const it of (await r.json()).images || []) {
    if (!it.imageUrl || !/^https:\/\//i.test(it.imageUrl) || /\.gif(\?|$)/i.test(it.imageUrl)) continue;
    if (SKIP_SITES.test((it.domain || "") + " " + (it.link || "")) || /(fbsbx|cdninstagram|pinimg|tiktokcdn|twimg)/i.test(it.imageUrl)) continue;
    if ((it.imageWidth || 0) < 500 || BAD.test(it.title || "")) continue;
    const site = strip(it.source || it.domain || "").replace(/^www\./, "") || "the web";
    out.push({ src: it.imageUrl, thumb: it.thumbnailUrl || "", check: it.thumbnailUrl || it.imageUrl, title: strip(it.title),
      credit: site, license: "From the web", source: site, link: it.link || "", web: true, kind: "diagram" });
    if (out.length >= 4) break;
  }
  return out;
}
// The AI's look at one diagram: does it show the lesson's parts, readably?
async function diagramFits(subject, parts, im) {
  const key = process.env.ANTHROPIC_API_KEY; if (!key) return "no key";
  try {
    const pic = await fetch(im.check, { headers: { "User-Agent": "Mozilla/5.0 " + UA }, signal: AbortSignal.timeout(8000) });
    if (!pic.ok) return "picture " + pic.status;
    let type = (pic.headers.get("content-type") || "image/png").split(";")[0].trim();
    if (!/^image\/(jpeg|png|gif|webp)$/.test(type)) return "type " + type;
    const buf = Buffer.from(await pic.arrayBuffer()); if (buf.length > 4500000) return "too big";
    const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", signal: AbortSignal.timeout(20000),
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-haiku-5-5", max_tokens: 1500, messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: type, data: buf.toString("base64") } },
        { type: "text", text: `A lesson on a family learning website (readers include children) needs a labeled diagram of: "${subject}". The lesson describes it like this: "${parts}".

Answer YES only if ALL of these are true:
1. It is a clear diagram or labeled illustration of that subject (not a photo of a page, not a poster, not a worksheet with blanks, not a quiz).
2. It labels most of the main parts the lesson names (other names for the same parts are fine; a few extra labels are fine).
3. The labels are in English and large enough to read on a phone when the picture fills the screen width.
4. It is family-safe and not covered with a watermark.
Otherwise answer NO.

If the answer is NO, reply with the one word NO. If YES, reply with YES on the first line and then one JSON object, nothing else:
{"about": "2 or 3 plain sentences telling the reader what this diagram shows and how to read it", "terms": [["a label in the diagram", "a short, plain definition (under 20 words)"], ...], "formulas": [["a formula shown in the diagram, as written", "what it means in one plain sentence, then each symbol explained"], ...]}
Define each technical label in the diagram that an average reader might not know (up to 8), accurately and plainly. List any formula or equation that appears in the diagram with every symbol explained; if none appears, give an empty list.` }
      ] }] }) });
    if (!r.ok) { const t = await r.text().catch(() => ""); return "ai " + r.status + " " + t.slice(0, 60); }
    const ans = ((await r.json()).content || []).map(c => c.text || "").join("").trim();
    if (!/^\W*yes/i.test(ans)) return "ai said " + ans.slice(0, 12);
    try {
      const j = JSON.parse(ans.replace(/^\W*yes\W*/i, "").replace(/```[a-z]*\n?/gi, "").replace(/^[^{]*/, "").replace(/[^}]*$/, ""));
      im.about = String(j.about || "").slice(0, 600);
      im.terms = (Array.isArray(j.terms) ? j.terms : []).filter(t => Array.isArray(t) && t[0] && t[1]).slice(0, 8).map(t => [String(t[0]).slice(0, 60), String(t[1]).slice(0, 200)]);
      im.formulas = (Array.isArray(j.formulas) ? j.formulas : []).filter(t => Array.isArray(t) && t[0] && t[1]).slice(0, 4).map(t => [String(t[0]).slice(0, 80), String(t[1]).slice(0, 400)]);
    } catch (e) {}
    return true;
  } catch (e) { return "error " + String(e.message || e).slice(0, 50); }
}
async function findDiagram(q, parts, notes) {
  for (const [name, fn] of [["commons", commonsDiagrams], ["web", webDiagrams]]) {
    let list = [];
    try { list = await fn(q); } catch (e) { notes.push(name + ": " + e.message); continue; }
    if (!list.length) { notes.push(name + ": none"); continue; }
    const ok = await Promise.all(list.map(im => diagramFits(q, parts, im)));
    notes.push(name + ": " + list.map((im, i) => im.title.slice(0, 40) + " = " + (ok[i] === true ? "yes" : ok[i])).join(" ; "));
    const i = ok.indexOf(true);
    if (i >= 0) { const { check, ...im } = list[i]; return im; }
  }
  return null;
}

async function fromNasa(q, quoted, seen) {
  const r = await get("https://images-api.nasa.gov/search?media_type=image&q=" + encodeURIComponent(q));
  if (!r.ok) throw new Error("HTTP " + r.status);
  for (const it of (await r.json()).collection?.items || []) {
    const d = it.data?.[0] || {}; const href = it.links?.[0]?.href;
    if (!href || BAD.test(d.title || "") || BAD.test(d.description || "")) continue;
    if (/©|copyright/i.test(d.description || "")) continue; // skip partner photos with copyright notes
    if (wasShown(seen, href)) continue;   // "Show another photo" skips the ones already shown
    return { src: href, title: strip(d.title), credit: "NASA", license: "Public domain (NASA)", source: "NASA",
      link: "https://images.nasa.gov/details/" + encodeURIComponent(d.nasa_id || "") };
  }
  return null;
}

module.exports = async (req, res) => {
  if (!allowedRequest(req)) return blockRequest(res);
  if (req.query.kind === "diagram") {
    const dq = String(req.query.q || "").replace(/[^\w\s'-]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
    const parts = String(req.query.parts || "").replace(/[<>"]/g, " ").trim().slice(0, 500);
    if (!dq || BAD.test(dq)) return res.json({ image: null });
    const notes = [];
    const image = await findDiagram(dq, parts || dq, notes);
    if (req.query.debug) { res.setHeader("Cache-Control", "no-store"); return res.json({ image, notes }); }
    res.setHeader("Cache-Control", image ? "public, s-maxage=2592000" : "public, s-maxage=86400");
    return res.json({ image });
  }
  // The tool writes the exact name in quotes plus a category, e.g. "Happy Days" TV show. The quotes go to
  // Google so it searches that exact name; the free collections get the same words without quotes.
  const raw = String(req.query.q || "").replace(/[\u201c\u201d]/g, '"').replace(/[^\w\s"'-]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  const quoted = (raw.match(/"/g) || []).length >= 2 ? raw : "";
  // the free archives get just the quoted name (their photo titles rarely include a word like "actor");
  // if Google comes up empty with quotes, it tries the name and category without them
  const name = quoted ? (raw.match(/"([^"]+)"/) || [])[1] || "" : "";
  const plain = raw.replace(/"/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  const q = (name.trim().length >= 3 ? name.trim() : plain).slice(0, 60);
  if (!q || BAD.test(q)) return res.json({ image: null });
  // photos the visitor has already seen for this spot (each sent as its last 80 characters)
  const seen = new Set(String(req.query.not || "").split("||").map(x => x.trim()).filter(Boolean).slice(0, 12));
  const space = /\b(planet|moon|mars|saturn|jupiter|galaxy|star|nebula|rocket|astronaut|space|comet|asteroid|sun|nasa|apollo|shuttle)\b/i.test(q);
  const art = /\b(painting|portrait|sculpture|statue|artwork|drawing|engraving|pottery|vase|tapestry|armor|mosaic|fresco)\b/i.test(q);
  // free public-domain sources first; the web search only when none of them has a good match
  const order = space ? [fromNasa, fromSmithsonian, fromCommons, fromLoc, fromWeb, fromOpenverse]
    : art ? [fromMet, fromCleveland, fromSmithsonian, fromCommons, fromLoc, fromWeb, fromOpenverse]
    : [fromCommons, fromLoc, fromSmithsonian, fromWeb, fromOpenverse, fromMet, fromCleveland, fromNasa];
  // /api/images?q=...&debug=1 shows what each source answered (for checking the sources, not for visitors)
  if (req.query.debug) {
    const report = {};
    for (const fn of [fromCommons, fromLoc, fromSmithsonian, fromWeb, fromOpenverse, fromMet, fromCleveland, fromNasa]) {
      try { const img = await fn(q, quoted, seen); report[fn.name] = img ? img.title : "nothing"; } catch (e) { report[fn.name] = "error: " + String(e.message || e).slice(0, 90); }
    }
    report.smithsonian_key_set = !!process.env.SMITHSONIAN_API_KEY;
    report.web_check = lastWebNote;
    report.google_search = quoted || q;
    report.serper_key_set = !!String(process.env.SERPER_API_KEY || "").trim();
    res.setHeader("Cache-Control", "no-store"); return res.json(report);
  }
  // every photo gets a quick AI look before it is shown (web photos had theirs already):
  // a museum item titled "rainbow" might be a rainbow-colored wig, not a rainbow
  for (const fn of order) {
    try {
      const img = await fn(q, quoted, seen);
      if (!img || !img.src) continue;
      if (!img.web) { const ok = await looksRight(quoted || q, { thumbnailUrl: img.src }); if (ok !== true && !/too big|no anthropic/.test(String(ok))) continue; }
      res.setHeader("Cache-Control", "public, s-maxage=604800"); return res.json({ image: img });
    } catch (e) {}
  }
  res.setHeader("Cache-Control", "public, s-maxage=86400");
  return res.json({ image: null });
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
