import iconv from "iconv-lite";

export type Encoding = "utf-8" | "windows-1250" | "iso-8859-2";

export function detectEncoding(content: Buffer): Encoding {
	if (content.length >= 3 && content[0] === 0xef && content[1] === 0xbb && content[2] === 0xbf) {
		return "utf-8";
	}

	try {
		const decoder = new TextDecoder("utf-8", { fatal: true });
		decoder.decode(content);
		return "utf-8";
	} catch {
		return "windows-1250";
	}
}

export function decode(content: Buffer, encoding: Encoding): string {
	if (encoding === "utf-8") {
		return new TextDecoder("utf-8", { fatal: false }).decode(content);
	}

	return iconv.decode(content, encoding);
}
