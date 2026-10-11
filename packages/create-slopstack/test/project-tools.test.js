import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  buildDeployCommand,
  buildExportCommand,
  isExpectedBuildxVersion,
} from '../../../scripts/deploy.js';
import {
  loadProjectConfig,
  parseConfigYaml,
  validateProjectConfig,
} from '../../../scripts/project-config.js';
import { applyReleasePlan, planRelease } from '../../../scripts/release.js';

const validConfig = `schemaVersion: 1
app:
  name: sample-app
  goModule: github.com/acme/sample-app
  envPrefix: SAMPLE_APP
runtime:
  port: 8090
  storagePath: pb_data
development:
  webPort: 5173
  apiProxyTarget: http://127.0.0.1:8090
tools:
  go: 1.27.1
  node: 22.23.2
  pnpm: 11.8.0
  air: 1.67.4
  dockerBuildx: 0.30.0
image:
  repository: ghcr.io/acme/sample-app
  tag: latest
  platforms: linux/amd64,linux/arm64
registry:
  host: ghcr.io
release:
  version: 0.1.0
`;

test('project config parses documented nested YAML and ignores comments', () => {
  const config = validateProjectConfig(parseConfigYaml(`${validConfig}# end\n`));
  assert.equal(config.app.name, 'sample-app');
  assert.equal(config.runtime.port, 8090);
  assert.equal(config.image.platforms, 'linux/amd64,linux/arm64');
});

test('project config rejects credentials, duplicate keys, and wrong deployment platforms', () => {
  assert.throws(
    () =>
      validateProjectConfig(
        parseConfigYaml(
          validConfig.replace('host: ghcr.io', 'host: ghcr.io\n  password: top-secret'),
        ),
      ),
    /must not store credentials/,
  );
  assert.throws(
    () => parseConfigYaml(validConfig.replace('port: 8090', 'port: 8090\n  port: 8080')),
    /duplicate key/,
  );
  assert.throws(
    () =>
      validateProjectConfig(
        parseConfigYaml(validConfig.replace('linux/amd64,linux/arm64', 'linux/amd64')),
      ),
    /image.platforms/,
  );
});

test('deploy plans a Buildx multi-platform push and never runs it by default', () => {
  const config = validateProjectConfig(parseConfigYaml(validConfig));
  assert.deepEqual(buildDeployCommand(config), {
    command: 'docker',
    args: [
      'buildx',
      'build',
      '--platform',
      'linux/amd64,linux/arm64',
      '--tag',
      'ghcr.io/acme/sample-app:latest',
      '--push',
      '.',
    ],
  });
});

test('deploy supports OCI export and checks the configured Buildx version exactly', () => {
  const config = validateProjectConfig(parseConfigYaml(validConfig));
  assert.deepEqual(buildExportCommand(config, '/tmp/sample.oci.tar'), {
    command: 'docker',
    args: [
      'buildx',
      'build',
      '--platform',
      'linux/amd64,linux/arm64',
      '--tag',
      'ghcr.io/acme/sample-app:latest',
      '--output',
      'type=oci,dest=/tmp/sample.oci.tar',
      '.',
    ],
  });
  assert.throws(() => buildExportCommand(config, ''), /non-empty path/);
  assert.equal(isExpectedBuildxVersion('github.com/docker/buildx v0.30.0 abcdef', '0.30.0'), true);
  assert.equal(isExpectedBuildxVersion('github.com/docker/buildx v0.31.0 abcdef', '0.30.0'), false);
});

test('release dry plan is read-only and explicit apply updates only version and image tag', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'slopstack-release-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const configPath = path.join(directory, 'slopstack.yaml');
  await fs.writeFile(configPath, validConfig);

  const plan = await planRelease(directory, '1.2.3');
  assert.equal(await fs.readFile(configPath, 'utf8'), validConfig);
  await applyReleasePlan(plan);
  const { config } = await loadProjectConfig(directory);
  assert.equal(config.release.version, '1.2.3');
  assert.equal(config.image.tag, '1.2.3');
  assert.equal(config.app.name, 'sample-app');
});

test('packaged template has deploy and release entrypoints with per-app identity', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'slopstack-config-template-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const { createProject } = await import('../lib/create.js');
  await createProject('sample-app', path.join(directory, 'project'));
  const project = path.join(directory, 'project');
  const { config } = await loadProjectConfig(project);
  assert.equal(config.app.name, 'sample-app');
  assert.equal(config.app.envPrefix, 'SAMPLE_APP');
  assert.equal(config.image.repository, 'ghcr.io/your-org/sample-app');
  const manifest = JSON.parse(await fs.readFile(path.join(project, 'package.json'), 'utf8'));
  assert.equal(manifest.scripts.deploy, 'node scripts/deploy.js');
  assert.equal(manifest.scripts.release, 'node scripts/release.js');
  await fs.access(path.join(project, 'scripts/deploy.js'));
  assert.equal(
    await fs.readFile(path.join(project, 'scripts/deploy.js'), 'utf8'),
    await fs.readFile(new URL('../../../scripts/deploy.js', import.meta.url), 'utf8'),
  );
  await fs.access(path.join(project, 'scripts/release.js'));
  await fs.access(path.join(project, 'go/config/env.go'));
  await fs.access(path.join(project, 'go/auth/auth.go'));
  await fs.access(path.join(project, 'go/authorization/authorization.go'));
  const appConfig = await fs.readFile(
    path.join(project, 'apps/server/internal/app/config.go'),
    'utf8',
  );
  const appAuth = await fs.readFile(path.join(project, 'apps/server/internal/app/auth.go'), 'utf8');
  const appAuthorization = await fs.readFile(
    path.join(project, 'apps/server/internal/app/authorization.go'),
    'utf8',
  );
  assert.match(appConfig, /go\/config/);
  assert.match(appAuth, /go\/auth/);
  assert.match(appAuthorization, /go\/authorization/);
});
