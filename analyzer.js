const SECRET_FILE_RE = /(^|\/)(\.env(?:\.[^/]+)?|secrets?\.(json|ya?ml))$/i;

function normalizePath(path) {
  return path.replaceAll('\\', '/').replace(/^\.\//, '');
}

function fileMap(files) {
  return new Map(files.map((file) => [normalizePath(file.path), file.content ?? '']));
}

function basename(path) {
  return normalizePath(path).split('/').at(-1) ?? path;
}

function findByBasename(files, name) {
  return files.find((file) => basename(file.path).toLowerCase() === name.toLowerCase());
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function unique(values) {
  return [...new Set(values)].sort();
}

function envKeys(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=/i)?.[1])
    .filter(Boolean);
}

function referencedEnvKeys(files) {
  const keys = [];
  const patterns = [
    /process\.env\.([A-Z_][A-Z0-9_]*)/gi,
    /process\.env\[['"]([A-Z_][A-Z0-9_]*)['"]\]/gi,
    /os\.environ(?:\.get)?\(\s*['"]([A-Z_][A-Z0-9_]*)['"]/gi,
    /os\.getenv\(\s*['"]([A-Z_][A-Z0-9_]*)['"]/gi,
    /env\(\s*['"]([A-Z_][A-Z0-9_]*)['"]/gi,
  ];

  for (const file of files) {
    if (!/\.(js|jsx|ts|tsx|mjs|cjs|py|rb|php)$/i.test(file.path)) continue;
    if ((file.content?.length ?? 0) > 500_000) continue;
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      for (const match of file.content.matchAll(pattern)) keys.push(match[1]);
    }
  }
  return unique(keys);
}

function detectFramework(pkg, files) {
  const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
  if (deps.next) return 'Next.js';
  if (deps['@remix-run/react']) return 'Remix';
  if (deps['@sveltejs/kit']) return 'SvelteKit';
  if (deps.astro) return 'Astro';
  if (deps.vite && deps.react) return 'React + Vite';
  if (deps.vite && deps.vue) return 'Vue + Vite';
  if (deps.express) return 'Node.js + Express';
  if (findByBasename(files, 'manage.py')) return 'Django';
  if (findByBasename(files, 'requirements.txt') || findByBasename(files, 'pyproject.toml')) return 'Python';
  if (findByBasename(files, 'Gemfile')) return 'Ruby';
  if (findByBasename(files, 'Cargo.toml')) return 'Rust';
  if (findByBasename(files, 'go.mod')) return 'Go';
  if (pkg) return 'Node.js';
  return 'Unknown';
}

function detectTargets(framework, files) {
  const hasDocker = Boolean(findByBasename(files, 'Dockerfile'));
  if (hasDocker) return ['Railway', 'Render', 'Fly.io', 'generic VPS'];
  if (['Next.js', 'React + Vite', 'Vue + Vite', 'Astro', 'SvelteKit'].includes(framework)) {
    return ['Vercel', 'Cloudflare Pages', 'Netlify'];
  }
  if (framework === 'Python' || framework === 'Django' || framework.includes('Express')) {
    return ['Railway', 'Render', 'Fly.io'];
  }
  return ['Railway', 'Render', 'generic VPS'];
}

export function analyzeProject(inputFiles) {
  const files = inputFiles.map((file) => ({ ...file, path: normalizePath(file.path) }));
  const map = fileMap(files);
  const packageFile = findByBasename(files, 'package.json');
  const pkg = packageFile ? safeJson(packageFile.content) : null;
  const framework = detectFramework(pkg, files);
  const secretFiles = files.filter((file) => SECRET_FILE_RE.test(file.path));
  const definedKeys = unique(secretFiles.flatMap((file) => envKeys(file.content ?? '')));
  const referencedKeys = referencedEnvKeys(files);
  const missingKeys = referencedKeys.filter((key) => !definedKeys.includes(key));
  const replitFiles = files.filter((file) => /(^|\/)(\.replit|replit\.nix)$/i.test(file.path));
  const hasGitignore = Boolean(findByBasename(files, '.gitignore'));
  const hasLockfile = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'uv.lock', 'poetry.lock']
    .some((name) => Boolean(findByBasename(files, name)));
  const hasDocker = Boolean(findByBasename(files, 'Dockerfile'));
  const scripts = pkg?.scripts ?? {};
  const hasBuild = Boolean(scripts.build) || ['Python', 'Django', 'Ruby', 'Rust', 'Go'].includes(framework);
  const hasStart = Boolean(scripts.start || scripts.serve) || ['Python', 'Django', 'Ruby', 'Rust', 'Go'].includes(framework);
  const databaseSignals = unique(files.flatMap((file) => {
    const text = `${file.path}\n${file.content ?? ''}`.toLowerCase();
    const found = [];
    if (/postgres|neon|pg\b/.test(text)) found.push('PostgreSQL / Neon');
    if (/supabase/.test(text)) found.push('Supabase');
    if (/sqlite/.test(text)) found.push('SQLite');
    if (/mongodb|mongoose/.test(text)) found.push('MongoDB');
    if (/replit[_ -]?(db|database)|@replit\/database/.test(text)) found.push('Replit Database');
    if (/replit[_ -]?object[_ -]?storage|google-cloud\/storage/.test(text)) found.push('Object storage');
    return found;
  }));

  const findings = [];
  const add = (severity, title, detail, action) => findings.push({ severity, title, detail, action });

  if (!pkg && framework === 'Unknown') {
    add('high', 'Runtime could not be identified', 'No recognized package or runtime manifest was found.', 'Add a dependency manifest and document the runtime version.');
  }
  if (packageFile && !pkg) {
    add('high', 'package.json is invalid', 'The file could not be parsed as JSON.', 'Repair package.json before attempting deployment.');
  }
  if (replitFiles.length) {
    add('medium', 'Replit-specific configuration detected', replitFiles.map((f) => f.path).join(', '), 'Translate run/build settings into the target platform configuration.');
  }
  if (!hasBuild) {
    add('high', 'No explicit build command detected', 'A portable build step could not be confirmed.', 'Define and test a deterministic build command outside Replit.');
  }
  if (!hasStart && !['React + Vite', 'Vue + Vite', 'Astro'].includes(framework)) {
    add('high', 'No production start command detected', 'The target host may not know how to run the application.', 'Add a production start command and bind to the host-provided PORT.');
  }
  if (!hasLockfile && packageFile) {
    add('medium', 'Dependency lockfile missing', 'Fresh installs may resolve different package versions.', 'Generate and commit exactly one lockfile.');
  }
  if (!hasGitignore) {
    add('medium', '.gitignore missing', 'Secrets, generated files, or local dependencies may be committed accidentally.', 'Add a framework-appropriate .gitignore before pushing to Git.');
  }
  if (secretFiles.length) {
    add('high', 'Potential secret files included', `${secretFiles.length} sensitive-looking file(s) were found. Values were not displayed.`, 'Remove secret files from the project archive and rotate any exposed credentials.');
  }
  if (missingKeys.length) {
    add('medium', 'Environment variables require migration', `${missingKeys.length} referenced key(s): ${missingKeys.join(', ')}`, 'Create these variables in the target host; never commit their values.');
  }
  if (databaseSignals.length) {
    add('medium', 'Stateful services detected', databaseSignals.join(', '), 'Export and restore data separately; a source-code ZIP does not include managed database contents.');
  }
  if (!hasDocker && ['Unknown', 'Node.js', 'Node.js + Express', 'Python', 'Django', 'Ruby', 'Rust', 'Go'].includes(framework)) {
    add('low', 'No container definition', 'A Dockerfile is optional but can make runtime behavior reproducible.', 'Consider generating a minimal Dockerfile after the local build succeeds.');
  }

  const penalty = findings.reduce((sum, item) => sum + ({ high: 18, medium: 9, low: 3 }[item.severity]), 0);
  const score = Math.max(0, Math.min(100, 100 - penalty));

  return {
    score,
    framework,
    fileCount: files.length,
    targets: detectTargets(framework, files),
    databaseSignals,
    envKeyCount: unique([...definedKeys, ...referencedKeys]).length,
    findings,
    summary: score >= 80 ? 'Low-friction migration likely' : score >= 55 ? 'Migration needs preparation' : 'High migration risk',
  };
}

export function reportAsMarkdown(result) {
  const lines = [
    '# Migration readiness report',
    '',
    `- Score: ${result.score}/100 — ${result.summary}`,
    `- Detected stack: ${result.framework}`,
    `- Files inspected locally: ${result.fileCount}`,
    `- Suggested targets: ${result.targets.join(', ')}`,
    `- Environment keys detected: ${result.envKeyCount}`,
    '',
    '## Findings',
    '',
  ];
  if (!result.findings.length) lines.push('No obvious portability blockers were detected. A real deployment test is still required.');
  for (const item of result.findings) {
    lines.push(`### [${item.severity.toUpperCase()}] ${item.title}`, '', item.detail, '', `**Action:** ${item.action}`, '');
  }
  lines.push('## Safety note', '', 'This static audit does not deploy, modify, or upload the project. Never share secret values in a support request.');
  return lines.join('\n');
}
