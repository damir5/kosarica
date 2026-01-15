import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { requireSuperadmin } from "@/lib/auth-server";

export const Route = createFileRoute("/_admin")({
	beforeLoad: async () => {
		try {
			await requireSuperadmin();
		} catch (error) {
			// If it's already a redirect, re-throw it
			if (
				error instanceof Response ||
				(error as { redirect?: unknown })?.redirect
			) {
				throw error;
			}
			// Otherwise, redirect to login
			console.error("Error in admin route beforeLoad:", error);
			throw redirect({ to: "/login" });
		}
	},
	component: AdminLayout,
});

function AdminLayout() {
	return <Outlet />;
}
