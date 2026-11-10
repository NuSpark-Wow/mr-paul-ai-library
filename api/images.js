// Free, legal photo finder for Mr. Paul's AI Library.
// Sources, all free to show: Wikimedia Commons (public domain / CC0 only), Library of Congress
// ("no known restrictions" only), Openverse (CC0 + public domain mark), The Met and the Cleveland
// Museum of Art (open access, CC0), the Smithsonian (open access, CC0; needs the free
// SMITHSONIAN_API_KEY in Vercel), and NASA.
// The search words always come from the tool's own answer, never straight from the visitor.

const UA = "MrPaulsAILibrary/1.0 (educational site; nusparkpublishing.com)";
const BAD = /\b(nude|naked|nsfw|sex|erotic|corpse|dead body|gore|blood|weapon|gun|execution|war crime|torture|skull|drug)\b/i;
// A report asking for a photo should not get a map, logo or chart, unless it asked for one.
const NOT_A_PHOTO = /\b(map|locator|diagram|logo|chart|graph|flag|coat of arms|icon|floor plan|blueprint|seal|emblem|signature|stamp)\b/i;
const strip = s => String(s || "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim().slice(0, 90);
const get = (url, headers) => fetch(url, { headers: { "User-Agent": UA, ...(headers || {}) }, signal: AbortSignal.timeout(6000) });

// the meaningful words of the search, used to check a result is really about the subject
const STOP = new Set(["the", "and", "for", "with", "from", "photo", "photograph", "picture", "image", "old", "early", "modern", "vintage", "historic", "historical", "famous"]);
const keywords = q => q.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 4 && !STOP.has(w));
function about(q, text) {
  const words = keywords(q); if (!words.length) return true;
  const hay = String(text || "").toLowerCase();
  return words.some(w => hay.includes(w) || hay.includes(w.replace(/s$/, "")));
}
const wrongKind = (q, title) => NOT_A_PHOTO.test(title) && !NOT_A_PHOTO.test(q);

async function fromCommons(q) {
  const url = "https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*&generator=search"
    + "&gsrnamespace=6&gsrlimit=15&gsrsearch=" + encodeURIComponent(q + " filetype:bitmap")
    + "&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=900";
  const r = await get(url);
  if (!r.ok) return null;
  const pages = Object.values((await r.json()).query?.pages || {}).sort((a, b) => (a.index || 0) - (b.index || 0));
  for (const p of pages) {
    const info = p.imageinfo?.[0]; const m = info?.extmetadata || {};
    const lic = (m.LicenseShortName?.value || "") + " " + (m.License?.value || "");
    if (!info || !/public domain|\bpd\b|cc0|pdm/i.test(lic)) continue;
    const file = p.title.replace(/^File:/, "");
    const title = file.replace(/\.[a-z]+$/i, "").replace(/_/g, " ");
    if (BAD.test(title) || BAD.test(m.ImageDescription?.value || "")) continue;
    if (!/\.(jpe?g|tiff?|webp)$/i.test(file) && !NOT_A_PHOTO.test(q)) continue;   // drawings and maps are mostly .png/.gif
    if (wrongKind(q, title)) continue;
    return { src: info.thumburl || info.url, title: strip(title), credit: strip(m.Artist?.value) || "Unknown",
      license: /cc0/i.test(lic) ? "CC0" : "Public domain", source: "Wikimedia Commons", link: info.descriptionurl };
  }
  return null;
}

async function fromLoc(q) {
  const r = await get("https://www.loc.gov/photos/?fo=json&c=10&q=" + encodeURIComponent(q));
  if (!r.ok) return null;
  for (const it of (await r.json()).results || []) {
    const item = it.item || {};
    const rights = [item.rights_advisory, item.rights_information].flat().filter(Boolean).join(" ");
    if (!/no known restrictions/i.test(rights) || it.access_restricted) continue;
    const imgs = (it.image_url || []).filter(u => /\.jpe?g/i.test(u));
    if (!imgs.length) continue;
    const title = strip(it.title).replace(/^\[|\]$/g, "");
    if (BAD.test(title) || wrongKind(q, title) || !about(q, title + " " + [it.subject].flat().join(" ") + " " + [it.description].flat().join(" "))) continue;
    const by = [it.contributor].flat().filter(Boolean)[0];
    return { src: imgs[imgs.length - 1].split("#")[0], title, credit: by ? strip(by).replace(/\b[a-z]/g, c => c.toUpperCase()) : "Library of Congress",
      license: "No known restrictions", source: "Library of Congress", link: it.url || it.id };
  }
  return null;
}

// Smithsonian Open Access: only items whose image is marked CC0. Skipped quietly if no key is set.
async function fromSmithsonian(q) {
  const key = process.env.SMITHSONIAN_API_KEY; if (!key) return null;
  const r = await get("https://api.si.edu/openaccess/api/v1.0/search?rows=8&api_key=" + encodeURIComponent(key)
    + "&q=" + encodeURIComponent(q + ' AND online_media_type:"Images"'));
  if (!r.ok) return null;
  for (const row of (await r.json()).response?.rows || []) {
    const d = row.content?.descriptiveNonRepeating || {};
    const m = (d.online_media?.media || []).find(x => x.type === "Images" && x.usage?.access === "CC0" && x.content);
    if (!m) continue;
    const title = strip(row.title);
    if (BAD.test(title) || wrongKind(q, title) || !about(q, title)) continue;
    return { src: m.content + (m.content.includes("?") ? "&" : "?") + "max=900", title, credit: strip(d.data_source) || "Smithsonian Institution",
      license: "CC0", source: "Smithsonian", link: d.record_link || "https://www.si.edu/openaccess" };
  }
  return null;
}

async function fromOpenverse(q) {
  const r = await get("https://api.openverse.org/v1/images/?license=cc0,pdm&mature=false&page_size=10&q=" + encodeURIComponent(q));
  if (!r.ok) return null;
  for (const it of (await r.json()).results || []) {
    if (BAD.test(it.title || "") || it.mature || wrongKind(q, it.title || "")) continue;
    return { src: it.thumbnail || it.url, title: strip(it.title), credit: strip(it.creator) || "Unknown",
      license: it.license === "cc0" ? "CC0" : "Public domain", source: "Openverse", link: it.foreign_landing_url };
  }
  return null;
}

// The Met's search moved to v1.1 in October 2026; each object is then looked up on its own.
async function fromMet(q) {
  const r = await get("https://collectionapi.metmuseum.org/public/collection/v1.1/search?hasImages=true&isPublicDomain=true&limit=6&q=" + encodeURIComponent(q));
  if (!r.ok) return null;
  for (const id of ((await r.json()).objectIDs || []).slice(0, 4)) {
    const o = await get("https://collectionapi.metmuseum.org/public/collection/v1/objects/" + id).then(x => x.ok ? x.json() : null).catch(() => null);
    if (!o || !o.isPublicDomain || !o.primaryImageSmall) continue;
    if (BAD.test(o.title || "") || !about(q, [o.title, o.objectName, o.artistDisplayName, o.culture].join(" "))) continue;
    return { src: o.primaryImageSmall, title: strip(o.title), credit: strip(o.artistDisplayName) || "The Metropolitan Museum of Art",
      license: "CC0", source: "The Met", link: o.objectURL };
  }
  return null;
}

async function fromCleveland(q) {
  const r = await get("https://openaccess-api.clevelandart.org/api/artworks/?cc0=1&has_image=1&limit=6&fields=id,title,creators,images,share_license_status,url&q=" + encodeURIComponent(q));
  if (!r.ok) return null;
  for (const it of (await r.json()).data || []) {
    const src = it.images?.web?.url;
    if (!src || it.share_license_status !== "CC0") continue;
    const by = it.creators?.[0]?.description || "";
    if (BAD.test(it.title || "") || !about(q, it.title + " " + by)) continue;
    return { src, title: strip(it.title), credit: strip(by) || "Cleveland Museum of Art", license: "CC0", source: "Cleveland Museum of Art", link: it.url };
  }
  return null;
}

async function fromNasa(q) {
  const r = await get("https://images-api.nasa.gov/search?media_type=image&q=" + encodeURIComponent(q));
  if (!r.ok) return null;
  for (const it of (await r.json()).collection?.items || []) {
    const d = it.data?.[0] || {}; const href = it.links?.[0]?.href;
    if (!href || BAD.test(d.title || "") || BAD.test(d.description || "")) continue;
    if (/©|copyright/i.test(d.description || "")) continue; // skip partner photos with copyright notes
    return { src: href, title: strip(d.title), credit: "NASA", license: "Public domain (NASA)", source: "NASA",
      link: "https://images.nasa.gov/details/" + encodeURIComponent(d.nasa_id || "") };
  }
  return null;
}

module.exports = async (req, res) => {
  const q = String(req.query.q || "").replace(/[^\w\s-]/g, " ").trim().slice(0, 60);
  if (!q || BAD.test(q)) return res.json({ image: null });
  const space = /\b(planet|moon|mars|saturn|jupiter|galaxy|star|nebula|rocket|astronaut|space|comet|asteroid|sun|nasa|apollo|shuttle)\b/i.test(q);
  const art = /\b(painting|portrait|sculpture|statue|artwork|drawing|engraving|pottery|vase|tapestry|armor|mosaic|fresco)\b/i.test(q);
  const order = space ? [fromNasa, fromSmithsonian, fromCommons, fromLoc, fromOpenverse]
    : art ? [fromMet, fromCleveland, fromSmithsonian, fromCommons, fromLoc, fromOpenverse]
    : [fromCommons, fromLoc, fromSmithsonian, fromOpenverse, fromMet, fromCleveland, fromNasa];
  for (const fn of order) {
    try { const img = await fn(q); if (img && img.src) { res.setHeader("Cache-Control", "public, s-maxage=604800"); return res.json({ image: img }); } } catch (e) {}
  }
  res.setHeader("Cache-Control", "public, s-maxage=86400");
  return res.json({ image: null });
};
