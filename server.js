// Tiny zero-dependency server for the Music Catalog.
//   - Serves the SPA and static files from this folder.
//   - POST /api/albums appends a new album to VinylScans.csv (deduped by barcode).
//
// Run:  node server.js       (then open http://localhost:8000/)
//
const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

const PORT = process.env.PORT || 8000;
const ROOT = __dirname;
const CSV_PATH = path.join(ROOT, "VinylScans.csv");
const COVERS_DIR = path.join(ROOT, "covers");
const TRACKS_DIR = path.join(ROOT, "trackcache");
if (!fs.existsSync(COVERS_DIR)) fs.mkdirSync(COVERS_DIR, { recursive: true });
if (!fs.existsSync(TRACKS_DIR)) fs.mkdirSync(TRACKS_DIR, { recursive: true });

// MusicBrainz is used to fetch tracklists (free, no API key). Their guidelines
// require a descriptive User-Agent and no more than ~1 request/second.
const MB_UA = "CollectionDB/1.0 ( https://github.com/mmassie/CollectionDB )";

// Load KEY=VALUE pairs from a local, git-ignored .env file (if present) so a
// plain `node server.js` works without exporting env vars every time.
(function loadDotEnv() {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!(k in process.env)) process.env[k] = v;
  }
})();

// Barcode lookup API (https://rapidapi.com/). The key is read from the
// environment (or the .env file above) so it never lives in a committed file.
const API_HOST = "barcodes1.p.rapidapi.com";
const RAPID_API_KEY = process.env.RAPID_API_KEY || "";

// Create an empty collection file on first run so a fresh clone works.
if (!fs.existsSync(CSV_PATH)) {
  fs.writeFileSync(CSV_PATH, '"Barcode","Title","Artist","Image"\n', "utf8");
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml"
};

const IMG_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);

// Local filename for a remote cover URL: sha1(url) + original extension.
function cacheFilename(src) {
  let ext = ".jpg";
  try {
    const e = path.extname(new URL(src).pathname).toLowerCase();
    if (IMG_EXTS.has(e)) ext = e;
  } catch (_) {}
  return crypto.createHash("sha1").update(src).digest("hex") + ext;
}

// Download url to dest (atomically, following redirects). cb(err).
function downloadImage(url, dest, redirects, cb) {
  const mod = url.startsWith("https:") ? https : http;
  const req = mod.get(url, { headers: { "User-Agent": "MusicCatalog/1.0" } }, (res) => {
    if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
      res.resume();
      return downloadImage(new URL(res.headers.location, url).toString(), dest, redirects - 1, cb);
    }
    if (res.statusCode !== 200) { res.resume(); return cb(new Error("HTTP " + res.statusCode)); }
    const tmp = dest + ".tmp";
    const out = fs.createWriteStream(tmp);
    res.pipe(out);
    out.on("finish", () => out.close(() => fs.rename(tmp, dest, cb)));
    out.on("error", (e) => { fs.unlink(tmp, () => {}); cb(e); });
  });
  req.on("error", cb);
  req.setTimeout(15000, () => req.destroy(new Error("timeout")));
}

// ---- MusicBrainz tracklist lookup ----

// GET a MusicBrainz JSON endpoint. cb(err, json).
function mbGet(pathAndQuery, cb) {
  const opts = {
    hostname: "musicbrainz.org",
    path: pathAndQuery,
    headers: { "User-Agent": MB_UA, "Accept": "application/json" }
  };
  const req = https.get(opts, (res) => {
    if (res.statusCode !== 200) { res.resume(); return cb(new Error("MB HTTP " + res.statusCode)); }
    let data = "";
    res.on("data", (c) => (data += c));
    res.on("end", () => {
      try { cb(null, JSON.parse(data)); } catch (e) { cb(e); }
    });
  });
  req.on("error", cb);
  req.setTimeout(15000, () => req.destroy(new Error("timeout")));
}

// Serialize MusicBrainz calls with a >=1.1s gap between them (their rate limit).
let mbChain = Promise.resolve();
function mbGetThrottled(pathAndQuery) {
  const result = mbChain.then(() => new Promise((resolve, reject) => {
    mbGet(pathAndQuery, (err, json) => (err ? reject(err) : resolve(json)));
  }));
  mbChain = result.catch(() => {}).then(() => new Promise((r) => setTimeout(r, 1100)));
  return result;
}

// Find a tracklist for an album by barcode (preferred) or title+artist.
async function findTracks({ barcode, title, artist }) {
  let mbid = null;

  if (barcode) {
    // Try the barcode as-is plus UPC<->EAN-13 variants (leading zero).
    const variants = [barcode];
    if (/^\d{12}$/.test(barcode)) variants.push("0" + barcode);
    if (/^0\d{12}$/.test(barcode)) variants.push(barcode.slice(1));
    for (const b of variants) {
      const q = "/ws/2/release?query=" + encodeURIComponent("barcode:" + b) + "&fmt=json&limit=1";
      const search = await mbGetThrottled(q);
      if (search.releases && search.releases.length) { mbid = search.releases[0].id; break; }
    }
  }

  if (!mbid && title) {
    let query = 'release:"' + title.replace(/"/g, "") + '"';
    if (artist && artist !== "N/A") query += ' AND artist:"' + artist.replace(/"/g, "") + '"';
    const q = "/ws/2/release?query=" + encodeURIComponent(query) + "&fmt=json&limit=1";
    const search = await mbGetThrottled(q);
    if (search.releases && search.releases.length) mbid = search.releases[0].id;
  }

  if (!mbid) return { found: false, tracks: [] };

  const rel = await mbGetThrottled("/ws/2/release/" + mbid + "?inc=recordings&fmt=json");
  const media = rel.media || [];
  const tracks = [];
  media.forEach((m, mi) => {
    (m.tracks || []).forEach((t) => {
      tracks.push({
        disc: media.length > 1 ? mi + 1 : null,
        number: t.number || String(t.position || ""),
        title: t.title,
        length: t.length || (t.recording && t.recording.length) || null
      });
    });
  });

  return { found: tracks.length > 0, matchedTitle: rel.title || null, mbid, tracks };
}

// Wrap a value as a CSV field (always quoted, "" for embedded quotes) to match
// the existing VinylScans.csv format.
function csvField(v) {
  return '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
}

// Read the raw barcodes already in the CSV (crude but sufficient: first field
// of each quoted row) so we can dedupe.
function existingBarcodes() {
  if (!fs.existsSync(CSV_PATH)) return new Set();
  const text = fs.readFileSync(CSV_PATH, "utf8");
  const codes = new Set();
  text.split(/\r?\n/).forEach(line => {
    const m = line.match(/^"([^"]*)"/);
    if (m) codes.add(m[1]);
  });
  return codes;
}

function appendAlbum({ code, title, artist, image }) {
  code = (code || "").trim();
  // Only dedupe when there's an actual barcode.
  if (code && existingBarcodes().has(code)) {
    return { added: false, reason: "duplicate" };
  }

  let prefix = "";
  if (fs.existsSync(CSV_PATH)) {
    const text = fs.readFileSync(CSV_PATH, "utf8");
    if (text.length && !text.endsWith("\n")) prefix = "\n";
  } else {
    // New file: write the header first.
    prefix = '"Barcode","Title","Artist","Image"\n';
  }

  const row = [code, title, artist, image].map(csvField).join(",");
  fs.appendFileSync(CSV_PATH, prefix + row + "\n", "utf8");
  return { added: true };
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
}

const server = http.createServer((req, res) => {
  // ---- API: save a new album ----
  if (req.method === "POST" && req.url === "/api/albums") {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 1e6) req.destroy(); // basic guard
    });
    req.on("end", () => {
      let album;
      try {
        album = JSON.parse(body || "{}");
      } catch (e) {
        return sendJson(res, 400, { error: "invalid JSON" });
      }
      if (!album.title && !album.code) {
        return sendJson(res, 400, { error: "album needs at least a code or title" });
      }
      try {
        const result = appendAlbum(album);
        return sendJson(res, result.added ? 200 : 200, result);
      } catch (e) {
        console.error(e);
        return sendJson(res, 500, { error: "could not write CSV" });
      }
    });
    return;
  }

  // ---- Barcode lookup proxy (keeps the API key server-side) ----
  if (req.method === "GET" && req.url.startsWith("/api/lookup?")) {
    const code = new URLSearchParams(req.url.slice(req.url.indexOf("?") + 1)).get("code");
    if (!code) return sendJson(res, 400, { error: "missing code" });
    if (!RAPID_API_KEY) {
      return sendJson(res, 503, { error: "server has no RAPID_API_KEY set" });
    }
    const opts = {
      hostname: API_HOST,
      path: "/?query=" + encodeURIComponent(code),
      headers: { "x-rapidapi-host": API_HOST, "x-rapidapi-key": RAPID_API_KEY }
    };
    https.get(opts, (r) => {
      let data = "";
      r.on("data", (c) => (data += c));
      r.on("end", () => {
        try {
          const p = (JSON.parse(data).product) || {};
          sendJson(res, 200, {
            title: p.title || "Unknown Product",
            artist: p.artist || "N/A",
            image: (p.images && p.images[0]) || ""
          });
        } catch (e) {
          sendJson(res, 502, { error: "unexpected response from lookup API" });
        }
      });
    }).on("error", (e) => {
      console.error("lookup failed:", e.message);
      sendJson(res, 502, { error: "lookup request failed" });
    });
    return;
  }

  // ---- Tracklist lookup (MusicBrainz), cached on disk ----
  if (req.method === "GET" && req.url.startsWith("/api/tracks?")) {
    const q = new URLSearchParams(req.url.slice(req.url.indexOf("?") + 1));
    const barcode = (q.get("barcode") || "").trim();
    const title = (q.get("title") || "").trim();
    const artist = (q.get("artist") || "").trim();
    if (!barcode && !title) return sendJson(res, 400, { error: "need barcode or title" });

    const key = crypto.createHash("sha1")
      .update(barcode || (artist + "|" + title)).digest("hex");
    const cacheFile = path.join(TRACKS_DIR, key + ".json");

    if (fs.existsSync(cacheFile)) {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      return fs.createReadStream(cacheFile).pipe(res);
    }

    findTracks({ barcode, title, artist })
      .then((result) => {
        // Only cache positive results, so misses can be retried later.
        if (result.found) fs.writeFile(cacheFile, JSON.stringify(result), () => {});
        sendJson(res, 200, result);
      })
      .catch((err) => {
        console.error("tracks lookup failed: " + err.message);
        sendJson(res, 502, { error: "tracklist lookup failed" });
      });
    return;
  }

  // ---- Cached album-cover proxy ----
  // GET /cover?src=<remote image url> -> download once into covers/, then
  // serve from disk. Keeps the CSV portable (it still stores the real URLs)
  // while making covers available offline after the first load.
  if (req.method === "GET" && req.url.startsWith("/cover?")) {
    const src = new URLSearchParams(req.url.slice(req.url.indexOf("?") + 1)).get("src");
    if (!src || !/^https?:\/\//i.test(src)) {
      res.writeHead(400);
      return res.end("bad src");
    }
    const file = path.join(COVERS_DIR, cacheFilename(src));
    const serve = () => {
      const ext = path.extname(file).toLowerCase();
      res.writeHead(200, {
        "Content-Type": MIME[ext] || "image/jpeg",
        "Cache-Control": "public, max-age=31536000"
      });
      fs.createReadStream(file).pipe(res);
    };
    if (fs.existsSync(file)) return serve();
    return downloadImage(src, file, 5, (err) => {
      if (err) {
        console.error("cover download failed: " + src + " (" + err.message + ")");
        res.writeHead(502);
        return res.end("cover fetch failed");
      }
      serve();
    });
  }

  // ---- Static files ----
  let urlPath = decodeURIComponent(req.url.split("?")[0]);
  if (urlPath === "/") urlPath = "/barcode_lookup_app.html";

  // Prevent path traversal.
  const filePath = path.normalize(path.join(ROOT, urlPath));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end("Not found");
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    res.end(data);
  });
});

// Bind to all interfaces so other devices on the LAN (e.g. a phone) can reach it.
server.listen(PORT, "0.0.0.0", () => {
  console.log("Music Catalog serving folder: " + ROOT);
  console.log("  local:   http://localhost:" + PORT + "/");
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs) {
      if (a.family === "IPv4" && !a.internal) {
        console.log("  network: http://" + a.address + ":" + PORT + "/  (" + name + ")");
      }
    }
  }
});
