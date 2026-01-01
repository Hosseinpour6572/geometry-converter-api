import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export class Ogr2OgrConverter {
  async convert({
    inputPath,
    outputPath,
    targetFormat,
    sourceSrs,
    targetSrs,
    timeoutMs = 60000,
  }) {
    const args = ["-f", targetFormat, outputPath, inputPath];

    if (sourceSrs) {
      args.push("-s_srs", sourceSrs);
    }

    if (targetSrs) {
      args.push("-t_srs", targetSrs);
    }

    await execFileAsync("ogr2ogr", args, { timeout: timeoutMs });

    // Ensure the output exists before returning.
    await fs.access(outputPath);

    return outputPath;
  }
}
