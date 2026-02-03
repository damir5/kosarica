import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_admin/admin/ingestion")({
	component: IngestionLayout,
});

function IngestionLayout() {
	return <Outlet />;
}
