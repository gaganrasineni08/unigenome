// Local server: the API, plus the built web app in production.
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { app } from "./app";

const root = new Hono();
root.route("/", app);
if (process.env.NODE_ENV === "production") {
  root.use("/*", serveStatic({ root: "./dist" }));
  root.get("*", serveStatic({ path: "./dist/index.html" }));
}
const port = Number(process.env.PORT ?? 8787);
serve({ fetch: root.fetch, port }, () => console.log(`UniGenome API on http://localhost:${port}`));
