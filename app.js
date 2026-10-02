import { analyzeProject, reportAsMarkdown } from './analyzer.js';
import { unzip } from './vendor/fflate.js';

const picker = document.querySelector('#folder');
const zipPicker = document.querySelector('#zip');
const chooseZip = document.querySelector('#choose-zip');
const drop = document.querySelector('#drop');
const empty = document.querySelector('#empty');
const results = document.querySelector('#results');
const findings = document.querySelector('#findings');
const download = document.querySelector('#download');
const reset = document.querySelector('#reset');
const upgrade = document.querySelector('#upgrade');
const demo = document.querySelector('#demo');
let latestReport = '';

const textExtensions = /(^|\/)(package\.json|\.replit|replit\.nix|requirements\.txt|pyproject\.toml|gemfile|cargo\.toml|go\.mod|dockerfile|\.gitignore|[^/]+\.(js|jsx|ts|tsx|mjs|cjs|py|rb|php|json|toml|ya?ml|txt|nix|env))$/i;

async function readFiles(list) {
  const selected = [...list].filter((file) => textExtensions.test(file.webkitRelativePath || file.name) && file.size <= 500_000);
  return Promise.all(selected.map(async (file) => ({
    path: file.webkitRelativePath || file.name,
    content: await file.text(),
  })));
}

function unzipFile(file) {
  return new Promise(async (resolve, reject) => {
    if (file.size > 15_000_000) {
      reject(new Error('For this beta, ZIP files must be smaller than 15 MB. Export a project folder instead.'));
      return;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    let advertisedTotal = 0;
    let archiveTooLarge = false;
    unzip(bytes, {
      filter(entry) {
        if (!textExtensions.test(entry.name) || entry.originalSize > 500_000) return false;
        advertisedTotal += entry.originalSize;
        if (advertisedTotal > 8_000_000) archiveTooLarge = true;
        return !archiveTooLarge;
      },
    }, (error, entries) => {
      if (error) return reject(new Error('The ZIP could not be read. Try exporting the project again.'));
      if (archiveTooLarge) return reject(new Error('The readable contents are too large for this beta. Select the project folder instead.'));
      const decoder = new TextDecoder();
      let total = 0;
      const extracted = [];
      for (const [path, content] of Object.entries(entries)) {
        if (!textExtensions.test(path) || content.length > 500_000) continue;
        total += content.length;
        if (total > 8_000_000) return reject(new Error('The readable contents are too large for this beta. Select the project folder instead.'));
        extracted.push({ path, content: decoder.decode(content) });
      }
      resolve(extracted);
    });
  });
}

function render(result) {
  document.querySelector('#score').textContent = result.score;
  document.querySelector('#summary').textContent = result.summary;
  document.querySelector('#stack').textContent = result.framework;
  document.querySelector('#count').textContent = result.fileCount;
  document.querySelector('#targets').textContent = result.targets.join(' · ');
  document.querySelector('#env-count').textContent = result.envKeyCount;
  findings.replaceChildren();

  if (!result.findings.length) {
    const item = document.createElement('li');
    item.className = 'finding low';
    item.innerHTML = '<strong>No obvious blockers</strong><p>A real deployment test is still required.</p>';
    findings.append(item);
  }

  for (const finding of result.findings) {
    const item = document.createElement('li');
    item.className = `finding ${finding.severity}`;
    const title = document.createElement('strong');
    title.textContent = finding.title;
    const detail = document.createElement('p');
    detail.textContent = finding.detail;
    const action = document.createElement('p');
    action.className = 'action';
    action.textContent = `Next: ${finding.action}`;
    item.append(title, detail, action);
    findings.append(item);
  }

  latestReport = reportAsMarkdown(result);
  empty.hidden = true;
  results.hidden = false;
}

async function inspect(list) {
  drop.classList.add('working');
  try {
    const raw = [...list];
    const files = raw.length === 1 && raw[0].name.toLowerCase().endsWith('.zip')
      ? await unzipFile(raw[0])
      : await readFiles(raw);
    if (!files.length) throw new Error('No supported project files were found in this folder.');
    render(analyzeProject(files));
  } catch (error) {
    window.alert(error.message);
  } finally {
    drop.classList.remove('working');
  }
}

picker.addEventListener('change', () => inspect(picker.files));
zipPicker.addEventListener('change', () => inspect(zipPicker.files));
chooseZip.addEventListener('click', () => zipPicker.click());
drop.addEventListener('click', () => picker.click());
drop.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') picker.click();
});
drop.addEventListener('dragover', (event) => {
  event.preventDefault();
  drop.classList.add('dragging');
});
drop.addEventListener('dragleave', () => drop.classList.remove('dragging'));
drop.addEventListener('drop', (event) => {
  event.preventDefault();
  drop.classList.remove('dragging');
  if (event.dataTransfer.files.length) inspect(event.dataTransfer.files);
});

download.addEventListener('click', () => {
  const blob = new Blob([latestReport], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'migration-readiness-report.md';
  anchor.click();
  URL.revokeObjectURL(url);
});

reset.addEventListener('click', () => {
  picker.value = '';
  zipPicker.value = '';
  results.hidden = true;
  empty.hidden = false;
});

upgrade.addEventListener('click', () => {
  document.querySelector('#beta').showModal();
});

document.querySelector('#beta .close').addEventListener('click', () => {
  document.querySelector('#beta').close();
});

demo.addEventListener('click', () => {
  render(analyzeProject([
    { path: 'demo/package.json', content: JSON.stringify({ dependencies: { express: '1', '@replit/database': '1' }, scripts: { dev: 'node index.js' } }) },
    { path: 'demo/.replit', content: 'run = "node index.js"' },
    { path: 'demo/index.js', content: 'const key = process.env.API_KEY; app.listen(3000);' },
  ]));
});

document.querySelector('#beta-form').addEventListener('submit', (event) => {
  event.preventDefault();
  window.location.assign('https://github.com/amneel-bit/escape-hatch/issues/new?template=migration-request.yml');
});
