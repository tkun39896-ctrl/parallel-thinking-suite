import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function findPluginRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [resolve(here, "../.."), resolve(here, ".."), process.cwd()];
  const found = candidates.find((candidate) => existsSync(join(candidate, "templates", "global")));
  if (!found) throw new Error("无法定位并行思考插件根目录");
  return found;
}

export const pluginRoot = findPluginRoot();

export function globalHome(): string {
  const configured = process.env.PARALLEL_THINK_HOME?.trim();
  return resolve(configured || join(homedir(), ".parallel-think"));
}

export function ensureGlobalHome(): string {
  const root = globalHome();
  mkdirSync(root, { recursive: true });
  copyMissingTree(join(pluginRoot, "templates", "global"), root);
  for (const relative of [
    "agents",
    "knowledge/shared",
    "parsers",
    "revisions/agents",
  ]) {
    mkdirSync(join(root, relative), { recursive: true });
  }
  return root;
}

export interface ProjectPaths {
  root: string;
  state: string;
  runs: string;
  cache: string;
  parserAudit: string;
  config: string;
}

export function ensureProject(projectRoot = process.cwd()): ProjectPaths {
  const root = resolve(projectRoot);
  const state = join(root, ".parallel-think");
  const paths: ProjectPaths = {
    root,
    state,
    runs: join(state, "runs"),
    cache: join(state, "parsed-cache"),
    parserAudit: join(state, "parser-audit"),
    config: join(state, "project.yaml"),
  };
  for (const path of [paths.state, paths.runs, paths.cache, paths.parserAudit]) {
    mkdirSync(path, { recursive: true });
  }
  if (!existsSync(paths.config)) {
    copyFileSync(join(pluginRoot, "templates", "project", "project.yaml"), paths.config);
  }
  return paths;
}

function copyMissingTree(source: string, destination: string): void {
  if (statSync(source).isDirectory()) {
    mkdirSync(destination, { recursive: true });
    for (const entry of readdirSync(source)) {
      copyMissingTree(join(source, entry), join(destination, entry));
    }
    return;
  }
  if (!existsSync(destination)) copyFileSync(source, destination);
}

export function assertInside(parent: string, candidate: string): string {
  const root = resolve(parent);
  const target = resolve(candidate);
  const prefix = root.endsWith("\\") || root.endsWith("/") ? root : root + "\\";
  if (target !== root && !target.toLowerCase().startsWith(prefix.toLowerCase())) {
    throw new Error(`路径越界：${candidate}`);
  }
  return target;
}
