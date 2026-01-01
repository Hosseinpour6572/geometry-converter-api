import assert from "node:assert/strict";
import { createServer } from "node:http";
import { afterEach, describe, it } from "node:test";
import { once } from "node:events";
import { createApp } from "../src/app.js";

const startServer = async (app) => {
  const server = createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  return { server, baseUrl: `http://127.0.0.1:${port}` };
};

describe("Geometry Converter API", () => {
  /** @type {import('node:http').Server | null} */
  let server = null;
  let baseUrl = "";

  afterEach(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
      server = null;
    }
  });

  it("returns health status", async () => {
    const app = createApp({ converter: { convert: async () => {} } });
    ({ server, baseUrl } = await startServer(app));

    const response = await fetch(`${baseUrl}/health`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body, { status: "ok" });
  });

  it("validates required fields", async () => {
    const app = createApp({ converter: { convert: async () => {} } });
    ({ server, baseUrl } = await startServer(app));

    // Missing targetFormat
    const missingFormat = await fetch(`${baseUrl}/convert`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileBase64: "YQ==" }),
    });
    const missingFormatBody = await missingFormat.json();
    assert.equal(missingFormat.status, 400);
    assert.match(missingFormatBody.error, /Target format/);

    // Missing fileBase64
    const missingFile = await fetch(`${baseUrl}/convert`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetFormat: "DXF" }),
    });
    const missingFileBody = await missingFile.json();
    assert.equal(missingFile.status, 400);
    assert.match(missingFileBody.error, /fileBase64/);

    // Unsupported content type
    const unsupported = await fetch(`${baseUrl}/convert`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "plain text",
    });
    const unsupportedBody = await unsupported.json();
    assert.equal(unsupported.status, 415);
    assert.match(unsupportedBody.error, /Unsupported content type/);
  });

  it("converts and streams the output", async () => {
    const outputMarker = "converted-data";
    const app = createApp({
      converter: {
        convert: async ({ inputPath, outputPath }) => {
          const fs = await import("node:fs/promises");
          const input = await fs.readFile(inputPath, "utf8");
          await fs.writeFile(outputPath, `${input}-${outputMarker}`);
          return outputPath;
        },
      },
    });

    ({ server, baseUrl } = await startServer(app));

    const payload = {
      fileBase64: Buffer.from("LINESTRING (0 0, 1 1)", "utf8").toString("base64"),
      targetFormat: "GeoJSON",
      fileName: "input.geojson",
    };

    const response = await fetch(`${baseUrl}/convert`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const bodyBuffer = Buffer.from(await response.arrayBuffer());
    const disposition = response.headers.get("content-disposition") ?? "";

    assert.equal(response.status, 200);
    assert.match(disposition, /converted-input\.geojson/);
    assert.equal(bodyBuffer.toString("utf8"), "LINESTRING (0 0, 1 1)-converted-data");
  });
});
