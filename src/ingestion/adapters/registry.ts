import type { ChainAdapter } from "./types";
import type { ChainID } from "./config";
import { KonzumAdapter } from "./chains/konzum";
import { LidlAdapter } from "./chains/lidl";
import { KauflandAdapter } from "./chains/kaufland";
import { StudenacAdapter } from "./chains/studenac";
import { PlodineAdapter } from "./chains/plodine";
import { IntersparAdapter } from "./chains/interspar";
import { DmAdapter } from "./chains/dm";
import { EurospinAdapter } from "./chains/eurospin";
import { KtcAdapter } from "./chains/ktc";
import { MetroAdapter } from "./chains/metro";
import { TrgocentarAdapter } from "./chains/trgocentar";

const registry = new Map<ChainID, ChainAdapter>();

function createAdapter(chainId: ChainID): ChainAdapter {
	switch (chainId) {
		case "konzum":
			return new KonzumAdapter();
		case "lidl":
			return new LidlAdapter();
		case "kaufland":
			return new KauflandAdapter();
		case "studenac":
			return new StudenacAdapter();
		case "plodine":
			return new PlodineAdapter();
		case "interspar":
			return new IntersparAdapter();
		case "dm":
			return new DmAdapter();
		case "eurospin":
			return new EurospinAdapter();
		case "ktc":
			return new KtcAdapter();
		case "metro":
			return new MetroAdapter();
		case "trgocentar":
			return new TrgocentarAdapter();
		default:
			throw new Error(`Unsupported chain: ${chainId}`);
	}
}

export function getAdapter(chainId: ChainID): ChainAdapter {
	const cached = registry.get(chainId);
	if (cached) {
		return cached;
	}
	const adapter = createAdapter(chainId);
	registry.set(chainId, adapter);
	return adapter;
}

export function listAdapters(): ChainAdapter[] {
	return Array.from(registry.values());
}
