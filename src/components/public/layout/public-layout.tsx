import type * as React from "react";
import { BottomNav } from "./bottom-nav";
import { Footer } from "./footer";
import { PublicHeader } from "./public-header";

export function PublicLayout({ children }: { children: React.ReactNode }) {
	return (
		<div
			data-slot="public-layout"
			className="tk-public min-h-screen bg-tk-bg text-tk-text font-tk-sans"
		>
			<PublicHeader />
			<main data-slot="public-main" className="pb-16 md:pb-0">
				{children}
			</main>
			<Footer />
			<BottomNav />
		</div>
	);
}
