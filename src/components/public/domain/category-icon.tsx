import {
	Home,
	MoreHorizontal,
	ShowerHead,
	Sparkles,
	SprayCan,
	UtensilsCrossed,
	Wine,
} from "lucide-react";
import type * as React from "react";

import { cn } from "@/lib/utils";

type IconComponent = React.ComponentType<{ className?: string }>;

/** Maps normalized category names (from DB) to lucide-react icons */
const categoryIconMap: Record<string, IconComponent> = {
	Hrana: UtensilsCrossed,
	Kozmetika: Sparkles,
	"Kućanstvo": Home,
	"Piće": Wine,
	"Sredstva za čišćenje": SprayCan,
	"Toaletne potrepštine": ShowerHead,
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
