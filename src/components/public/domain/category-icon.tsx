import {
	Apple,
	Beef,
	Candy,
	Heart,
	Milk,
	MoreHorizontal,
	Package,
	Sparkles,
	Wheat,
	Wine,
} from "lucide-react";
import type * as React from "react";

import { cn } from "@/lib/utils";

type IconComponent = React.ComponentType<{ className?: string }>;

const categoryIconMap: Record<string, IconComponent> = {
	"voce-povrce": Apple,
	"voće-povrće": Apple,
	meso: Beef,
	mlijeko: Milk,
	kruh: Wheat,
	pice: Wine,
	piće: Wine,
	ciscenje: Sparkles,
	čišćenje: Sparkles,
	higijena: Heart,
	slatkisi: Candy,
	slatkiši: Candy,
	konzerve: Package,
	ostalo: MoreHorizontal,
};

interface CategoryIconProps {
	category: string;
	className?: string;
}

function CategoryIcon({ category, className }: CategoryIconProps) {
	const Icon = categoryIconMap[category] ?? MoreHorizontal;

	return <Icon className={cn("size-5", className)} />;
}

export { CategoryIcon };
