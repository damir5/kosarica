"use client";

import { useEffect, useState } from "react";

interface FailedRow {
	id: string;
	chainSlug: string;
	chainName: string;
	runId: string;
	fileId: string;
	storeIdentifier: string;
	rowNumber: number;
	rawData: string;
	validationErrors: string[];
	failedAt: string;
	reviewed: boolean;
	reviewedBy: string;
	reviewNotes: string;
	reprocessable: boolean;
	reprocessedAt: string;
}

interface FailedRowsResponse {
	failedRows: FailedRow[];
	total: number;
	page: number;
	totalPages: number;
}

export default function FailedRowsReview() {
	const [failedRows, setFailedRows] = useState<FailedRow[]>([]);
	const [loading, setLoading] = useState(true);
	const [page, setPage] = useState(1);
	const [totalPages, setTotalPages] = useState(0);
	const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
	const [currentChain, setCurrentChain] = useState("konzum");

	// biome-ignore lint/correctness/noInvalidUseBeforeDeclaration: function hoisting
	// biome-ignore lint/correctness/useExhaustiveDependencies: intentional
	useEffect(() => {
		loadFailedRows();
	}, [page, currentChain]);

	const loadFailedRows = async () => {
		try {
			setLoading(true);
			const response = await fetch(
				`/internal/admin/ingestion/failed-rows?chain=${currentChain}&page=${page}&limit=50`,
			);
			if (!response.ok) {
				console.error("Failed to fetch failed rows:", response.statusText);
				return;
			}

			const data: FailedRowsResponse = await response.json();
			setFailedRows(data.failedRows);
			setTotalPages(data.totalPages);
		} catch (error) {
			console.error("Error loading failed rows:", error);
		} finally {
			setLoading(false);
		}
	};

	const handleSelectAll = () => {
		setSelectedIds(new Set(failedRows.map((row) => row.id)));
	};

	const handleSelectNone = () => {
		setSelectedIds(new Set());
	};

	const handleSelectRow = (id: string) => {
		const newSelected = new Set(selectedIds);
		if (newSelected.has(id)) {
			newSelected.delete(id);
		} else {
			newSelected.add(id);
		}
		setSelectedIds(newSelected);
	};

	const handleMarkAsReviewed = async (id: string) => {
		try {
			const response = await fetch(
				`/internal/admin/ingestion/failed-rows/${id}/notes`,
				{
					method: "PUT",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ notes: "", reviewed: true }),
				},
			);

			if (!response.ok) {
				console.error("Failed to mark as reviewed:", response.statusText);
				return;
			}

			await loadFailedRows();
		} catch (error) {
			console.error("Error marking as reviewed:", error);
		}
	};

	const handleReprocess = async (ids: string[]) => {
		if (ids.length === 0) return;

		try {
			setLoading(true);
			const response = await fetch(
				"/internal/admin/ingestion/failed-rows/reprocess",
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ ids }),
				},
			);

			if (!response.ok) {
				console.error("Failed to re-process:", response.statusText);
				return;
			}

			await loadFailedRows();
			setSelectedIds(new Set());
		} catch (error) {
			console.error("Error re-processing:", error);
		} finally {
			setLoading(false);
		}
	};

	const handleAddReviewNotes = async (id: string, notes: string) => {
		try {
			const response = await fetch(
				`/internal/admin/ingestion/failed-rows/${id}/notes`,
				{
					method: "PUT",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ notes, reviewed: false }),
				},
			);

			if (!response.ok) {
				console.error("Failed to add review notes:", response.statusText);
				return;
			}

			await loadFailedRows();
		} catch (error) {
			console.error("Error adding review notes:", error);
		}
	};

	const showRawData = (rawData: string) => {
		alert(rawData);
	};

	const selectedRows = failedRows.filter((row) => selectedIds.has(row.id));
	const reprocessableSelectedCount = selectedRows.filter(
		(r) => r.reprocessable,
	).length;

	return (
		<div className="bg-white rounded-lg shadow-lg p-6">
			<div className="flex justify-between items-center mb-6">
				<h2 className="text-2xl font-bold">Failed Rows Review</h2>
				<div className="text-sm text-gray-500">Chain: {currentChain}</div>
			</div>

			<div className="flex gap-3 mb-4">
				<select
					value={currentChain}
					onChange={(e) => {
						setCurrentChain(e.target.value);
						setPage(1);
						setSelectedIds(new Set());
					}}
					className="border rounded-lg px-4 py-2 bg-white"
				>
					<option value="konzum">Konzum</option>
					<option value="lidl">Lidl</option>
					<option value="plodine">Plodine</option>
					<option value="interspar">Interspar</option>
					<option value="eurospin">Eurospin</option>
					<option value="ktc">KTC</option>
					<option value="metro">Metro</option>
					<option value="studenac">Studenac</option>
					<option value="trgocentar">Trgocentar</option>
				</select>

				<button
					type="button"
					onClick={handleSelectAll}
					className="px-4 py-2 bg-gray-200 rounded-lg hover:bg-gray-300"
					disabled={loading || failedRows.length === 0}
				>
					Select All
				</button>

				<button
					type="button"
					onClick={handleSelectNone}
					className="px-4 py-2 bg-gray-200 rounded-lg hover:bg-gray-300"
					disabled={selectedIds.size === 0}
				>
					Select None
				</button>

				<button
					type="button"
					onClick={() => handleReprocess(Array.from(selectedIds))}
					className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
					disabled={loading || selectedIds.size === 0}
				>
					Re-process Selected ({reprocessableSelectedCount} reprocessable)
				</button>
			</div>

			{loading && failedRows.length === 0 ? (
				<div className="text-center py-12">
					<div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-gray-300 border-t-blue-500"></div>
				</div>
			) : (
				<>
					{failedRows.length === 0 ? (
						<div className="text-center py-12 text-gray-500">
							No failed rows found for {currentChain}
						</div>
					) : (
						<div className="overflow-x-auto border rounded-lg">
							<table className="min-w-full divide-y divide-gray-200">
								<thead className="bg-gray-100">
									<tr>
										<th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-8">
											<input
												type="checkbox"
												checked={
													failedRows.length > 0 &&
													selectedIds.size === failedRows.length
												}
												onChange={() =>
													selectedIds.size === failedRows.length
														? handleSelectNone()
														: handleSelectAll()
												}
												className="rounded"
											/>
										</th>
										<th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
											Chain
										</th>
										<th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
											Run ID
										</th>
										<th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
											Store
										</th>
										<th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
											Row
										</th>
										<th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
											Errors
										</th>
										<th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
											Date
										</th>
										<th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
											Reviewed
										</th>
										<th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
											Actions
										</th>
									</tr>
								</thead>
								<tbody className="bg-white divide-y divide-gray-200">
									{failedRows.map((row) => (
										<tr key={row.id} className="hover:bg-gray-50">
											<td className="px-4 py-3">
												<input
													type="checkbox"
													checked={selectedIds.has(row.id)}
													onChange={() => handleSelectRow(row.id)}
													className="rounded"
												/>
											</td>
											<td className="px-6 py-3 font-medium">{row.chainName}</td>
											<td className="px-6 py-3 font-mono text-sm">
												{row.runId.substring(0, 8)}
											</td>
											<td className="px-6 py-3">{row.storeIdentifier}</td>
											<td className="px-6 py-3 text-right">{row.rowNumber}</td>
											<td className="px-6 py-3 text-sm">
												<div className="max-w-xs truncate text-red-600">
													{row.validationErrors[0] || "Unknown error"}
												</div>
											</td>
											<td className="px-6 py-3 text-right text-sm text-gray-500">
												{new Date(row.failedAt).toLocaleDateString()}
											</td>
											<td className="px-6 py-3">
												<span
													className={`px-2 py-1 rounded text-xs font-medium ${row.reviewed ? "bg-green-100 text-green-800" : "bg-yellow-100 text-yellow-800"}`}
												>
													{row.reviewed ? "Yes" : "No"}
												</span>
											</td>
											<td className="px-6 py-3">
												<div className="flex gap-2">
													<button
														type="button"
														className="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
														onClick={() => showRawData(row.rawData)}
													>
														View Raw
													</button>
													{!row.reviewed && (
														<button
															type="button"
															className="px-2 py-1 text-xs bg-green-100 text-green-700 rounded hover:bg-green-200"
															onClick={() => handleMarkAsReviewed(row.id)}
														>
															Mark Reviewed
														</button>
													)}
												</div>
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}

					{totalPages > 1 && (
						<div className="flex justify-center items-center gap-4 mt-4">
							<button
								type="button"
								onClick={() => setPage((p) => Math.max(1, p - 1))}
								disabled={page === 1 || loading}
								className="px-4 py-2 bg-gray-200 rounded-lg hover:bg-gray-300 disabled:bg-gray-100 disabled:cursor-not-allowed"
							>
								Previous
							</button>
							<span className="text-sm text-gray-600">
								Page {page} of {totalPages}
							</span>
							<button
								type="button"
								onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
								disabled={page === totalPages || loading}
								className="px-4 py-2 bg-gray-200 rounded-lg hover:bg-gray-300 disabled:bg-gray-100 disabled:cursor-not-allowed"
							>
								Next
							</button>
						</div>
					)}
				</>
			)}
		</div>
	);
}
