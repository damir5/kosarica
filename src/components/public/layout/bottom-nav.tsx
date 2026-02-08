import { Link } from "@tanstack/react-router";
import { Bell, Home, MapPin, Search, ShoppingBasket, User } from "lucide-react";
import type { ComponentType } from "react";

// Routes not yet registered — casts will be removed once public routes are added
const tabs: ReadonlyArray<{
	to: string;
	icon: ComponentType<{ className?: string }>;
	label: string;
	exact?: boolean;
}> = [
	{ to: "/", icon: Home, label: "Početna", exact: true },
	{ to: "/search", icon: Search, label: "Traži" },
	{ to: "/stores", icon: MapPin, label: "Trgovine" },
	{ to: "/basket", icon: ShoppingBasket, label: "Košarica" },
	{ to: "/alerts", icon: Bell, label: "Alarmi" },
	{ to: "/profile", icon: User, label: "Profil" },
];

const TAB_BASE =
	"flex flex-1 flex-col items-center justify-center gap-0.5";

export function BottomNav() {
	return (
		<nav
			data-slot="bottom-nav"
			className="fixed bottom-0 left-0 right-0 z-40 border-t border-tk-border bg-tk-surface/95 backdrop-blur-sm md:hidden"
			style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
		>
			<div className="flex h-14 items-center justify-around">
				{tabs.map((tab) => (
					<Link
						key={tab.label}
						to={tab.to}
						className={`${TAB_BASE} text-tk-text-tertiary transition-colors`}
						activeProps={{
							className: `${TAB_BASE} text-tk-accent`,
						}}
						activeOptions={{ exact: tab.exact }}
					>
						<tab.icon className="size-5" />
						<span className="text-[10px] font-medium leading-tight">
							{tab.label}
						</span>
					</Link>
				))}
			</div>
		</nav>
	);
}
