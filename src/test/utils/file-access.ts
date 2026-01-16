/**
 * File access utilities for Cloudflare Workers tests.
 *
 * These functions bridge the gap between the workers sandbox and Node.js filesystem
 * via a service binding that runs in Node.js (where fs is available).
 */

import { env } from "cloudflare:test";

/**
 * Service binding request/response interface for file operations.
 */
interface FileAccessRequest {
	method: "exists" | "readdir" | "read";
	path: string;
}

interface FileAccessResponse {
	success: boolean;
	data?: any;
	error?: string;
}

/**
 * The FILE_ACCESS service binding from the test environment.
 * This is provided by vitest.config.ts via serviceBindings.
 */
declare module "cloudflare:test" {
	interface ProvidedEnv extends Env {
		FILE_ACCESS?: Fetcher;
	}
}

let CACHED_SAMPLE_DATA_DIR: string | null = null;

/**
 * Get the sample data directory path from the service binding.
 * The path is computed in Node.js context where process.cwd() is available.
 *
 * Returns empty string if binding is not available (graceful degradation).
 */
async function getSampleDataDirPath(): Promise<string> {
	if (CACHED_SAMPLE_DATA_DIR) {
		return CACHED_SAMPLE_DATA_DIR;
	}

	const binding = env.FILE_ACCESS;
	if (!binding) {
		// Binding not available - use empty string to signal no sample data
		return "";
	}

	const url = "http://file-access/?method=getSampleDataDir";
	try {
		const response = await binding.fetch(url);
		const result = (await response.json()) as FileAccessResponse;
		if (result.success && typeof result.data === "string") {
			CACHED_SAMPLE_DATA_DIR = result.data;
			return result.data;
		}
		return "";
	} catch {
		return "";
	}
}

const SAMPLE_DATA_DIR =
	process.env.SAMPLE_DATA_DIR || "";

/**
 * Check if a file or directory exists.
 *
 * @param env - The test environment with FILE_ACCESS binding
 * @param filePath - Absolute path to check
 * @returns Promise<boolean> - true if path exists, false otherwise
 */
export async function exists(filePath: string): Promise<boolean> {
	const binding = env.FILE_ACCESS;
	if (!binding) {
		// Fallback: assume sample data is not available if no binding
		return false;
	}

	const url = `http://file-access/?method=exists&path=${encodeURIComponent(filePath)}`;
	try {
		const response = await binding.fetch(url);
		const result = (await response.json()) as FileAccessResponse;
		return result.success && result.data === true;
	} catch {
		return false;
	}
}

/**
 * Check if sample data directory is available.
 *
 * @returns Promise<boolean> - true if sample data directory exists
 */
export async function sampleDataAvailable(): Promise<boolean> {
	const binding = env.FILE_ACCESS;
	if (!binding) {
		return false;
	}
	const dir = SAMPLE_DATA_DIR || (await getSampleDataDirPath());
	return exists(dir);
}

/**
 * List files in a directory.
 *
 * @param dirPath - Absolute path to directory
 * @returns Promise<string[]> - Array of filenames (excludes dotfiles)
 */
export async function readdir(dirPath: string): Promise<string[]> {
	const binding = env.FILE_ACCESS;
	if (!binding) {
		return [];
	}

	const url = `http://file-access/?method=readdir&path=${encodeURIComponent(dirPath)}`;
	try {
		const response = await binding.fetch(url);
		const result = (await response.json()) as FileAccessResponse;
		if (result.success && Array.isArray(result.data)) {
			return result.data.filter((f: string) => !f.startsWith("."));
		}
		return [];
	} catch {
		return [];
	}
}

/**
 * Read a file as ArrayBuffer.
 *
 * @param filePath - Absolute path to file
 * @returns Promise<ArrayBuffer> - File contents as ArrayBuffer
 * @throws Error if file cannot be read
 */
export async function readFile(filePath: string): Promise<ArrayBuffer> {
	const binding = env.FILE_ACCESS;
	if (!binding) {
		throw new Error("FILE_ACCESS binding not available");
	}

	const url = `http://file-access/?method=read&path=${encodeURIComponent(filePath)}`;
	const response = await binding.fetch(url);

	if (!response.ok) {
		throw new Error(`Failed to read file: ${filePath}`);
	}

	const buffer = await response.arrayBuffer();
	return buffer;
}

/**
 * Read a sample file for a specific chain.
 *
 * @param chain - The chain name (e.g., "konzum", "lidl")
 * @param filename - The filename to read
 * @returns Promise<ArrayBuffer> - File contents as ArrayBuffer, or empty ArrayBuffer if unavailable
 */
export async function readSampleFile(
	chain: string,
	filename: string,
): Promise<ArrayBuffer> {
	const dir = SAMPLE_DATA_DIR || (await getSampleDataDirPath());
	if (!dir) {
		// Sample data directory not available, return empty ArrayBuffer
		return new ArrayBuffer(0);
	}
	const filePath = `${dir}/${chain}/${filename}`;

	const binding = env.FILE_ACCESS;
	if (!binding) {
		return new ArrayBuffer(0);
	}

	const url = `http://file-access/?method=read&path=${encodeURIComponent(filePath)}`;
	try {
		const response = await binding.fetch(url);
		if (!response.ok) {
			return new ArrayBuffer(0);
		}
		const buffer = await response.arrayBuffer();
		return buffer;
	} catch {
		return new ArrayBuffer(0);
	}
}

/**
 * Check if a specific chain's sample directory exists.
 *
 * @param chain - The chain name (e.g., "konzum", "lidl")
 * @returns Promise<boolean> - true if chain directory exists
 */
export async function chainDirectoryExists(chain: string): Promise<boolean> {
	const dir = SAMPLE_DATA_DIR || (await getSampleDataDirPath());
	return exists(`${dir}/${chain}`);
}

/**
 * List sample files for a specific chain.
 *
 * @param chain - The chain name (e.g., "konzum", "lidl")
 * @returns Promise<string[]> - Array of filenames in the chain's sample directory
 */
export async function getSampleFiles(chain: string): Promise<string[]> {
	const dir = SAMPLE_DATA_DIR || (await getSampleDataDirPath());
	if (!dir) {
		// Sample data directory not available
		return [];
	}
	const dirPath = `${dir}/${chain}`;
	const dirExists = await exists(dirPath);
	if (!dirExists) {
		return [];
	}
	return readdir(dirPath);
}

/**
 * Get the sample data directory path.
 *
 * @returns The absolute path to the sample data directory
 */
export function getSampleDataDir(): string {
	return SAMPLE_DATA_DIR;
}
