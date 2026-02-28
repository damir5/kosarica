import { createHash } from "node:crypto";
import { ResultAsync } from "neverthrow";
import yauzl from "yauzl";
import type { DiscoveredFile, ExpandedFile, FileType } from "../types";

export interface ZipError {
	readonly _tag: "ZipError";
	readonly operation: "expand";
	readonly filename: string;
	readonly message: string;
	readonly cause?: unknown;
}

function zipError(
	operation: "expand",
	filename: string,
	message: string,
	cause?: unknown,
): ZipError {
	return { _tag: "ZipError", operation, filename, message, cause };
}

export interface ExpandZipOptions {
	maxFileSize?: number;
	maxFiles?: number;
}

export function expandZip(
	content: Buffer,
	filename: string,
	parent?: DiscoveredFile,
	options?: ExpandZipOptions,
): ResultAsync<ExpandedFile[], ZipError> {
	const maxFileSize = options?.maxFileSize ?? 100 * 1024 * 1024; // 100MB default
	const maxFiles = options?.maxFiles ?? 1000;

	return ResultAsync.fromPromise(
		new Promise<ExpandedFile[]>((resolve, reject) => {
			yauzl.fromBuffer(content, { lazyEntries: true }, (err, zipfile) => {
				if (err) return reject(err);
				if (!zipfile) return reject(new Error("Failed to open ZIP file"));

				const results: ExpandedFile[] = [];
				let fileCount = 0;

				zipfile.readEntry();
				zipfile.on("entry", (entry: yauzl.Entry) => {
					// Skip directories
					if (entry.fileName.endsWith("/")) {
						zipfile.readEntry();
						return;
					}

					// Enforce limits
					if (fileCount >= maxFiles) {
						zipfile.close();
						return reject(
							new Error(`ZIP contains too many files (max: ${maxFiles})`),
						);
					}
					if (entry.uncompressedSize > maxFileSize) {
						zipfile.close();
						return reject(
							new Error(
								`File ${entry.fileName} exceeds max size (${maxFileSize} bytes)`,
							),
						);
					}

					fileCount++;

					zipfile.openReadStream(entry, (err, readStream) => {
						if (err) return reject(err);
						if (!readStream)
							return reject(
								new Error(`Failed to open stream for ${entry.fileName}`),
							);

						const chunks: Buffer[] = [];
						readStream.on("data", (chunk: Buffer) => chunks.push(chunk));
						readStream.on("end", () => {
							const buffer = Buffer.concat(chunks);
							const type = detectFileType(entry.fileName);
							const hash = computeSha256(buffer);

							results.push({
								parent: parent ?? { url: "", filename, type: "zip" },
								innerFilename: entry.fileName,
								type,
								content: buffer,
								hash,
							});

							zipfile.readEntry();
						});
						readStream.on("error", reject);
					});
				});

				zipfile.on("end", () => resolve(results));
				zipfile.on("error", reject);
			});
		}),
		(e) => zipError("expand", filename, e instanceof Error ? e.message : "Unknown error", e),
	);
}

function detectFileType(filename: string): FileType {
	const lower = filename.toLowerCase();
	if (lower.endsWith(".csv")) return "csv";
	if (lower.endsWith(".xml")) return "xml";
	if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) return "xlsx";
	if (lower.endsWith(".zip")) return "zip";
	return "csv";
}

function computeSha256(content: Buffer): string {
	return createHash("sha256").update(content).digest("hex");
}
