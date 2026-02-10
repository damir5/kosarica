import http from "node:http";
import { createReadStream } from "node:fs";
import { access, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

import app from "../dist/server/server.js";

const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const host = process.env.HOST ?? "0.0.0.0";
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const distClientDir = path.resolve(scriptDir, "../dist/client");

const MIME_TYPES = {
	".css": "text/css; charset=utf-8",
	".gif": "image/gif",
	".ico": "image/x-icon",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".js": "text/javascript; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".map": "application/json; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".png": "image/png",
	".svg": "image/svg+xml",
	".txt": "text/plain; charset=utf-8",
	".webp": "image/webp",
	".woff": "font/woff",
	".woff2": "font/woff2",
};

function isBodyAllowed(method) {
	return !["GET", "HEAD"].includes(method.toUpperCase());
}

function getStaticHeaders(filePath, pathname) {
	const ext = path.extname(filePath).toLowerCase();
	const contentType = MIME_TYPES[ext] ?? "application/octet-stream";
	const isFingerprintAsset = pathname.startsWith("/assets/");

	return {
		"content-type": contentType,
		"cache-control": isFingerprintAsset
			? "public, max-age=31536000, immutable"
			: "public, max-age=3600",
	};
}

async function resolveStaticFile(pathname) {
	if (!pathname || pathname === "/") {
		return null;
	}

	// Only treat extension-based paths or known static prefixes as filesystem assets.
	const isStaticPrefix =
		pathname.startsWith("/assets/") || pathname.startsWith("/fonts/");
	const hasExtension = path.extname(pathname).length > 0;
	if (!isStaticPrefix && !hasExtension) {
		return null;
	}

	const decodedPath = decodeURIComponent(pathname);
	const relativePath = decodedPath.replace(/^\/+/, "");
	const candidatePath = path.resolve(distClientDir, relativePath);

	if (
		candidatePath !== distClientDir &&
		!candidatePath.startsWith(`${distClientDir}${path.sep}`)
	) {
		return null;
	}

	try {
		await access(candidatePath);
		const stats = await stat(candidatePath);
		if (!stats.isFile()) {
			return null;
		}
		return candidatePath;
	} catch {
		return null;
	}
}

async function serveStaticIfPresent(req, res) {
	const method = (req.method ?? "GET").toUpperCase();
	if (!["GET", "HEAD"].includes(method)) {
		return false;
	}

	const requestUrl = new URL(req.url ?? "/", `http://localhost:${port}`);
	const pathname = requestUrl.pathname;
	const staticFile = await resolveStaticFile(pathname);

	if (!staticFile) {
		return false;
	}

	const headers = getStaticHeaders(staticFile, pathname);
	Object.entries(headers).forEach(([key, value]) => {
		res.setHeader(key, value);
	});
	res.statusCode = 200;

	if (method === "HEAD") {
		res.end();
		return true;
	}

	createReadStream(staticFile).pipe(res);
	return true;
}

function getRequestUrl(req) {
	const forwardedProto = req.headers["x-forwarded-proto"];
	const protocol = Array.isArray(forwardedProto)
		? forwardedProto[0]
		: (forwardedProto?.split(",")[0] ?? "http");
	const hostHeader = req.headers.host ?? `localhost:${port}`;
	const path = req.url ?? "/";
	return `${protocol}://${hostHeader}${path}`;
}

function copyResponseHeaders(response, res) {
	response.headers.forEach((value, key) => {
		res.setHeader(key, value);
	});
}

const server = http.createServer(async (req, res) => {
	try {
		if (await serveStaticIfPresent(req, res)) {
			return;
		}

		const method = req.method ?? "GET";
		const requestInit = {
			method,
			headers: req.headers,
		};

		if (isBodyAllowed(method)) {
			requestInit.body = Readable.toWeb(req);
			requestInit.duplex = "half";
		}

		const request = new Request(getRequestUrl(req), requestInit);
		const response = await app.fetch(request);

		res.statusCode = response.status;
		copyResponseHeaders(response, res);

		if (!response.body || method.toUpperCase() === "HEAD") {
			res.end();
			return;
		}

		Readable.fromWeb(response.body).pipe(res);
	} catch (error) {
		console.error("Failed to handle request", error);
		res.statusCode = 500;
		res.setHeader("content-type", "text/plain; charset=utf-8");
		res.end("Internal Server Error");
	}
});

server.listen(port, host, () => {
	console.log(`Server listening on http://${host}:${port}`);
});
