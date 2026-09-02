import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

const nodeMajor = Number(process.versions.node.split(".")[0]);
if (!Number.isInteger(nodeMajor) || nodeMajor < 24) {
  throw new Error(`Parallel Thinking Suite requires Node.js 24+, received ${process.version}`);
}

const pluginRoot = join(import.meta.dirname, "..");
const skillsRoot = join(pluginRoot, "skills");
const skillNames = readdirSync(skillsRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

if (skillNames.length === 0) throw new Error("No Skill packages found");

for (const directoryName of skillNames) {
  const skillRoot = join(skillsRoot, directoryName);
  const skillPath = join(skillRoot, "SKILL.md");
  if (!existsSync(skillPath)) throw new Error(`${directoryName}: missing SKILL.md`);
  const content = readFileSync(skillPath, "utf8");
  const frontmatter = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (!frontmatter) throw new Error(`${directoryName}: missing fenced YAML frontmatter`);
  const metadata = parseYaml(frontmatter[1]);
  if (metadata.name !== directoryName) throw new Error(`${directoryName}: frontmatter name must match directory`);
  if (typeof metadata.description !== "string" || metadata.description.trim().length < 20) {
    throw new Error(`${directoryName}: description must explain capability and trigger`);
  }
  if (/\[TODO|TODO:/.test(content)) throw new Error(`${directoryName}: unfinished scaffold placeholder`);

  const interfacePath = join(skillRoot, "agents", "openai.yaml");
  if (!existsSync(interfacePath)) continue;
  const interfaceConfig = parseYaml(readFileSync(interfacePath, "utf8"));
  const ui = interfaceConfig.interface;
  if (!ui || typeof ui.display_name !== "string" || !ui.display_name.trim()) {
    throw new Error(`${directoryName}: agents/openai.yaml needs interface.display_name`);
  }
  if (typeof ui.short_description !== "string" || ui.short_description.trim().length < 8 || ui.short_description.length > 64) {
    throw new Error(`${directoryName}: short_description must be concise and non-empty`);
  }
  if (typeof ui.default_prompt !== "string" || !ui.default_prompt.includes(`$${directoryName}`)) {
    throw new Error(`${directoryName}: default_prompt must mention $${directoryName}`);
  }
}

process.stdout.write(`Validated ${skillNames.length} Skill packages on ${process.version}\n`);
