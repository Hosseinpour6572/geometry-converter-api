import { createServer } from "node:http";
import { createApp } from "./app.js";

const port = Number.parseInt(process.env.PORT ?? "5000", 10);
const app = createApp();
const server = createServer(app);

server.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Geometry Converter API listening on port ${port}`);
});
