import { Link } from "@tanstack/react-router";
import { Bell, Search, ShoppingBasket, User } from "lucide-react";
import type { ComponentType } from "react";

import { cn } from "@/lib/utils";

export function PublicHeader() {
	return (
		<header
			data-slot="public-header"
			className="sticky top-0 z-40 h-14 border-b border-tk-border bg-tk-surface/95 backdrop-blur-sm"
		>
			<div className="mx-auto flex h-full max-w-[1200px] items-center justify-between px-4 md:px-8 lg:px-6">
				<Link to="/" className="font-tk-display text-lg italic text-tk-text">
					Tvoja Košarica
				</Link>

				<nav
					data-slot="public-header-nav"
					className="hidden items-center gap-1 md:flex"
				>
					{/* Routes not yet registered — cast will be removed once public routes are added */}
					<NavLink to={"/search" as string} icon={Search} label="Traži" />
					<NavLink
						to={"/basket" as string}
						icon={ShoppingBasket}
						label="Košarica"
					/>
					<NavLink to={"/alerts" as string} icon={Bell} label="Alarmi" />
				</nav>

				<Link
					to={"/profile" as string}
					className={cn(
						"flex size-9 items-center justify-center rounded-full",
						"text-tk-text-secondary transition-colors hover:bg-tk-surface-alt hover:text-tk-text",
					)}
					aria-label="Profil"
				>
					<User className="size-5" />
				</Link>
			</div>
		</header>
	);
}

const NAV_LINK_BASE =
	"flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium";

function NavLink({
	to,
	icon: Icon,
	label,
}: {
	to: string;
	icon: ComponentType<{ className?: string }>;
	label: string;
}) {
	return (
		<Link
			to={to}
			className={`${NAV_LINK_BASE} text-tk-text-secondary transition-colors hover:bg-tk-surface-alt hover:text-tk-text`}
			activeProps={{
				className: `${NAV_LINK_BASE} text-tk-accent bg-tk-accent/10`,
			}}
		>
			<Icon className="size-4" />
			<span>{label}</span>
		</Link>
	);
}
