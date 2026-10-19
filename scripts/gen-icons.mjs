// Rebuild the themed button icons offline from the attributed, vendored sources.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const media = join(dirname(fileURLToPath(import.meta.url)), "..", "media");
const sources = JSON.parse(readFileSync(join(media, "sources", "icons.json"), "utf8"));
const checkOnly = process.argv.includes("--check");

for (const [id, source] of Object.entries(sources)) {
    for (const [theme, color] of [["light", "#374151"], ["dark", "#c8c8c8"]]) {
        const original = readFileSync(join(media, "sources", source.file));
        let body;
        if (source.file.endsWith(".png")) {
            body = `<image width="16" height="16" href="data:image/png;base64,${original.toString("base64")}"/>`;
        } else {
            const svg = original.toString("utf8").replace(/\r\n/g, "\n");
            const root = svg.match(/<svg\b([^>]*)>([\s\S]*)<\/svg>/);
            if (!root) {
                throw new Error(`Invalid source SVG: ${source.file}`);
            }
            const viewBox = source.viewBox ?? root[1].match(/viewBox="([^"]+)"/)?.[1];
            if (!viewBox) {
                throw new Error(`Missing source viewBox: ${source.file}`);
            }
            // Preserve root fill rules, masks and nested transforms from the source.
            const attributes = root[1].replace(/\s+(?:width|height|viewBox|style)="[^"]*"/g, "");
            body = `<svg${attributes} width="16" height="16" viewBox="${viewBox}">${root[2]}</svg>`;
            for (const ink of source.themeColors ?? []) {
                body = body.replaceAll(ink, color);
            }
            if (source.secondaryColors) {
                for (const ink of source.secondaryColors) {
                    body = body.replaceAll(ink, theme === "light" ? "#d1cccc" : "#4b4646");
                }
            }
        }
        const icon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><g fill="${color}">${body}</g></svg>\n`.replace(/[ \t]+$/gm, "");
        const output = join(media, `${id}-${theme}.svg`);
        if (checkOnly) {
            if (readFileSync(output, "utf8").replace(/\r\n/g, "\n") !== icon) {
                throw new Error(`Stale icon: ${output}. Run node scripts/gen-icons.mjs.`);
            }
        } else {
            writeFileSync(output, icon);
        }
    }
}
console.log(`${checkOnly ? "Verified" : "Generated"} ${Object.keys(sources).length * 2} harness icons.`);
