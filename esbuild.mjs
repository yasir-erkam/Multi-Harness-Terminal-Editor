import * as esbuild from "esbuild";

await esbuild.build({
    entryPoints: ["src/extension.ts"],
    outfile: "dist/extension.js",
    bundle: true,
    format: "cjs",
    platform: "node",
    target: "node16",
    minify: true,
    sourcemap: true,
    external: ["vscode"],
});
