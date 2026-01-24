import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_admin/admin/stores")({
	component: StoresLayout,
});

function StoresLayout() {
	return <Outlet />;
}
