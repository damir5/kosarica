"use client";

import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { orpc } from "@/orpc/client";
import { getSession } from "@/lib/auth-server";
import { PageContainer, Section } from "@/components/public/layout";
import {
	Heading,
	Text,
	TkButton,
	TkCard,
	TkCardContent,
	TkSkeleton,
} from "@/components/public/primitives";
import { EmptyState, PriceDisplay } from "@/components/public/domain";
import { formatPrice } from "@/components/public/domain/price-display";

export const Route = createFileRoute("/_public/alerts")({
	beforeLoad: async ({ location }) => {
		const session = await getSession();
		if (!session) {
			throw redirect({
				to: "/login",
				search: { redirect: location.pathname },
			});
		}
	},
	head: () => ({
		meta: [{ title: "Alarmi | Tvoja Košarica" }],
	}),
	component: AlertsPage,
});

function AlertsPage() {
	const navigate = useNavigate();
	const queryClient = useQueryClient();

	const activeQuery = useQuery(
		orpc.alerts.list.queryOptions({ input: { status: "active" } }),
	);
	const historyQuery = useQuery(
		orpc.alerts.history.queryOptions({ input: {} }),
	);

	const deleteAlert = useMutation({
		mutationFn: async (alertId: string) => {
			await orpc.alerts.delete.call({ alertId });
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["alerts"] });
		},
	});

	const activeAlerts = activeQuery.data?.alerts ?? [];
	const triggeredAlerts = historyQuery.data?.history ?? [];
	const isLoading = activeQuery.isLoading;

	if (isLoading) {
		return (
			<PageContainer>
				<Heading level={1} size="xl" className="mb-6">
					Alarmi
				</Heading>
				<div className="space-y-3">
					{Array.from({ length: 3 }).map((_, i) => (
						<TkSkeleton
							key={`alert-skeleton-${i}`}
							className="h-20 w-full"
						/>
					))}
				</div>
			</PageContainer>
		);
	}

	if (activeAlerts.length === 0 && triggeredAlerts.length === 0) {
		return (
			<PageContainer>
				<Heading level={1} size="xl" className="mb-6">
					Alarmi
				</Heading>
				<EmptyState
					variant="alerts-empty"
					action={{
						label: "Pretraži proizvode",
						onClick: () => navigate({ to: "/search" }),
					}}
				/>
			</PageContainer>
		);
	}

	return (
		<PageContainer>
			<Heading level={1} size="xl" className="mb-6">
				Alarmi
			</Heading>

			{activeAlerts.length > 0 && (
				<Section title="Aktivni">
					<div className="space-y-3">
						{activeAlerts.map((alert) => (
							<TkCard key={alert.id}>
								<TkCardContent className="pt-4">
									<div className="flex items-center justify-between">
										<div className="min-w-0 flex-1">
											<Text className="font-medium line-clamp-1">
												{alert.productName}
											</Text>
											<Text
												variant="caption"
												className="text-tk-text-secondary"
											>
												{alert.direction === "below"
													? "Cijena padne ispod"
													: "Cijena naraste iznad"}{" "}
												{formatPrice(alert.targetPrice / 100)} &euro;
											</Text>
										</div>
										<TkButton
											variant="ghost"
											size="sm"
											onClick={() => deleteAlert.mutate(alert.id)}
											disabled={deleteAlert.isPending}
										>
											Obriši
										</TkButton>
									</div>
								</TkCardContent>
							</TkCard>
						))}
					</div>
				</Section>
			)}

			{triggeredAlerts.length > 0 && (
				<Section title="Povijest">
					<div className="space-y-3">
						{triggeredAlerts.map((alert) => (
							<TkCard key={alert.id}>
								<TkCardContent className="pt-4">
									<div className="flex items-center justify-between">
										<div className="min-w-0 flex-1">
											<Text className="font-medium line-clamp-1">
												{alert.productName}
											</Text>
											<div className="flex items-center gap-2 mt-1">
												<PriceDisplay
													amount={alert.targetPrice / 100}
													size="small"
												/>
												<Text
													variant="caption"
													className="text-tk-text-tertiary"
												>
													{alert.direction === "below"
														? "pala ispod"
														: "narasla iznad"}
												</Text>
											</div>
										</div>
										{alert.triggeredAt && (
											<Text
												variant="caption"
												className="text-tk-text-tertiary shrink-0"
											>
												{new Date(alert.triggeredAt).toLocaleDateString(
													"hr-HR",
												)}
											</Text>
										)}
									</div>
								</TkCardContent>
							</TkCard>
						))}
					</div>
				</Section>
			)}
		</PageContainer>
	);
}
