"use strict";

// cmd.exe and npm's %* shims each add a command-line parsing layer.
function cmdArgument(value, doubleEscape) {
    let escaped = String(value).replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, "$1$1");
    escaped = `"${escaped}"`.replace(/([()\][%!^"`<>&|;, *?])/g, "^$1");
    return doubleEscape ? escaped.replace(/([()\][%!^"`<>&|;, *?])/g, "^$1") : escaped;
}

function buildWindowsBatchCommand(executable, args) {
    const doubleEscape = /[\\/]node_modules[\\/]\.bin[\\/]/i.test(executable);
    const command = executable.replace(/([()\][%!^"`<>&|;, *?])/g, "^$1");
    return [command, ...args.map((arg) => cmdArgument(arg, doubleEscape))].join(" ");
}

module.exports = { buildWindowsBatchCommand };
