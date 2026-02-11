import { Link } from "@tanstack/react-router";

import { STORE_DISPLAY_NAMES } from "@/components/public/domain/store-colors";

const supportedStores = Object.values(STORE_DISPLAY_NAMES);

const footerLinks = [
	{ to: "/about" as const, label: "O nama" },
	{ to: "/faq" as const, label: "FAQ" },
	{ to: "/privacy" as const, label: "Privatnost" },
];

export function Footer() {
	return (
		<footer
			data-slot="footer"
			className="hidden border-t border-tk-border bg-tk-surface py-8 md:block"
		>
			<div className="mx-auto max-w-[1200px] space-y-6 px-4 md:px-8 lg:px-6">
				<div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
					<span className="font-tk-display text-lg italic text-tk-text">
						Tvoja Košarica
					</span>

					<nav data-slot="footer-nav" className="flex items-center gap-6">
						{footerLinks.map((link) => (
							<Link
								key={link.to}
								to={link.to}
								className="text-sm text-tk-text-secondary transition-colors hover:text-tk-text"
							>
								{link.label}
							</Link>
						))}
					</nav>
				</div>

				<p data-slot="footer-stores" className="text-xs text-tk-text-tertiary">
					Podržane trgovine: {supportedStores.join(" \u00b7 ")}
				</p>
			</div>
		</footer>
	);
}
