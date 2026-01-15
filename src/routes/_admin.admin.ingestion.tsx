import { Outlet, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_admin/admin/ingestion" as any)({
	component: IngestionLayout,
});

function IngestionLayout() {
	return <Outlet />;
}
