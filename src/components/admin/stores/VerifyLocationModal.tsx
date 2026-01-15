import { Check, Edit2, MapPin, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { EnrichmentTask } from "./EnrichmentTaskCard";

interface VerifyLocationModalProps {
	task: EnrichmentTask | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onAccept: (
		taskId: string,
		corrections?: Record<string, unknown>,
	) => Promise<void>;
	onReject: (taskId: string) => Promise<void>;
	isLoading?: boolean;
}

export function VerifyLocationModal({
	task,
	open,
	onOpenChange,
	onAccept,
	onReject,
	isLoading = false,
}: VerifyLocationModalProps) {
	const [isEditing, setIsEditing] = useState(false);
	const [latitude, setLatitude] = useState("");
	const [longitude, setLongitude] = useState("");

	const outputData = task?.outputData ? JSON.parse(task.outputData) : null;

	// Reset state when task changes
	useEffect(() => {
		if (outputData) {
			setLatitude(outputData.lat || outputData.latitude || "");
			setLongitude(outputData.lon || outputData.longitude || "");
		}
		setIsEditing(false);
	}, [outputData]);

	if (!task) return null;

	const handleAccept = async () => {
		if (isEditing) {
			// Submit with corrections
			await onAccept(task.id, {
				latitude,
				longitude,
			});
		} else {
			// Accept as-is
			await onAccept(task.id);
		}
	};

	const handleReject = async () => {
		await onReject(task.id);
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<MapPin className="h-5 w-5" />
						Verify Location
					</DialogTitle>
					<DialogDescription>
						Review and verify the geocoding result for this store.
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-4">
					{/* Confidence Badge */}
					{task.confidence && (
						<div className="flex items-center gap-2">
							<span className="text-sm text-muted-foreground">Confidence:</span>
							<Badge
								variant={
									task.confidence === "high"
										? "default"
										: task.confidence === "medium"
											? "secondary"
											: "outline"
								}
							>
								{task.confidence}
							</Badge>
						</div>
					)}

					{/* Result Display / Edit */}
					{task.type === "geocode" && outputData?.found && (
						<div className="space-y-4">
							{/* Matched Address */}
							{outputData.displayName && (
								<div>
									<label className="text-sm font-medium text-muted-foreground">
										Matched Address
									</label>
									<p className="mt-1 text-sm">{outputData.displayName}</p>
								</div>
							)}

							{/* Coordinates */}
							<div className="grid gap-4 sm:grid-cols-2">
								<div>
									<label className="text-sm font-medium text-muted-foreground">
										Latitude
									</label>
									{isEditing ? (
										<Input
											value={latitude}
											onChange={(e) => setLatitude(e.target.value)}
											placeholder="45.8150"
											className="mt-1 font-mono"
										/>
									) : (
										<p className="mt-1 font-mono text-sm">{outputData.lat}</p>
									)}
								</div>
								<div>
									<label className="text-sm font-medium text-muted-foreground">
										Longitude
									</label>
									{isEditing ? (
										<Input
											value={longitude}
											onChange={(e) => setLongitude(e.target.value)}
											placeholder="15.9819"
											className="mt-1 font-mono"
										/>
									) : (
										<p className="mt-1 font-mono text-sm">{outputData.lon}</p>
									)}
								</div>
							</div>

							{/* Map Link */}
							<a
								href={`https://www.openstreetmap.org/?mlat=${isEditing ? latitude : outputData.lat}&mlon=${isEditing ? longitude : outputData.lon}&zoom=17`}
								target="_blank"
								rel="noopener noreferrer"
								className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
							>
								View on OpenStreetMap
								<MapPin className="h-3 w-3" />
							</a>

							{/* Edit Toggle */}
							<Button
								variant="outline"
								size="sm"
								onClick={() => setIsEditing(!isEditing)}
							>
								<Edit2 className="mr-2 h-3 w-3" />
								{isEditing ? "Cancel Edit" : "Edit Coordinates"}
							</Button>
						</div>
					)}

					{/* No results found */}
					{task.type === "geocode" && outputData && !outputData.found && (
						<div className="rounded-md bg-muted p-4">
							<p className="text-sm text-muted-foreground">
								No geocoding results were found for this address. You can
								manually enter coordinates or reject this task.
							</p>
							<div className="mt-4 grid gap-4 sm:grid-cols-2">
								<div>
									<label className="text-sm font-medium text-muted-foreground">
										Latitude
									</label>
									<Input
										value={latitude}
										onChange={(e) => setLatitude(e.target.value)}
										placeholder="45.8150"
										className="mt-1 font-mono"
									/>
								</div>
								<div>
									<label className="text-sm font-medium text-muted-foreground">
										Longitude
									</label>
									<Input
										value={longitude}
										onChange={(e) => setLongitude(e.target.value)}
										placeholder="15.9819"
										className="mt-1 font-mono"
									/>
								</div>
							</div>
						</div>
					)}

					{/* Address Verification */}
					{task.type === "verify_address" && outputData && (
						<div className="space-y-4">
							<div>
								<label className="text-sm font-medium text-muted-foreground">
									Original Address
								</label>
								<p className="mt-1 text-sm">
									{outputData.originalAddress || "Not set"}
								</p>
							</div>
							<div className="grid gap-4 sm:grid-cols-2">
								<div>
									<label className="text-sm font-medium text-muted-foreground">
										City
									</label>
									<p className="mt-1 text-sm">{outputData.city || "Not set"}</p>
								</div>
								<div>
									<label className="text-sm font-medium text-muted-foreground">
										Postal Code
									</label>
									<p className="mt-1 text-sm">
										{outputData.postalCode || "Not set"}
									</p>
								</div>
							</div>
						</div>
					)}
				</div>

				<DialogFooter className="gap-2 sm:gap-0">
					<Button
						variant="destructive"
						onClick={handleReject}
						disabled={isLoading}
					>
						<X className="mr-2 h-4 w-4" />
						Reject
					</Button>
					<Button
						onClick={handleAccept}
						disabled={isLoading || (isEditing && (!latitude || !longitude))}
					>
						<Check className="mr-2 h-4 w-4" />
						{isEditing ? "Accept with Corrections" : "Accept"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
