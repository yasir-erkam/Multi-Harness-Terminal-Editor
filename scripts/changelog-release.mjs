#!/usr/bin/env node
// Extract the CHANGELOG section for a release tag: node changelog-release.mjs <tag> <outfile>
// Exit 0 on extraction; exit 2 when no matching section (CI falls back).
import { readFileSync, writeFileSync } from "node:fs";

const [tag, outfile] = process.argv.slice(2);
if (!tag || !outfile) {
    console.error("usage: node scripts/changelog-release.mjs <tag> <outfile>");
    process.exit(2);
}

const version = tag.replace(/^v/, "");
let changelog;
try {
    changelog = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");
} catch {
    console.error("changelog-release: CHANGELOG.md not readable");
    process.exit(2);
}

const sections = changelog.split(/^## /m).slice(1); // drop the preamble before the first "## "
const section = sections.find((block) => block.split(/\r?\n/, 1)[0].trim() === version);
if (!section) {
    console.error(`changelog-release: no section for ${version}`);
    process.exit(2);
}

const body = `## ${section
    .split(/\r?\n/)
    .filter((line, index, lines) => !(/^\s*$/.test(line) && index === lines.length - 1))
    .join("\n")
    .trimEnd()}\n`;
writeFileSync(outfile, body);
