import iconv from "iconv-lite";

export type Encoding = "utf-8" | "windows-1250" | "iso-8859-2";
export const REPLACEMENT_CHAR = "\uFFFD";

export function detectEncoding(content: Buffer): Encoding {
	if (
		content.length >= 3 &&
		content[0] === 0xef &&
		content[1] === 0xbb &&
		content[2] === 0xbf
	) {
		return "utf-8";
	}

	if (isValidUtf8(content)) {
		return "utf-8";
	}

	return "windows-1250";
}

export function isValidUtf8(content: Buffer): boolean {
	try {
		const decoder = new TextDecoder("utf-8", { fatal: true });
		decoder.decode(content);
		return true;
	} catch {
		return false;
	}
}

export function decode(content: Buffer, encoding: Encoding): string {
	if (encoding === "utf-8") {
		return new TextDecoder("utf-8", { fatal: false }).decode(content);
	}

	return iconv.decode(content, encoding);
}

export function decodeStrict(content: Buffer, encoding: Encoding): string {
	if (encoding === "utf-8") {
		return new TextDecoder("utf-8", { fatal: true }).decode(content);
	}
	return iconv.decode(content, encoding);
}

export function countReplacementChars(text: string): number {
	let count = 0;
	for (const char of text) {
		if (char === REPLACEMENT_CHAR) {
			count += 1;
		}
	}
	return count;
}
