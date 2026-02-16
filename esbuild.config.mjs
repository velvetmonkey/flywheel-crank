import esbuild from "esbuild";
import process from "process";
import { builtinModules } from "module";
import fs from "fs";
import path from "path";

const prod = process.argv[2] === "production";

// Find sql-wasm.wasm from sql.js-fts5 package
function findWasmFile() {
  const candidates = [
    "node_modules/sql.js-fts5/dist/sql-wasm.wasm",
    "node_modules/sql.js/dist/sql-wasm.wasm",
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
    ...builtinModules,
    ...builtinModules.map((m) => `node:${m}`),
  ],
  format: "cjs",
  target: "es2018",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
  minify: prod,
  define: {
    "process.env.NODE_ENV": prod ? '"production"' : '"development"',
  },
});

// Copy WASM file to plugin root
const wasmSrc = findWasmFile();
if (wasmSrc) {
  fs.copyFileSync(wasmSrc, "sql-wasm.wasm");
  console.log(`Copied ${wasmSrc} → sql-wasm.wasm`);
} else {
  console.warn("WARNING: sql-wasm.wasm not found! Plugin will fail to load database.");
}

if (prod) {
  await context.rebuild();
  process.exit(0);
} else {
  await context.watch();
}
