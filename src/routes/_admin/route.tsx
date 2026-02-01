import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { getSession } from "@/lib/auth-server";

export const Route = createFileRoute("/_admin")({
	beforeLoad: async ({ location }) => {
		const session = await getSession();
		if (
			!session ||
			(session.user as Record<string, unknown>).role !== "superadmin"
		) {
			const redirectTo = location.href;
			throw redirect({
				to: "/login",
				search: {
					redirect: redirectTo,
				},
			});
		}
	},
	component: AdminLayout,
});

function AdminLayout() {
	return <Outlet />;
}
