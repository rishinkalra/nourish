import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderDigitalOceanStagingSpec } from "./digitalocean-preflight.mjs";

try {
  const backendDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const workspaceDirectory = resolve(backendDirectory, "..");
  const options = argumentsFrom(process.argv.slice(2));
  const templatePath = resolve(options.template ?? resolve(workspaceDirectory, ".do/app.staging.yaml"));
  const template = await readFile(templatePath, "utf8");
  const result = renderDigitalOceanStagingSpec({ template });
  let renderedSpecWrittenOutsideWorkspace = false;

  if (options.output) {
    const outputPath = resolve(options.output);
    if (outputPath === workspaceDirectory || outputPath.startsWith(`${workspaceDirectory}/`)) {
      throw new Error("Refusing to write a rendered secret-bearing app spec inside the project workspace.");
    }
    await writeFile(outputPath, result.rendered, { encoding: "utf8", mode: 0o600, flag: "wx" });
    renderedSpecWrittenOutsideWorkspace = true;
  }

  process.stdout.write(`${JSON.stringify({ ...result.summary, renderedSpecWrittenOutsideWorkspace })}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    status: "error",
    code: error?.code ?? "DIGITALOCEAN_PREFLIGHT_ERROR",
    issues: error?.issues ?? [error?.message ?? "DigitalOcean staging preflight failed"],
  })}\n`);
  process.exitCode = 1;
}

function argumentsFrom(argumentsList) {
  const options = {};
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (!["--template", "--output"].includes(argument)) throw new Error(`Unsupported argument ${argument}`);
    const value = argumentsList[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value`);
    options[argument.slice(2)] = value;
    index += 1;
  }
  return options;
}
