"use client";

interface ChainHealth {
	chainSlug: string;
	chainName: string;
	totalRows: number;
	validRows: number;
	failedRows: number;
	errorRate: number;
	status: "healthy" | "degraded" | "critical";
	last24hTrend: number[];
}

interface ErrorSummary {
	errorRate: number;
	totalRows: number;
	failedRows: number;
	topErrors: { error: string; count: number; percentage: number }[];
	affectedChains: string[];
	timeRange: string;
}

export default function IngestionHealthWidget() {
	const [data, setData] = useState<ErrorSummary | null>(null);
	const [loading, setLoading] = useState(true);
	const [lastPollTime, setLastPollTime] = useState<number>(Date.now());

	useEffect(() => {
		// Poll every 30 seconds
		const interval = setInterval(async () => {
			try {
				const response = await fetch(
					"/internal/ingestion/error-summary?hours=24",
				);
				if (!response.ok) {
					console.error("Failed to fetch error summary:", response.statusText);
					return;
				}

				const summary = await response.json();
				setData(summary);
				setLastPollTime(Date.now());
			} catch (error) {
				console.error("Error polling error summary:", error);
			}
		}, 30000);

		return () => clearInterval(interval);
	}, []);

	const getStatusColor = (status: string) => {
		switch (status) {
			case "healthy":
				return "bg-green-500";
			case "degraded":
				return "bg-yellow-500";
			case "critical":
				return "bg-red-500";
			default:
				return "bg-gray-500";
		}
	};

	const getStatusText = (status: string) => {
		switch (status) {
			case "healthy":
				return "HEALTHY";
			case "degraded":
				return "DEGRADED";
			case "critical":
				return "CRITICAL";
			default:
				return "UNKNOWN";
		}
	};

	if (loading) {
		return (
			<div className="p-6 text-center">
				<div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-gray-300"></div>
			</div>
		);
	}

	if (!data) {
		return (
			<div className="bg-white rounded-lg shadow-lg p-6">
				<h2 className="text-xl font-bold mb-4">Ingestion Health</h2>
				<div className="text-gray-500">No data available</div>
			</div>
		);
	}

	return (
		<div className="bg-white rounded-lg shadow-lg p-6 space-y-6">
			<div className="flex items-center justify-between mb-6">
				<h2 className="text-xl font-bold">Ingestion Health</h2>

				<div className="text-sm text-gray-500">
					Last updated: {new Date(lastPollTime).toLocaleTimeString()}
				</div>
			</div>

			{/* Overall Status */}
			<div
				className="mb-6 p-4 rounded-lg"
				style={{ backgroundColor: getStatusColor(data.status) }}
			>
				<div className="text-white">
					<div className="text-3xl font-bold">
						{(data.errorRate * 100).toFixed(1)}%
					</div>
					<div className="text-xl">{getStatusText(data.status)}</div>
				</div>
			</div>

			{/* Error Rate Legend */}
			<div className="mb-6 grid grid-cols-3 gap-4 text-sm">
				<div className="flex items-center gap-2">
					<div className="w-4 h-4 rounded bg-green-500"></div>
					<span>Healthy: &lt;3%</span>
				</div>
				<div className="flex items-center gap-2">
					<div className="w-4 h-4 rounded bg-yellow-500"></div>
					<span>Degraded: 3-10%</span>
				</div>
				<div className="flex items-center gap-2">
					<div className="w-4 h-4 rounded bg-red-500"></div>
					<span>Critical: &gt;10%</span>
				</div>
			</div>

			{/* Chain Status Table */}
			<div className="overflow-x-auto border rounded-lg">
				<table className="min-w-full divide-y divide-gray-200">
					<thead className="bg-gray-100">
						<tr>
							<th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
								Chain
							</th>
							<th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
								Total
							</th>
							<th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
								Failed
							</th>
							<th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
								Error Rate
							</th>
							<th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
								Status
							</th>
						</tr>
					</thead>
					<tbody className="bg-white">
						{data.affectedChains.map((chain) => (
							<tr key={chain.chainSlug} className="hover:bg-gray-50">
								<td className="px-6 py-3 font-medium">{chain.chainName}</td>
								<td className="px-6 py-3 text-right">
									{chain.totalRows.toLocaleString()}
								</td>
								<td className="px-6 py-3 text-right text-red-600">
									{chain.failedRows.toLocaleString()}
								</td>
								<td className="px-6 py-3 text-right">
									{(chain.errorRate * 100).toFixed(1)}%
								</td>
								<td className="px-6 py-3 text-right">
									<span
										className={`px-2 py-1 rounded text-white text-xs font-bold ${getStatusColor(chain.status)}`}
									>
										{getStatusText(chain.status)}
									</span>
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>

			{/* Top Errors */}
			<div className="mt-6">
				<h3 className="text-lg font-bold mb-3">Top Error Types</h3>
				<div className="bg-red-50 rounded-lg p-4">
					<table className="min-w-full">
						<thead className="bg-red-100">
							<tr>
								<th className="px-4 py-2 text-left text-xs font-medium text-white uppercase">
									Error
								</th>
								<th className="px-4 py-2 text-right text-xs font-medium text-white uppercase">
									Count
								</th>
								<th className="px-4 py-2 text-right text-xs font-medium text-white uppercase">
									Percentage
								</th>
							</tr>
						</thead>
						<tbody className="bg-white text-sm">
							{data.topErrors.map((error) => (
								<tr key={error.error} className="border-b border-red-200">
									<td className="px-4 py-2 font-medium">{error.error}</td>
									<td className="px-4 py-2 text-right">
										{error.count.toLocaleString()}
									</td>
									<td className="px-4 py-2 text-right">
										{(error.percentage * 100).toFixed(1)}%
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</div>

			{/* Actions */}
			<div className="flex gap-3 mt-6">
				<button
					className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
					onClick={() =>
						(window.location.href = "/admin/ingestion/failed-rows")
					}
				>
					View Failed Rows
				</button>

				<button
					className="px-6 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700"
					onClick={() =>
						(window.location.href =
							"/admin/ingestion/failed-rows/reprocess-all")
					}
				>
					Re-process All
				</button>
			</div>

			{/* Time Range Info */}
			<div className="mt-6 text-sm text-gray-500 text-center">
				Showing data for: {data.timeRange}
			</div>
		</div>
	);
}
