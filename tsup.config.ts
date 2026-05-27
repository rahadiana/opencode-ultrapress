import { defineConfig } from "tsup"
import { readFileSync } from "fs"

const pkg = JSON.parse(readFileSync("./package.json", "utf-8"))

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2022",
  outDir: "dist",
  splitting: false,
  treeshake: true,
  define: {
    __ULTRAPRESS_VERSION__: JSON.stringify(pkg.version),
  },
})
