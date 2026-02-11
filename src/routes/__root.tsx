import type { QueryClient } from "@tanstack/react-query";
import {
	createRootRouteWithContext,
	HeadContent,
	redirect,
	Scripts,
} from "@tanstack/react-router";
import { Component, Suspense, lazy, useEffect } from "react";
import { Toaster } from "sonner";
import {
	installGlobalClientErrorHandlers,
	reportClientError,
} from "@/lib/client-observability";
import { checkSetupRequired } from "@/lib/auth-server";
import { initPostHog } from "@/lib/posthog";
import { initRUM } from "@/lib/rum";
import appCss from "../styles.css?url";

const DevtoolsLoader = lazy(() => import("../components/dev/devtools"));

interface MyRouterContext {
	queryClient: QueryClient;
}

/**
 * Inline script that applies the persisted theme before first paint,
 * preventing a flash of wrong-theme content (FOUC).
 */
const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem("tk-theme");if(t==="dark"||(t==="system"||!t)&&matchMedia("(prefers-color-scheme:dark)").matches)document.documentElement.classList.add("dark")}catch(e){}})()`;

export const Route = createRootRouteWithContext<MyRouterContext>()({
	beforeLoad: async ({ location }) => {
		// Skip check for setup, login, API, and all non-admin routes
		if (
			location.pathname === "/setup" ||
			location.pathname === "/login" ||
			location.pathname.startsWith("/api/") ||
			!location.pathname.startsWith("/admin")
		) {
			return;
		}

		const needsSetup = await checkSetupRequired();
		if (needsSetup) {
			throw redirect({ to: "/setup" as const });
		}
	},
	head: () => ({
		meta: [
			{
				charSet: "utf-8",
			},
			{
				name: "viewport",
				content: "width=device-width, initial-scale=1",
			},
			{
				title: "Tvoja Košarica",
			},
		],
		links: [
			{
				rel: "stylesheet",
				href: appCss,
			},
			{
				rel: "preload",
				href: "/fonts/SpaceGrotesk-Variable.woff2",
				as: "font",
				type: "font/woff2",
				crossOrigin: "anonymous",
			},
			{
				rel: "preload",
				href: "/fonts/JetBrainsMono-Variable.woff2",
				as: "font",
				type: "font/woff2",
				crossOrigin: "anonymous",
			},
		],
	}),

	shellComponent: RootDocument,
});

function RootDocument({ children }: { children: React.ReactNode }) {
	return (
		<html lang="hr">
			<head>
				<HeadContent />
				<script>{THEME_INIT_SCRIPT}</script>
			</head>
			<body>
				<RootErrorBoundary>{children}</RootErrorBoundary>
				<ClientObservabilityBridge />
				<Toaster richColors position="top-right" />
				{import.meta.env.DEV && (
					<Suspense>
						<DevtoolsLoader />
					</Suspense>
				)}
				<Scripts />
			</body>
		</html>
	);
}

class RootErrorBoundary extends Component<
	{ children: React.ReactNode },
	{ hasError: boolean }
> {
	override state = { hasError: false };

	override componentDidCatch(error: Error): void {
		this.setState({ hasError: true });
		void reportClientError("react", error);
	}

	override render() {
		if (this.state.hasError) {
			return (
				<div className="mx-auto max-w-2xl p-6 text-center">
					<h1 className="font-semibold text-2xl">Something went wrong</h1>
					<p className="mt-3 text-muted-foreground">
						An unexpected client error was captured. Please refresh the page.
					</p>
				</div>
			);
		}
		return this.props.children;
	}
}

function ClientObservabilityBridge() {
	useEffect(() => {
		initPostHog();
		initRUM();
		return installGlobalClientErrorHandlers();
	}, []);

	return null;
}
