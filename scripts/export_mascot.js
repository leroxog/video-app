// Writes the mascot (the function mascot() in static/js/gomat.js) as stand-alone SVG files for the error pages.
//   node scripts/export_mascot.js           writes the files
//   node scripts/export_mascot.js --check   only checks that the files are up to date (exit code 1 if not)
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const check = process.argv.includes("--check");
const source = fs.readFileSync(path.join(root, "static", "js", "gomat.js"), "utf8");
const start = source.indexOf("function mascot(");
if (start < 0) throw new Error("function mascot() not found");
let depth = 0;
let end = -1;
for (let i = source.indexOf("{", start); i < source.length; i++) {
  if (source[i] === "{") depth++;
  else if (source[i] === "}" && --depth === 0) { end = i + 1; break; }
}
const mascot = new Function(`${source.slice(start, end)}; return mascot;`)();
let stale = 0;
for (const mood of ["happy", "sad", "cheer"]) {
  const svg = mascot(mood).replace("<svg viewBox", '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox').replace(' aria-hidden="true"', "") + "\n";
  const file = path.join(root, "static", "img", mood === "happy" ? "gomi.svg" : `gomi-${mood}.svg`);
  if (check) {
    const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n") : null;
    if (current !== svg) { stale++; console.log("out of date:", path.relative(root, file)); }
  } else {
    fs.writeFileSync(file, svg);
    console.log("wrote", path.relative(root, file));
  }
}
process.exit(stale ? 1 : 0);
