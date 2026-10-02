import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeProject, reportAsMarkdown } from './analyzer.js';

test('recognizes a portable Vite app', () => {
  const result = analyzeProject([
    { path: 'app/package.json', content: JSON.stringify({ scripts: { build: 'vite build', start: 'vite preview' }, dependencies: { react: '1', vite: '1' } }) },
    { path: 'app/package-lock.json', content: '{}' },
    { path: 'app/.gitignore', content: '.env\nnode_modules' },
    { path: 'app/src/main.js', content: 'console.log(process.env.PUBLIC_URL)' },
  ]);
  assert.equal(result.framework, 'React + Vite');
  assert.ok(result.targets.includes('Vercel'));
  assert.ok(result.score >= 80);
});

test('flags secrets, Replit config, state, and missing commands', () => {
  const result = analyzeProject([
    { path: 'package.json', content: JSON.stringify({ dependencies: { express: '1', '@replit/database': '1' } }) },
    { path: '.replit', content: 'run = "node index.js"' },
    { path: '.env', content: 'DATABASE_URL=secret' },
    { path: 'index.js', content: 'const key = process.env.STRIPE_KEY' },
  ]);
  assert.equal(result.framework, 'Node.js + Express');
  assert.ok(result.score < 55);
  assert.ok(result.findings.some((item) => item.title.includes('secret')));
  assert.ok(result.findings.some((item) => item.title.includes('Stateful')));
  assert.match(reportAsMarkdown(result), /Migration readiness report/);
  assert.doesNotMatch(reportAsMarkdown(result), /DATABASE_URL=secret/);
});
