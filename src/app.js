import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import express from "express";
import { Ogr2OgrConverter } from "./converter.js";

const uploadRoot = path.join(os.tmpdir(), "geometry-converter-uploads");
await fs.mkdir(uploadRoot, { recursive: true });

const isOctetStream = (req) => {
  const contentType = req.headers["content-type"] ?? "";
  return contentType.includes("application/octet-stream");
};

export function createApp({ converter = new Ogr2OgrConverter() } = {}) {
  const app = express();

  const maxUploadMb = Number.parseInt(process.env.MAX_UPLOAD_MB ?? "50", 10);
  const uploadLimit = `${maxUploadMb}mb`;

  app.use(express.json({ limit: uploadLimit }));

  const rawParser = express.raw({
    limit: uploadLimit,
    type: (req) => isOctetStream(req),
  });

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.post("/convert", rawParser, async (req, res, next) => {
    const cleanup = async () => {
      const removals = [];

      if (req.inputPath) {
        removals.push(fs.rm(req.inputPath, { force: true }));
      }

      if (req.outputPath) {
        removals.push(fs.rm(req.outputPath, { force: true }));
      }

      await Promise.all(removals);
    };

    res.on("finish", cleanup);
    res.on("close", cleanup);

    try {
      const isJson = req.is("application/json");
      const isBinary = isOctetStream(req);

      if (!isJson && !isBinary) {
        return res.status(415).json({
          error:
            "Unsupported content type. Use application/json (with fileBase64) or application/octet-stream (binary body).",
        });
      }

      const targetFormatSource = isJson
        ? req.body?.targetFormat
        : req.query?.targetFormat;
      const rawTargetFormat = (targetFormatSource ?? "").toString().trim();

      if (!rawTargetFormat) {
        return res
          .status(400)
          .json({ error: "Target format is required (e.g., DXF, GeoJSON)." });
      }

      const targetFormat = rawTargetFormat.toUpperCase();
      const sourceSrsValue = isJson ? req.body?.sourceSrs : req.query?.sourceSrs;
      const targetSrsValue = isJson ? req.body?.targetSrs : req.query?.targetSrs;
      const preferredNameValue = isJson ? req.body?.fileName : req.query?.fileName;

      const sourceSrs = (sourceSrsValue ?? "").toString().trim();
      const targetSrs = (targetSrsValue ?? "").toString().trim();
      const preferredName = (preferredNameValue ?? "").toString().trim();

      let fileBuffer = null;
      if (isJson) {
        const base64 = req.body?.fileBase64 ?? "";
        if (!base64) {
          return res
            .status(400)
            .json({ error: "fileBase64 is required in the JSON payload." });
        }
        try {
          fileBuffer = Buffer.from(base64, "base64");
        } catch (error) {
          return res
            .status(400)
            .json({ error: "fileBase64 must be valid base64 content." });
        }
      } else if (isOctetStream(req)) {
        if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
          return res
            .status(400)
            .json({ error: "Binary requests must include a non-empty body." });
        }
        fileBuffer = req.body;
      } else {
        return res.status(415).json({
          error:
            "Unsupported content type. Use application/json (with fileBase64) or application/octet-stream (binary body).",
        });
      }

      if (!fileBuffer || fileBuffer.length === 0) {
        return res
          .status(400)
          .json({ error: "Uploaded file content cannot be empty." });
      }

      const extension = targetFormat.toLowerCase();
      const baseName =
        preferredName.length > 0 ? path.parse(preferredName).name : "";
      const outputFileName =
        baseName.length > 0
          ? `converted-${baseName}.${extension}`
          : `converted-${crypto.randomUUID()}.${extension}`;

      const inputPath = path.join(
        uploadRoot,
        `upload-${crypto.randomUUID()}.bin`,
      );
      const outputPath = path.join(uploadRoot, outputFileName);
      req.inputPath = inputPath;
      req.outputPath = outputPath;

      await fs.writeFile(inputPath, fileBuffer);

      await converter.convert({
        inputPath,
        outputPath,
        targetFormat,
        sourceSrs,
        targetSrs,
      });

      res.download(outputPath, outputFileName, (err) => {
        if (err) {
          next(err);
        }
      });
    } catch (error) {
      next(error);
    }
  });

  app.use((error, _req, res, _next) => {
    res.status(500).json({
      error:
        error?.message ??
        "Unexpected error while converting the geospatial file.",
    });
  });

  return app;
}
