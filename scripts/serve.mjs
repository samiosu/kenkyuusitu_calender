import { createServer } from "node:http";
import { readFile, realpath, stat } from "node:fs/promises";
import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = await realpath(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
const port = Number(process.env.PORT ?? 4173);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORTには1〜65535の整数を指定してください。");
}

const exactPaths = new Set([
  "index.html",
  "styles.css",
  "app.js",
  "icon.svg",
  "examples/schedule.sample.json",
]);
const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function reply(request, response, status, body, type = "text/plain; charset=utf-8") {
  response.writeHead(status, {
    "Content-Type": type,
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  });
  response.end(request.method === "HEAD" ? undefined : body);
}

function publicPath(requestUrl) {
  // Check the original decoded path before URL normalization can hide traversal.
  const pathname = decodeURIComponent((requestUrl ?? "/").split(/[?#]/, 1)[0]);
  if (!pathname.startsWith("/") || pathname.includes("\\") || pathname.includes("\0")) {
    return null;
  }
  const segments = pathname.slice(1).split("/");
  if (segments.some((segment) => segment.startsWith("."))) return null;

  const path = pathname === "/" ? "index.html" : pathname.slice(1);
  return exactPaths.has(path) || /^src\/[A-Za-z0-9][A-Za-z0-9._-]*\.mjs$/.test(path)
    ? path
    : null;
}

const server = createServer(async (request, response) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.setHeader("Allow", "GET, HEAD");
    reply(request, response, 405, "Method not allowed\n");
    return;
  }

  try {
    const path = publicPath(request.url);
    if (!path) {
      reply(request, response, 404, "Not found\n");
      return;
    }

    const resolved = await realpath(resolve(root, path));
    const fromRoot = relative(root, resolved);
    if (!fromRoot || isAbsolute(fromRoot) || fromRoot === ".." || fromRoot.startsWith(`..${sep}`)) {
      reply(request, response, 404, "Not found\n");
      return;
    }
    if (!(await stat(resolved)).isFile()) {
      reply(request, response, 404, "Not found\n");
      return;
    }

    const content = await readFile(resolved);
    reply(request, response, 200, content, mimeTypes[extname(path)]);
  } catch (error) {
    if (error instanceof URIError) {
      reply(request, response, 400, "Bad request\n");
      return;
    }
    if (error.code !== "ENOENT" && error.code !== "ENOTDIR") {
      console.error("Failed to serve a public file:", error.message);
    }
    reply(request, response, 404, "Not found\n");
  }
});

server.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Local preview: http://127.0.0.1:${port}`);
});
