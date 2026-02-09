const fs = require('fs');
const path = require('path');

const root = path.join(process.cwd(), 'server', 'src', 'public');
const reportPath = path.join(process.cwd(), 'unused-report.txt');

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(full));
    } else {
      files.push(full);
    }
  }
  return files;
}

const files = walk(root);
const jsFiles = files.filter((f) => f.endsWith('.js'));
const htmlFiles = files.filter((f) => f.endsWith('.html'));
const cssFiles = files.filter((f) => f.endsWith('.css'));

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

const jsContent = jsFiles.map(read).join('\n');
const htmlContent = htmlFiles.map(read).join('\n');
const allSearchContent = jsContent + '\n' + htmlContent;

const functionDefs = new Map();

function addDef(name, file) {
  if (!functionDefs.has(name)) functionDefs.set(name, new Set());
  functionDefs.get(name).add(file);
}

const regexes = [
  /function\s+([A-Za-z_$][\w$]*)\s*\(/g,
  /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*async\s*\(/g,
  /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*\(/g,
  /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*[A-Za-z_$][\w$]*\s*=>/g,
  /\b(let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*function\s*\(/g,
];

for (const file of jsFiles) {
  const content = read(file);
  for (const re of regexes) {
    let match;
    while ((match = re.exec(content)) !== null) {
      const name = match[1] || match[2];
      if (name) addDef(name, file);
    }
  }
}

const unusedFunctions = [];
for (const [name, filesSet] of functionDefs.entries()) {
  const re = new RegExp(`\\b${name}\\b`, 'g');
  const count = (allSearchContent.match(re) || []).length;
  if (count <= 1) {
    unusedFunctions.push({ name, files: Array.from(filesSet) });
  }
}

const cssContent = cssFiles.map(read).join('\n');
const selectorRe = /[.#]([A-Za-z_][\w-]*)/g;
const cssNames = new Set();
let m;
while ((m = selectorRe.exec(cssContent)) !== null) {
  cssNames.add(m[1]);
}

const cssUnused = [];
for (const name of cssNames) {
  const re = new RegExp(`\\b${name}\\b`, 'g');
  const count = (allSearchContent.match(re) || []).length;
  if (count === 0) cssUnused.push(name);
}

function rel(p) {
  return path.relative(process.cwd(), p).replace(/\\/g, '/');
}

let out = 'UNUSED_FUNCTIONS\n';
for (const item of unusedFunctions.sort((a, b) => a.name.localeCompare(b.name))) {
  const files = item.files.map(rel).join(', ');
  out += `${item.name} :: ${files}\n`;
}

out += '\nUNUSED_CSS\n';
for (const name of cssUnused.sort()) {
  out += `${name}\n`;
}

fs.writeFileSync(reportPath, out, 'utf8');
console.log(reportPath);
