import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface MetricCardProps {
	title: string;
	value: string;
	description?: string;
	icon?: ReactNode;
}

export function MetricCard({
	title,
	value,
	description,
	icon,
}: MetricCardProps) {
	return (
		<Card>
			<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
				<CardTitle className="font-medium text-sm">{title}</CardTitle>
				{icon && <div className="text-muted-foreground">{icon}</div>}
			</CardHeader>
			<CardContent>
				<div className="font-mono text-lg break-all">{value}</div>
				{description && (
					<p className="text-muted-foreground text-xs">{description}</p>
				)}
			</CardContent>
		</Card>
	);
}
