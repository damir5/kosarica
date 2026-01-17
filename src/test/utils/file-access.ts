/**
 * File access utilities for tests.
 *
 * Provides direct filesystem access using Node.js fs module.
 */

import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as path from "node:path";

const SAMPLE_DATA_DIR = process.env.SAMPLE_DATA_DIR || path.join(process.cwd(), "sample-data");

/**
 * Check if a file or directory exists.
 *
 * @param filePath - Absolute path to check
 * @returns Promise<boolean> - true if path exists, false otherwise
 */
export async function exists(filePath: string): Promise<boolean> {
	try {
		await fs.access(filePath);
		return true;
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
	return exists(SAMPLE_DATA_DIR);
}

/**
 * List files in a directory.
 *
 * @param dirPath - Absolute path to directory
 * @returns Promise<string[]> - Array of filenames (excludes dotfiles)
 */
export async function readdir(dirPath: string): Promise<string[]> {
	try {
		const entries = await fs.readdir(dirPath);
		return entries.filter((f) => !f.startsWith("."));
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
	const buffer = await fs.readFile(filePath);
	return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
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
	const filePath = path.join(SAMPLE_DATA_DIR, chain, filename);
	try {
		return await readFile(filePath);
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
	return exists(path.join(SAMPLE_DATA_DIR, chain));
}

/**
 * List sample files for a specific chain.
 *
 * @param chain - The chain name (e.g., "konzum", "lidl")
 * @returns Promise<string[]> - Array of filenames in the chain's sample directory
 */
export async function getSampleFiles(chain: string): Promise<string[]> {
	const dirPath = path.join(SAMPLE_DATA_DIR, chain);
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
