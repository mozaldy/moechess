import { build } from "vite";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export async function bundleBrowserEntry(source: string): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "moechess-assessment-test-"));
  try {
    const entry = path.join(directory, "entry.ts");
    await writeFile(entry, source);
    const result = await build({
      configFile: false,
      resolve: { alias: { "@": process.cwd() } },
      build: {
        write: false,
        minify: false,
        lib: { entry, formats: ["iife"], name: "AssessmentTest" },
      },
    });
    const outputs = Array.isArray(result) ? result : [result];
    const chunk = outputs
      .flatMap((output) => "output" in output ? output.output : [])
      .find((output) => output.type === "chunk");
    if (!chunk || chunk.type !== "chunk") throw new Error("Missing browser test bundle");
    return chunk.code;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
