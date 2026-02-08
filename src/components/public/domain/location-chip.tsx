"use client";

import { MapPin } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";
import { useLocation } from "@/hooks/use-location";
import { LocationPickerDrawer } from "./location-picker-drawer";

export function LocationChip() {
	const { location, isSet } = useLocation();
	const [open, setOpen] = useState(false);

	return (
		<>
			<button
				type="button"
				onClick={() => setOpen(true)}
				className={cn(
					"flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium font-tk-sans transition-colors",
					isSet
						? "bg-tk-accent/10 text-tk-accent"
						: "bg-tk-surface-alt text-tk-text-secondary hover:text-tk-text",
				)}
				aria-label={isSet ? `Lokacija: ${location?.city}` : "Odaberi lokaciju"}
			>
				<MapPin className="size-3.5" />
				<span className="max-w-[100px] truncate">
					{isSet ? location?.city : "Lokacija"}
				</span>
			</button>
			<LocationPickerDrawer open={open} onOpenChange={setOpen} />
		</>
	);
}
