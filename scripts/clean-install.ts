import { writeReport } from './reports.js';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { IndexerError } from '../src/model.js';

const stage = mkdtempSync(join(tmpdir(), 'blaze-clean-'));
const started = new Date().toISOString();
try {
  for (const path of ['package.json', 'package-lock.json', 'tsconfig.json', 'src', 'scripts', 'test']) cpSync(path, join(stage, path), { recursive: true });
  // Build needs TypeScript only; no dependency install scripts are necessary or executed.
  execFileSync('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: stage, stdio: 'inherit' });
  execFileSync('npm', ['run', 'build'], { cwd: stage, stdio: 'inherit' });
  execFileSync('npm', ['prune', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: stage, stdio: 'inherit' });
  const version = z.object({ version: z.string() }).parse(JSON.parse(readFileSync('package.json', 'utf8'))).version;
  const name = `blaze-indexer-${version}-${Date.now()}.tgz`;
  mkdirSync('.build/artifacts', { recursive: true });
  for (const path of ['README.md', '.env.example', 'Dockerfile', 'compose.yaml']) cpSync(path, join(stage, path));
  mkdirSync(join(stage, 'docs'));
  for (const name of ['authchain-api-v1.md', 'authchain-api-v1.schema.json', 'storage-v4.md',
    'bcmr-schema-provenance.md', 'activity-api-v1.md', 'activity-api-v1.schema.json', 'testnet-operations.md', 'explorer-minimum-backend-analysis.md', 'storage-and-extraction-plan.md']) {
    cpSync(join('docs', name), join(stage, 'docs', name));
  }
  cpSync('Dockerfile.runtime', join(stage, 'Dockerfile'));
  const artifact = resolve('.build/artifacts', name);
  execFileSync('tar', ['-czf', artifact, '-C', stage, 'package.json', 'package-lock.json', 'dist/src', 'dist/scripts',
    'README.md', '.env.example', 'Dockerfile', 'compose.yaml', 'docs']);
  const installed = mkdtempSync(join(tmpdir(), 'blaze-artifact-'));
  try {
    // Exercise the actual packaged runtime without source files, dev dependencies or rebuilding.
    execFileSync('tar', ['-xzf', artifact, '-C', installed]);
    execFileSync('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: installed, stdio: 'inherit' });
    if (existsSync(join(installed, 'node_modules/tsx')) || existsSync(join(installed, 'node_modules/typescript'))) {
      throw new IndexerError({ message: 'Artifact verification must not have TypeScript or tsx installed' });
    }
    // Test support is external to the package; runtime imports and child entrypoints use extracted dist/src.
    cpSync(join(stage, 'dist/test'), join(installed, 'dist/test'), { recursive: true });
    mkdirSync(join(installed, 'dist/docs'));
    for (const name of ['activity-api-v1.schema.json', 'authchain-api-v1.schema.json']) cpSync(join(installed, 'docs', name), join(installed, 'dist/docs', name));
    execFileSync(process.execPath, ['--test', 'dist/test/main.test.js', 'dist/test/test-broadcast.test.js', 'dist/test/rpc-proxy.test.js',
      'dist/test/archive-readiness.test.js', 'dist/test/identities.test.js', 'dist/test/activity.test.js', 'dist/test/authchain-resolution.test.js'],
    { cwd: installed, env: { ...process.env, BLAZE_TEST_BUILT: 'true' }, stdio: 'inherit' });
  } finally { rmSync(installed, { recursive: true, force: true }); }
  const sourceHash = createHash('sha256');
  for (const name of readdirSync('src').filter(name => /\.(ts|json)$/.test(name)).sort()) sourceHash.update(name).update(readFileSync(join('src', name)));
  const report = { status: 'passed', runtime_source_sha256: sourceHash.digest('hex'), started_at: started, finished_at: new Date().toISOString(), node: process.version,
    commands: ['npm ci --ignore-scripts', 'npm run build', 'npm prune --omit=dev --ignore-scripts', 'tar: create local artifact, extract into a second new directory', 'npm ci --omit=dev --ignore-scripts (extracted artifact)', 'BLAZE_TEST_BUILT=true node --test dist/test/main.test.js dist/test/test-broadcast.test.js dist/test/rpc-proxy.test.js dist/test/archive-readiness.test.js dist/test/identities.test.js dist/test/activity.test.js dist/test/authchain-resolution.test.js'],
    artifact_extracted_and_installed: true, artifact_rebuilt_after_extraction: false, external_compiled_test_support_injected: true,
    dependency_install_scripts_executed: false, production_dependencies_only: true, compiled_lifecycle_profiles: 7, compiled_contract_gateway_tests: 12,
    artifact, sha256: createHash('sha256').update(readFileSync(artifact)).digest('hex'),
    lock_sha256: createHash('sha256').update(readFileSync('package-lock.json')).digest('hex'),
    docker_runtime_verified: false, chipnet_verified: false, testnetFunctionalReady: false, publicReleaseReady: false };
  mkdirSync('.build/reports', { recursive: true });
  writeReport('clean-install', report);
  console.log(JSON.stringify(report));
} finally { rmSync(stage, { recursive: true, force: true }); }
