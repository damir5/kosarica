import { createHash } from "node:crypto";
import path from "node:path";
import {
	DeleteObjectCommand,
	GetObjectCommand,
	HeadObjectCommand,
	ListObjectsV2Command,
	PutObjectCommand,
	S3Client,
	type S3ClientConfig,
} from "@aws-sdk/client-s3";
import {
	compressGzip,
	decompressGzip,
	shouldCompressSmart,
} from "./compression";
import type { FileInfo, Storage, StorageMetadata } from "./index";
import { MIN_COMPRESSION_SIZE } from "./local";

interface S3StorageConfig {
	bucket: string;
	region: string;
	endpoint: string;
	accessKeyId: string;
	secretAccessKey: string;
	forcePathStyle: boolean;
	prefix: string;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
	if (!value) return fallback;
	const normalized = value.trim().toLowerCase();
	if (normalized === "1" || normalized === "true" || normalized === "yes") {
		return true;
	}
	if (normalized === "0" || normalized === "false" || normalized === "no") {
		return false;
	}
	return fallback;
}

function normalizePrefix(value: string | undefined): string {
	if (!value) return "";
	return value.replace(/^\/+|\/+$/g, "");
}

function normalizeKey(key: string): string {
	let cleanKey = key.replace(/\\/g, "/");
	cleanKey = path.posix.normalize(cleanKey);
	cleanKey = cleanKey.replace(/^[/]+/, "");

	const parts = cleanKey.split("/").filter(Boolean);
	if (parts.some((part) => part === "..")) {
		throw new Error(`invalid key: path traversal detected in "${key}"`);
	}

	return cleanKey;
}

function isObjectNotFound(error: unknown): boolean {
	if (
		error &&
		typeof error === "object" &&
		("$metadata" in error || "name" in error)
	) {
		const statusCode = (error as { $metadata?: { httpStatusCode?: number } })
			.$metadata?.httpStatusCode;
		if (statusCode === 404) {
			return true;
		}
		const name = (error as { name?: string }).name;
		return name === "NotFound" || name === "NoSuchKey";
	}
	return false;
}

async function streamToBuffer(body: unknown): Promise<Buffer> {
	if (Buffer.isBuffer(body)) {
		return body;
	}
	if (body instanceof Uint8Array) {
		return Buffer.from(body);
	}
	if (body == null) {
		return Buffer.alloc(0);
	}
	if (typeof body === "string") {
		return Buffer.from(body);
	}

	const chunks: Buffer[] = [];
	for await (const chunk of body as AsyncIterable<Uint8Array | Buffer | string>) {
		if (Buffer.isBuffer(chunk)) {
			chunks.push(chunk);
			continue;
		}
		if (chunk instanceof Uint8Array) {
			chunks.push(Buffer.from(chunk));
			continue;
		}
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

function computeChecksum(content: Buffer): string {
	const hash = createHash("sha256");
	hash.update(content);
	return hash.digest("hex");
}

function metadataChecksum(metadata: Record<string, string> | undefined): string {
	return metadata?.checksum_sha256 ?? "";
}

export function getS3StorageConfigFromEnv(
	env: NodeJS.ProcessEnv = process.env,
): S3StorageConfig {
	const bucket = env.S3_BUCKET?.trim();
	if (!bucket) {
		throw new Error("S3_BUCKET environment variable is required");
	}

	const endpoint = env.S3_ENDPOINT?.trim();
	if (!endpoint) {
		throw new Error("S3_ENDPOINT environment variable is required");
	}

	const accessKeyId = env.S3_ACCESS_KEY_ID?.trim();
	if (!accessKeyId) {
		throw new Error("S3_ACCESS_KEY_ID environment variable is required");
	}

	const secretAccessKey = env.S3_SECRET_ACCESS_KEY?.trim();
	if (!secretAccessKey) {
		throw new Error("S3_SECRET_ACCESS_KEY environment variable is required");
	}

	return {
		bucket,
		endpoint,
		accessKeyId,
		secretAccessKey,
		region: env.S3_REGION?.trim() || "us-east-1",
		forcePathStyle: parseBoolean(env.S3_FORCE_PATH_STYLE, true),
		prefix: normalizePrefix(env.S3_PREFIX),
	};
}

export class S3Storage implements Storage {
	private client: S3Client;

	constructor(private config: S3StorageConfig) {
		const clientConfig: S3ClientConfig = {
			region: config.region,
			endpoint: config.endpoint,
			forcePathStyle: config.forcePathStyle,
			credentials: {
				accessKeyId: config.accessKeyId,
				secretAccessKey: config.secretAccessKey,
			},
		};
		this.client = new S3Client(clientConfig);
	}

	private withPrefix(key: string): string {
		if (!this.config.prefix) return key;
		return `${this.config.prefix}/${key}`;
	}

	private stripPrefix(key: string): string {
		if (!this.config.prefix) return key;
		const prefixed = `${this.config.prefix}/`;
		if (!key.startsWith(prefixed)) return key;
		return key.slice(prefixed.length);
	}

	private async headObject(
		objectKey: string,
	): Promise<{
		size: number;
		modifiedAt: Date;
		metadata: Record<string, string>;
	}> {
		const response = await this.client.send(
			new HeadObjectCommand({
				Bucket: this.config.bucket,
				Key: this.withPrefix(objectKey),
			}),
		);
		return {
			size: Number(response.ContentLength ?? 0),
			modifiedAt: response.LastModified ?? new Date(),
			metadata: response.Metadata ?? {},
		};
	}

	private async getObjectBytes(objectKey: string): Promise<Buffer> {
		const response = await this.client.send(
			new GetObjectCommand({
				Bucket: this.config.bucket,
				Key: this.withPrefix(objectKey),
			}),
		);
		return streamToBuffer(response.Body);
	}

	async put(
		key: string,
		data: Buffer,
		metadata?: StorageMetadata,
	): Promise<void> {
		const normalizedKey = normalizeKey(key);
		const filename = metadata?.originalName ?? path.basename(normalizedKey);

		let objectKey = normalizedKey;
		let payload = data;
		let isCompressed = false;

		if (data.length >= MIN_COMPRESSION_SIZE && shouldCompressSmart(filename)) {
			const compressed = await compressGzip(data);
			if (compressed.length < data.length) {
				payload = compressed;
				objectKey = `${normalizedKey}.gz`;
				isCompressed = true;
			}
		}

		const checksum = computeChecksum(payload);
		await this.client.send(
			new PutObjectCommand({
				Bucket: this.config.bucket,
				Key: this.withPrefix(objectKey),
				Body: payload,
				ContentType: metadata?.contentType,
				Metadata: {
					checksum_sha256: checksum,
				},
			}),
		);

		const staleVariantKey = isCompressed ? normalizedKey : `${normalizedKey}.gz`;
		await this.client
			.send(
				new DeleteObjectCommand({
					Bucket: this.config.bucket,
					Key: this.withPrefix(staleVariantKey),
				}),
			)
			.catch(() => undefined);

		if (metadata) {
			const mergedMetadata: StorageMetadata = {
				...metadata,
			};
			if (!mergedMetadata.custom) mergedMetadata.custom = {};
			if (isCompressed) {
				mergedMetadata.custom.compressed = "true";
				mergedMetadata.custom.original_size = String(data.length);
				mergedMetadata.compressedSize = payload.length;
			}
			await this.client.send(
				new PutObjectCommand({
					Bucket: this.config.bucket,
					Key: this.withPrefix(`${normalizedKey}.meta.json`),
					Body: Buffer.from(JSON.stringify(mergedMetadata), "utf-8"),
					ContentType: "application/json",
				}),
			);
		}
	}

	async get(key: string): Promise<Buffer> {
		const normalizedKey = normalizeKey(key);
		try {
			const gzBytes = await this.getObjectBytes(`${normalizedKey}.gz`);
			return decompressGzip(gzBytes);
		} catch (error) {
			if (!isObjectNotFound(error)) {
				throw error;
			}
		}

		try {
			return await this.getObjectBytes(normalizedKey);
		} catch (error) {
			if (isObjectNotFound(error)) {
				throw new Error(`file not found: ${key}`);
			}
			throw error;
		}
	}

	async getInfo(key: string): Promise<FileInfo> {
		const normalizedKey = normalizeKey(key);
		let objectInfo:
			| {
					size: number;
					modifiedAt: Date;
					metadata: Record<string, string>;
			  }
			| null = null;
		let isCompressed = false;

		try {
			objectInfo = await this.headObject(`${normalizedKey}.gz`);
			isCompressed = true;
		} catch (error) {
			if (!isObjectNotFound(error)) {
				throw error;
			}
		}

		if (!objectInfo) {
			try {
				objectInfo = await this.headObject(normalizedKey);
			} catch (error) {
				if (isObjectNotFound(error)) {
					throw new Error(`file not found: ${key}`);
				}
				throw error;
			}
		}

		let sidecarMetadata: StorageMetadata | undefined;
		try {
			const metadataBytes = await this.getObjectBytes(`${normalizedKey}.meta.json`);
			sidecarMetadata = JSON.parse(metadataBytes.toString("utf-8")) as StorageMetadata;
		} catch (error) {
			if (!isObjectNotFound(error)) {
				throw error;
			}
			if (isCompressed) {
				sidecarMetadata = { custom: { compressed: "true" } };
			}
		}

		const checksum =
			metadataChecksum(objectInfo.metadata) || (await this.getChecksum(normalizedKey));

		return {
			key: normalizedKey,
			size: objectInfo.size,
			checksum,
			modifiedAt: objectInfo.modifiedAt,
			metadata: sidecarMetadata,
		};
	}

	async exists(key: string): Promise<boolean> {
		const normalizedKey = normalizeKey(key);
		try {
			await this.headObject(normalizedKey);
			return true;
		} catch (error) {
			if (!isObjectNotFound(error)) {
				throw error;
			}
		}

		try {
			await this.headObject(`${normalizedKey}.gz`);
			return true;
		} catch (error) {
			if (isObjectNotFound(error)) {
				return false;
			}
			throw error;
		}
	}

	async delete(key: string): Promise<void> {
		const normalizedKey = normalizeKey(key);
		const objectKeys = [
			normalizedKey,
			`${normalizedKey}.gz`,
			`${normalizedKey}.meta.json`,
		];
		await Promise.all(
			objectKeys.map((objectKey) =>
				this.client
					.send(
						new DeleteObjectCommand({
							Bucket: this.config.bucket,
							Key: this.withPrefix(objectKey),
						}),
					)
					.catch(() => undefined),
			),
		);
	}

	async list(prefix: string): Promise<string[]> {
		const normalizedPrefix = normalizeKey(prefix);
		const queryPrefix = this.withPrefix(normalizedPrefix);
		const keys: string[] = [];
		const seen = new Set<string>();
		let continuationToken: string | undefined;

		do {
			const response = await this.client.send(
				new ListObjectsV2Command({
					Bucket: this.config.bucket,
					Prefix: queryPrefix,
					ContinuationToken: continuationToken,
				}),
			);

			for (const item of response.Contents ?? []) {
				if (!item.Key) continue;
				let key = this.stripPrefix(item.Key);
				if (key.endsWith(".meta.json")) continue;
				if (key.endsWith(".gz")) {
					key = key.slice(0, -3);
				}
				if (key.startsWith(normalizedPrefix) && !seen.has(key)) {
					seen.add(key);
					keys.push(key);
				}
			}

			continuationToken = response.NextContinuationToken;
		} while (continuationToken);

		return keys;
	}

	async getChecksum(key: string): Promise<string> {
		const normalizedKey = normalizeKey(key);

		try {
			const gzInfo = await this.headObject(`${normalizedKey}.gz`);
			const checksum = metadataChecksum(gzInfo.metadata);
			if (checksum) return checksum;
		} catch (error) {
			if (!isObjectNotFound(error)) {
				throw error;
			}
		}

		try {
			const info = await this.headObject(normalizedKey);
			const checksum = metadataChecksum(info.metadata);
			if (checksum) return checksum;
		} catch (error) {
			if (!isObjectNotFound(error)) {
				throw error;
			}
		}

		const content = await this.get(normalizedKey);
		return computeChecksum(content);
	}
}
