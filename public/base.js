// public/base.js
// usage:
//   node public/base.js path/to/file.html
//   node public/base.js path/to/folder   (will use folder/index.html)

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function extFromMime(mime) {
  const m = mime.toLowerCase();
  if (m === "image/jpeg" || m === "image/jpg") return "jpg";
  if (m === "image/svg+xml") return "svg";
  if (m === "image/x-icon") return "ico";
  if (m.startsWith("image/")) {
    // handle things like image/svg+xml, image/vnd.microsoft.icon, etc
    const raw = m.split("/")[1];
    return raw.replace(/\+.*$/, ""); // svg+xml -> svg
  }
  return "bin";
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function saveOnce(buffer, imagesDir, mime, seen) {
  const hash = crypto.createHash("sha1").update(buffer).digest("hex").slice(0, 10);
  const ext = extFromMime(mime);
  const filename = `img-${hash}.${ext}`;
  const fullPath = path.join(imagesDir, filename);
  if (!seen.has(hash)) {
    fs.writeFileSync(fullPath, buffer);
    seen.set(hash, filename);
  }
  return filename;
}

function processHtmlFile(filePath) {
  const html = fs.readFileSync(filePath, "utf8");
  const baseDir = path.dirname(filePath);
  const imagesDir = path.join(baseDir, "images");
  ensureDir(imagesDir);

  // map to dedupe identical blobs
  const seen = new Map();

  // matches only the data:... inside an img src=""
  // keeps quotes and everything else untouched
  const reImgSrc =
    /(?<=\bsrc\s*=\s*["']?)data:(?<mime>image\/[\w.+-]+);base64,(?<data>[A-Za-z0-9+/=\s]+)(?=["']?)/gi;

  // matches only the data:... inside CSS url("...")
  const reCssUrl =
    /(?<=\burl\(\s*["']?)data:(?<mime>image\/[\w.+-]+);base64,(?<data>[A-Za-z0-9+/=\s]+)(?=["']?\s*\))/gi;

  const replacer = (match, _1, _2, _3, _4, _5, groups) => {
    try {
      const mime = groups.mime;
      const b64 = groups.data.replace(/\s+/g, ""); // just in case
      const buf = Buffer.from(b64, "base64");
      const savedName = saveOnce(buf, imagesDir, mime, seen);
      // return relative path (quotes are outside due to the lookbehind/lookahead)
      const rel = path.relative(baseDir, path.join(imagesDir, savedName)).replace(/\\/g, "/");
      return rel;
    } catch (e) {
      // if decoding fails, leave it untouched
      return match;
    }
  };

  let out = html.replace(reImgSrc, replacer);
  out = out.replace(reCssUrl, replacer);

  fs.writeFileSync(filePath, out, "utf8");

  console.log(
    `ok: ${filePath}  -> wrote ${seen.size} image${seen.size === 1 ? "" : "s"} to ${path.relative(
      baseDir,
      imagesDir
    )}/`
  );
}

function run(targetPath) {
  const abs = path.resolve(targetPath);
  if (!fs.existsSync(abs)) {
    console.error("path not found:", targetPath);
    process.exit(1);
  }

  const stat = fs.statSync(abs);
  if (stat.isDirectory()) {
    const indexFile = path.join(abs, "index.html");
    if (!fs.existsSync(indexFile)) {
      console.error("no index.html in", targetPath);
      process.exit(1);
    }
    processHtmlFile(indexFile);
  } else {
    processHtmlFile(abs);
  }
}

// cli
const input = process.argv[2];
if (!input) {
  console.error("usage: node public/base.js <file.html|folder>");
  process.exit(1);
}
run(input);
