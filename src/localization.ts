import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as vscode from "vscode";

export function extensionStrings(context: vscode.ExtensionContext): Record<string, string> {
    const turkish = (vscode.env?.language ?? "en").toLowerCase().startsWith("tr");
    return JSON.parse(readFileSync(join(context.extensionPath, turkish ? "package.nls.tr.json" : "package.nls.json"), "utf8"));
}
