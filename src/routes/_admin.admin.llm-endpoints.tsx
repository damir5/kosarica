import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2, RefreshCw, Server } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { orpc } from "@/orpc/client";

export const Route = createFileRoute("/_admin/admin/llm-endpoints")({
	component: AdminLlmEndpointsPage,
});

type CreateInput = Parameters<typeof orpc.admin.llmEndpoints.create.call>[0];
type Capability = CreateInput["capabilities"][number];
type ResponseFormat = NonNullable<CreateInput["responseFormat"]>;

const PROVIDERS: Array<CreateInput["provider"]> = [
	"openai",
	"claude",
	"openrouter",
	"ollama",
	"vertex-express",
	"nvidia-nim",
	"zai",
];
const CAPABILITIES: Capability[] = [
	"matching_primary",
	"matching_secondary",
	"categorization_primary",
	"categorization_secondary",
];
const RESPONSE_FORMAT_OPTIONS: Array<ResponseFormat | "auto"> = [
	"auto",
	"json_object",
	"json_schema",
	"text",
	"none",
];

function parsePositiveInt(value: string, fallback: number): number {
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseNonNegativeInt(value: string, fallback: number): number {
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function parsePositiveNumber(value: string, fallback: number): number {
	const parsed = Number.parseFloat(value);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sameCapabilities(
	a: readonly string[] | undefined,
	b: readonly string[] | undefined,
): boolean {
	const left = [...(a ?? [])].sort();
	const right = [...(b ?? [])].sort();
	if (left.length !== right.length) {
		return false;
	}
	return left.every((value, index) => value === right[index]);
}

function AdminLlmEndpointsPage() {
	const queryClient = useQueryClient();
	const [endpointFilter, setEndpointFilter] = useState<string>("all");
	const [formError, setFormError] = useState<string>("");
	const [formName, setFormName] = useState<string>("");
	const [formProvider, setFormProvider] =
		useState<CreateInput["provider"]>("nvidia-nim");
	const [formModel, setFormModel] = useState<string>("");
	const [formEndpoint, setFormEndpoint] = useState<string>("");
	const [formApiKeyEnv, setFormApiKeyEnv] = useState<string>("NIM_API_KEY");
	const [formBaseWeight, setFormBaseWeight] = useState<string>("1");
	const [formTimeoutMs, setFormTimeoutMs] = useState<string>("20000");
	const [formMaxRetries, setFormMaxRetries] = useState<string>("1");
	const [formResponseFormat, setFormResponseFormat] = useState<
		ResponseFormat | "auto"
	>("json_object");
	const [formJsonSchemaNullable, setFormJsonSchemaNullable] =
		useState<boolean>(false);
	const [formMaxTokens, setFormMaxTokens] = useState<string>("");
	const [formCapabilities, setFormCapabilities] = useState<Set<Capability>>(
		new Set<Capability>(["matching_primary"]),
	);
	const [capabilityDrafts, setCapabilityDrafts] = useState<
		Record<string, Capability[]>
	>({});

	const statsQuery = useQuery(orpc.admin.llmEndpoints.stats.queryOptions({}));
	const listQuery = useQuery(orpc.admin.llmEndpoints.list.queryOptions({}));
	const healthQuery = useQuery(
		orpc.admin.llmEndpoints.health.queryOptions({
			input: {
				endpointIds:
					endpointFilter === "all" ? undefined : [endpointFilter],
				limit: 60,
			},
		}),
	);
	const qualityQuery = useQuery(
		orpc.admin.llmEndpoints.quality.queryOptions({
			input: {
				endpointId: endpointFilter === "all" ? undefined : endpointFilter,
				limit: 30,
			},
		}),
	);

	const endpoints = listQuery.data ?? [];

	useEffect(() => {
		const nextDrafts: Record<string, Capability[]> = {};
		for (const row of endpoints) {
			nextDrafts[row.id] = row.capabilities as Capability[];
		}
		setCapabilityDrafts(nextDrafts);
	}, [endpoints]);

	const endpointNameById = useMemo(() => {
		return new Map(endpoints.map((row) => [row.id, row.name] as const));
	}, [endpoints]);

	const invalidate = () => {
		queryClient.invalidateQueries({
			queryKey: orpc.admin.llmEndpoints.key({ type: "query" }),
		});
	};

	const createMutation = useMutation({
		mutationFn: async (input: CreateInput) =>
			orpc.admin.llmEndpoints.create.call(input),
		onSuccess: () => {
			setFormError("");
			setFormName("");
			setFormModel("");
			setFormEndpoint("");
			setFormMaxTokens("");
			setFormCapabilities(new Set<Capability>(["matching_primary"]));
			invalidate();
		},
	});

	const toggleMutation = useMutation({
		mutationFn: async (input: { endpointId: string; enabled: boolean }) =>
			orpc.admin.llmEndpoints.toggle.call(input),
		onSuccess: () => invalidate(),
	});

	const capabilityMutation = useMutation({
		mutationFn: async (input: {
			endpointId: string;
			capabilities: Capability[];
		}) => orpc.admin.llmEndpoints.setCapabilities.call(input),
		onSuccess: () => invalidate(),
	});

	const handleToggleFormCapability = (capability: Capability): void => {
		setFormCapabilities((prev) => {
			const next = new Set(prev);
			if (next.has(capability)) {
				next.delete(capability);
			} else {
				next.add(capability);
			}
			return next;
		});
	};

	const handleToggleDraftCapability = (
		endpointId: string,
		capability: Capability,
	): void => {
		setCapabilityDrafts((prev) => {
			const current = new Set<Capability>(prev[endpointId] ?? []);
			if (current.has(capability)) {
				current.delete(capability);
			} else {
				current.add(capability);
			}
			return {
				...prev,
				[endpointId]: Array.from(current),
			};
		});
	};

	const handleCreateEndpoint = (): void => {
		const selectedCapabilities = Array.from(formCapabilities);
		if (selectedCapabilities.length === 0) {
			setFormError("Select at least one capability.");
			return;
		}
		const name = formName.trim();
		const model = formModel.trim();
		const endpoint = formEndpoint.trim();
		const apiKeyEnv = formApiKeyEnv.trim();
		if (!name || !model || !endpoint || !apiKeyEnv) {
			setFormError("Name, model, endpoint and apiKeyEnv are required.");
			return;
		}
		setFormError("");
		createMutation.mutate({
			name,
			provider: formProvider,
			model,
			endpoint,
			apiKeyEnv,
			baseWeight: parsePositiveNumber(formBaseWeight, 1),
			timeoutMs: parsePositiveInt(formTimeoutMs, 20_000),
			maxRetries: Math.min(5, parseNonNegativeInt(formMaxRetries, 1)),
			responseFormat:
				formResponseFormat === "auto" ? undefined : formResponseFormat,
			jsonSchemaNullable: formJsonSchemaNullable,
			maxTokens:
				formMaxTokens.trim().length > 0
					? parsePositiveInt(formMaxTokens, 1)
					: undefined,
			capabilities: selectedCapabilities,
		});
	};

	const anyPending =
		createMutation.isPending ||
		toggleMutation.isPending ||
		capabilityMutation.isPending;
	const hasActiveChecks = healthQuery.data?.some((row) => {
		const checkedAt = new Date(row.checkedAt).getTime();
		return Date.now() - checkedAt < 60_000;
	});

	return (
		<>
			<div className="border-border border-b bg-card">
				<div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
					<div className="flex items-center justify-between gap-4">
						<div className="flex items-center gap-3">
							<Server className="h-8 w-8 text-primary" />
							<div>
								<h1 className="font-semibold text-2xl text-foreground">
									LLM Endpoints
								</h1>
								<p className="mt-1 text-muted-foreground text-sm">
									Manage endpoint routing and monitor health/quality.
								</p>
							</div>
						</div>
						<Button variant="outline" size="icon" onClick={invalidate}>
							<RefreshCw
								className={`h-4 w-4 ${hasActiveChecks ? "animate-spin" : ""}`}
							/>
						</Button>
					</div>
				</div>
			</div>

			<div className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
				<div className="grid gap-4 md:grid-cols-4">
					<Card>
						<CardHeader className="pb-2">
							<CardTitle className="text-sm">Total Endpoints</CardTitle>
						</CardHeader>
						<CardContent className="text-2xl">
							{statsQuery.data?.totalEndpoints ?? 0}
						</CardContent>
					</Card>
					<Card>
						<CardHeader className="pb-2">
							<CardTitle className="text-sm">Enabled</CardTitle>
						</CardHeader>
						<CardContent className="text-2xl">
							{statsQuery.data?.enabledEndpoints ?? 0}
						</CardContent>
					</Card>
					<Card>
						<CardHeader className="pb-2">
							<CardTitle className="text-sm">Open Circuits</CardTitle>
						</CardHeader>
						<CardContent className="text-2xl">
							{statsQuery.data?.openCircuits ?? 0}
						</CardContent>
					</Card>
					<Card>
						<CardHeader className="pb-2">
							<CardTitle className="text-sm">Half-Open Circuits</CardTitle>
						</CardHeader>
						<CardContent className="text-2xl">
							{statsQuery.data?.halfOpenCircuits ?? 0}
						</CardContent>
					</Card>
				</div>

				<Card>
					<CardHeader>
						<CardTitle>Create Endpoint</CardTitle>
						<CardDescription>
							Add a provider/model endpoint and assign routing capabilities.
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
							<div className="space-y-1">
								<Label htmlFor="endpoint-name">Name</Label>
								<Input
									id="endpoint-name"
									value={formName}
									onChange={(event) => setFormName(event.target.value)}
									placeholder="NIM Primary"
								/>
							</div>
							<div className="space-y-1">
								<Label>Provider</Label>
								<Select
									value={formProvider}
									onValueChange={(value) =>
										setFormProvider(value as CreateInput["provider"])
									}
								>
									<SelectTrigger>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{PROVIDERS.map((provider) => (
											<SelectItem key={provider} value={provider}>
												{provider}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
							<div className="space-y-1">
								<Label htmlFor="endpoint-model">Model</Label>
								<Input
									id="endpoint-model"
									value={formModel}
									onChange={(event) => setFormModel(event.target.value)}
									placeholder="meta/llama-3.1-8b-instruct"
								/>
							</div>
							<div className="space-y-1 md:col-span-2">
								<Label htmlFor="endpoint-url">Endpoint URL</Label>
								<Input
									id="endpoint-url"
									value={formEndpoint}
									onChange={(event) => setFormEndpoint(event.target.value)}
									placeholder="https://integrate.api.nvidia.com/v1/chat/completions"
								/>
							</div>
							<div className="space-y-1">
								<Label htmlFor="endpoint-api-key-env">API Key Env</Label>
								<Input
									id="endpoint-api-key-env"
									value={formApiKeyEnv}
									onChange={(event) => setFormApiKeyEnv(event.target.value)}
									placeholder="NIM_API_KEY"
								/>
							</div>
							<div className="space-y-1">
								<Label htmlFor="endpoint-weight">Base Weight</Label>
								<Input
									id="endpoint-weight"
									value={formBaseWeight}
									onChange={(event) => setFormBaseWeight(event.target.value)}
								/>
							</div>
							<div className="space-y-1">
								<Label htmlFor="endpoint-timeout">Timeout (ms)</Label>
								<Input
									id="endpoint-timeout"
									value={formTimeoutMs}
									onChange={(event) => setFormTimeoutMs(event.target.value)}
								/>
							</div>
							<div className="space-y-1">
								<Label htmlFor="endpoint-retries">Max Retries</Label>
								<Input
									id="endpoint-retries"
									value={formMaxRetries}
									onChange={(event) => setFormMaxRetries(event.target.value)}
								/>
							</div>
							<div className="space-y-1">
								<Label>Response Format</Label>
								<Select
									value={formResponseFormat}
									onValueChange={(value) =>
										setFormResponseFormat(value as ResponseFormat | "auto")
									}
								>
									<SelectTrigger>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{RESPONSE_FORMAT_OPTIONS.map((option) => (
											<SelectItem key={option} value={option}>
												{option}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
							<div className="space-y-1">
								<Label htmlFor="endpoint-max-tokens">Max Tokens</Label>
								<Input
									id="endpoint-max-tokens"
									value={formMaxTokens}
									onChange={(event) => setFormMaxTokens(event.target.value)}
									placeholder="Optional"
								/>
							</div>
							<div className="space-y-1">
								<Label>JSON Schema Nullable</Label>
								<div className="flex h-10 items-center gap-2 rounded-md border border-input px-3">
									<Switch
										checked={formJsonSchemaNullable}
										onCheckedChange={setFormJsonSchemaNullable}
									/>
									<span className="text-muted-foreground text-sm">
										{formJsonSchemaNullable ? "Enabled" : "Disabled"}
									</span>
								</div>
							</div>
						</div>
							<div className="space-y-2">
								<Label>Capabilities</Label>
								<div className="grid gap-2 md:grid-cols-2">
									{CAPABILITIES.map((capability) => (
										<div
											key={capability}
											className="flex items-center gap-2 text-sm"
										>
											<Checkbox
												checked={formCapabilities.has(capability)}
												onChange={() => handleToggleFormCapability(capability)}
											/>
											<span>{capability}</span>
										</div>
									))}
								</div>
							</div>
						{formError ? (
							<div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
								{formError}
							</div>
						) : null}
						{createMutation.isError ? (
							<div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
								{createMutation.error instanceof Error
									? createMutation.error.message
									: "Failed to create endpoint"}
							</div>
						) : null}
						<Button onClick={handleCreateEndpoint} disabled={anyPending}>
							{createMutation.isPending ? (
								<Loader2 className="mr-2 h-4 w-4 animate-spin" />
							) : null}
							Create Endpoint
						</Button>
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Configured Endpoints</CardTitle>
						<CardDescription>
							Toggle endpoint status and update capability routing.
						</CardDescription>
					</CardHeader>
					<CardContent>
						{listQuery.isLoading ? (
							<div className="flex items-center gap-2 text-muted-foreground">
								<Loader2 className="h-4 w-4 animate-spin" />
								Loading endpoints...
							</div>
						) : listQuery.isError ? (
							<div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
								{listQuery.error instanceof Error
									? listQuery.error.message
									: "Failed to load endpoints"}
							</div>
						) : (
							<div className="overflow-x-auto">
								<Table>
									<TableHeader>
										<TableRow>
											<TableHead>Name</TableHead>
											<TableHead>Provider / Model</TableHead>
											<TableHead>Endpoint</TableHead>
											<TableHead>Enabled</TableHead>
											<TableHead>Circuit</TableHead>
											<TableHead>Capabilities</TableHead>
											<TableHead className="text-right">Actions</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{endpoints.map((row) => {
											const draft = capabilityDrafts[row.id] ?? [];
											const canSaveCaps =
												draft.length > 0 &&
												!sameCapabilities(draft, row.capabilities);
											return (
												<TableRow key={row.id}>
													<TableCell className="font-medium">{row.name}</TableCell>
													<TableCell>
														<div className="text-sm">{row.provider}</div>
														<div className="font-mono text-muted-foreground text-xs">
															{row.model}
														</div>
													</TableCell>
													<TableCell className="max-w-[420px]">
														<div className="truncate text-xs">{row.endpoint}</div>
														<div className="font-mono text-muted-foreground text-xs">
															{row.apiKeyEnv}
														</div>
													</TableCell>
													<TableCell>
														<div className="flex items-center gap-2">
															<Switch
																checked={row.enabled}
																onCheckedChange={(enabled) =>
																	toggleMutation.mutate({
																		endpointId: row.id,
																		enabled,
																	})
																}
																disabled={toggleMutation.isPending}
															/>
															<Badge variant={row.enabled ? "default" : "secondary"}>
																{row.enabled ? "enabled" : "disabled"}
															</Badge>
														</div>
													</TableCell>
													<TableCell>
														<Badge variant="outline">
															{row.runtime?.circuitState ?? "closed"}
														</Badge>
														<div className="mt-1 text-xs text-muted-foreground">
															lat {Math.round(row.runtime?.avgLatencyMs ?? 0)} ms
														</div>
													</TableCell>
													<TableCell>
														<div className="grid gap-1">
															{CAPABILITIES.map((capability) => (
																<div
																	key={`${row.id}-${capability}`}
																	className="flex items-center gap-2 text-xs"
																>
																	<Checkbox
																		checked={draft.includes(capability)}
																		onChange={() =>
																			handleToggleDraftCapability(row.id, capability)
																		}
																	/>
																	<span>{capability}</span>
																</div>
															))}
														</div>
													</TableCell>
													<TableCell className="text-right">
														<Button
															size="sm"
															variant="outline"
															disabled={!canSaveCaps || capabilityMutation.isPending}
															onClick={() =>
																capabilityMutation.mutate({
																	endpointId: row.id,
																	capabilities: draft,
																})
															}
														>
															{capabilityMutation.isPending ? (
																<Loader2 className="mr-1 h-3 w-3 animate-spin" />
															) : null}
															Save
														</Button>
													</TableCell>
												</TableRow>
											);
										})}
									</TableBody>
								</Table>
							</div>
						)}
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
							<div>
								<CardTitle>Monitoring</CardTitle>
								<CardDescription>
									Recent active/passive health checks and quality scores.
								</CardDescription>
							</div>
							<div className="w-full md:w-[280px]">
								<Select
									value={endpointFilter}
									onValueChange={(value) => setEndpointFilter(value)}
								>
									<SelectTrigger>
										<SelectValue placeholder="Filter by endpoint" />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="all">All endpoints</SelectItem>
										{endpoints.map((row) => (
											<SelectItem key={row.id} value={row.id}>
												{row.name}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
						</div>
					</CardHeader>
					<CardContent className="space-y-6">
						<div>
							<h3 className="mb-2 font-medium text-sm">Health Checks</h3>
							<div className="overflow-x-auto">
								<Table>
									<TableHeader>
										<TableRow>
											<TableHead>Time</TableHead>
											<TableHead>Endpoint</TableHead>
											<TableHead>Type</TableHead>
											<TableHead>Status</TableHead>
											<TableHead>Latency</TableHead>
											<TableHead>HTTP</TableHead>
											<TableHead>Error</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{(healthQuery.data ?? []).map((row) => (
											<TableRow key={row.id}>
												<TableCell>
													{new Date(row.checkedAt).toLocaleString()}
												</TableCell>
												<TableCell>
													{endpointNameById.get(row.endpointId) ?? row.endpointId}
												</TableCell>
												<TableCell>{row.checkType}</TableCell>
												<TableCell>
													<Badge
														variant={row.success ? "default" : "destructive"}
													>
														{row.success ? "ok" : "failed"}
													</Badge>
												</TableCell>
												<TableCell>{row.latencyMs} ms</TableCell>
												<TableCell>{row.statusCode ?? "-"}</TableCell>
												<TableCell className="max-w-[360px] truncate text-xs">
													{row.errorMessage ?? "-"}
												</TableCell>
											</TableRow>
										))}
										{!healthQuery.isLoading && (healthQuery.data ?? []).length === 0 ? (
											<TableRow>
												<TableCell colSpan={7} className="text-center">
													No health checks found.
												</TableCell>
											</TableRow>
										) : null}
									</TableBody>
								</Table>
							</div>
						</div>

						<div>
							<h3 className="mb-2 font-medium text-sm">Daily Quality</h3>
							<div className="overflow-x-auto">
								<Table>
									<TableHeader>
										<TableRow>
											<TableHead>Day</TableHead>
											<TableHead>Endpoint</TableHead>
											<TableHead>Decisions</TableHead>
											<TableHead>Overrides</TableHead>
											<TableHead>Low Confidence</TableHead>
											<TableHead>Quality Score</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{(qualityQuery.data ?? []).map((row) => (
											<TableRow key={row.id}>
												<TableCell>{row.day}</TableCell>
												<TableCell>
													{endpointNameById.get(row.endpointId) ?? row.endpointId}
												</TableCell>
												<TableCell>{row.decisionCount}</TableCell>
												<TableCell>{row.overrideCount}</TableCell>
												<TableCell>{row.lowConfidenceCount}</TableCell>
												<TableCell>{row.qualityScore.toFixed(3)}</TableCell>
											</TableRow>
										))}
										{!qualityQuery.isLoading && (qualityQuery.data ?? []).length === 0 ? (
											<TableRow>
												<TableCell colSpan={6} className="text-center">
													No quality rows found.
												</TableCell>
											</TableRow>
										) : null}
									</TableBody>
								</Table>
							</div>
						</div>
					</CardContent>
				</Card>
			</div>
		</>
	);
}
