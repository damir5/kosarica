import { createFileRoute, Outlet } from "@tanstack/react-router";
import AdminHeader from "@/components/AdminHeader";

export const Route = createFileRoute("/_admin/admin")({
	component: AdminLayout,
});

function AdminLayout() {
	return (
		<div className="min-h-screen bg-background">
			<AdminHeader />
			<Outlet />
		</div>
	);
}
