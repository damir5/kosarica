import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, Search, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { UserBanModal } from "@/components/admin/UserBanModal";
import { UserDeleteModal } from "@/components/admin/UserDeleteModal";
import { UserEditRoleModal } from "@/components/admin/UserEditRoleModal";
import { type User, UserTable } from "@/components/admin/UserTable";
import { UserViewModal } from "@/components/admin/UserViewModal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useSession } from "@/lib/auth-client";
import { orpc } from "@/orpc/client";

export const Route = createFileRoute("/_admin/admin/users")({
	component: UsersPage,
});

function UsersPage() {
	const { data: session } = useSession();
	const queryClient = useQueryClient();

	// Search and filter state
	const [search, setSearch] = useState("");
	const [debouncedSearch, setDebouncedSearch] = useState("");
	const [roleFilter, setRoleFilter] = useState<string>("all");
	const [statusFilter, setStatusFilter] = useState<string>("all");
	const [page, setPage] = useState(1);

	// Modal state
	const [selectedUser, setSelectedUser] = useState<User | null>(null);
	const [modalType, setModalType] = useState<
		"view" | "edit" | "delete" | "ban" | null
	>(null);

	// Debounce search
	useEffect(() => {
		const timer = setTimeout(() => {
			setDebouncedSearch(search);
			setPage(1);
		}, 300);
		return () => clearTimeout(timer);
	}, [search]);

	// Query users
	const { data, isLoading, error } = useQuery(
		orpc.admin.users.list.queryOptions({
			input: {
				page,
				pageSize: 20,
				search: debouncedSearch || undefined,
				role:
					roleFilter !== "all"
						? (roleFilter as "user" | "superadmin")
						: undefined,
				banned:
					statusFilter === "banned"
						? true
						: statusFilter === "active"
							? false
							: undefined,
			},
		}),
	);

	// Mutations
	const updateRoleMutation = useMutation({
		mutationFn: async ({
			userId,
			role,
		}: {
			userId: string;
			role: "user" | "superadmin";
		}) => {
			return orpc.admin.users.updateRole.call({
				userId,
				role,
				currentUserId: session?.user?.id || "",
			});
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
		},
	});

	const deleteMutation = useMutation({
		mutationFn: async (userId: string) => {
			return orpc.admin.users.delete.call({
				userId,
				currentUserId: session?.user?.id || "",
			});
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
		},
	});

	const banMutation = useMutation({
		mutationFn: async ({
			userId,
			banned,
			reason,
		}: {
			userId: string;
			banned: boolean;
			reason?: string;
		}) => {
			return orpc.admin.users.ban.call({
				userId,
				banned,
				reason,
				currentUserId: session?.user?.id || "",
			});
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
		},
	});

	const handleOpenModal = (
		user: User,
		type: "view" | "edit" | "delete" | "ban",
	) => {
		setSelectedUser(user);
		setModalType(type);
	};

	const handleCloseModal = () => {
		setSelectedUser(null);
		setModalType(null);
	};

	return (
		<>
			{/* Header */}
			<div className="border-border border-b bg-card">
				<div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
					<div className="flex items-center gap-3">
						<Users className="h-8 w-8 text-primary" />
						<div>
							<h1 className="font-semibold text-2xl text-foreground">
								User Management
							</h1>
							<p className="mt-1 text-muted-foreground text-sm">
								View, edit, and manage user accounts
							</p>
						</div>
					</div>
				</div>
			</div>

			{/* Main Content */}
			<div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
				{/* Filters */}
				<div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center">
					<div className="relative flex-1">
						<Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
						<Input
							placeholder="Search by name or email..."
							value={search}
							onChange={(e) => setSearch(e.target.value)}
							className="pl-9"
						/>
					</div>
					<div className="flex gap-2">
						<Select
							value={roleFilter}
							onValueChange={(value) => {
								setRoleFilter(value);
								setPage(1);
							}}
						>
							<SelectTrigger className="w-[140px]">
								<SelectValue placeholder="Role" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="all">All Roles</SelectItem>
								<SelectItem value="user">User</SelectItem>
								<SelectItem value="superadmin">Superadmin</SelectItem>
							</SelectContent>
						</Select>
						<Select
							value={statusFilter}
							onValueChange={(value) => {
								setStatusFilter(value);
								setPage(1);
							}}
						>
							<SelectTrigger className="w-[140px]">
								<SelectValue placeholder="Status" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="all">All Status</SelectItem>
								<SelectItem value="active">Active</SelectItem>
								<SelectItem value="banned">Banned</SelectItem>
							</SelectContent>
						</Select>
					</div>
				</div>

				{/* Error State */}
				{error && (
					<div className="mb-6 rounded-lg border border-destructive/50 bg-destructive/10 p-4">
						<p className="text-sm text-destructive">Error: {error.message}</p>
					</div>
				)}

				{/* Loading State */}
				{isLoading && (
					<div className="flex items-center justify-center py-12">
						<p className="text-muted-foreground">Loading users...</p>
					</div>
				)}

				{/* User Table */}
				{data && !isLoading && (
					<>
						<UserTable
							users={data.users as User[]}
							currentUserId={session?.user?.id || ""}
							onViewUser={(user) => handleOpenModal(user, "view")}
							onEditRole={(user) => handleOpenModal(user, "edit")}
							onDeleteUser={(user) => handleOpenModal(user, "delete")}
							onBanUser={(user) => handleOpenModal(user, "ban")}
						/>

						{/* Pagination */}
						<div className="mt-4 flex items-center justify-between">
							<p className="text-sm text-muted-foreground">
								Showing {(page - 1) * 20 + 1} to{" "}
								{Math.min(page * 20, data.total)} of {data.total} users
							</p>
							<div className="flex items-center gap-2">
								<Button
									variant="outline"
									size="sm"
									onClick={() => setPage((p) => Math.max(1, p - 1))}
									disabled={page === 1}
								>
									<ChevronLeft className="h-4 w-4" />
									Previous
								</Button>
								<span className="text-sm">
									Page {page} of {data.totalPages || 1}
								</span>
								<Button
									variant="outline"
									size="sm"
									onClick={() => setPage((p) => p + 1)}
									disabled={page >= (data.totalPages || 1)}
								>
									Next
									<ChevronRight className="h-4 w-4" />
								</Button>
							</div>
						</div>
					</>
				)}
			</div>

			{/* Modals */}
			<UserViewModal
				user={selectedUser}
				open={modalType === "view"}
				onOpenChange={(open) => !open && handleCloseModal()}
			/>
			<UserEditRoleModal
				user={selectedUser}
				open={modalType === "edit"}
				onOpenChange={(open) => !open && handleCloseModal()}
				onSave={async (userId, role) => {
					await updateRoleMutation.mutateAsync({ userId, role });
				}}
				isLoading={updateRoleMutation.isPending}
			/>
			<UserDeleteModal
				user={selectedUser}
				open={modalType === "delete"}
				onOpenChange={(open) => !open && handleCloseModal()}
				onConfirm={async (userId) => {
					await deleteMutation.mutateAsync(userId);
				}}
				isLoading={deleteMutation.isPending}
			/>
			<UserBanModal
				user={selectedUser}
				open={modalType === "ban"}
				onOpenChange={(open) => !open && handleCloseModal()}
				onConfirm={async (userId, banned, reason) => {
					await banMutation.mutateAsync({ userId, banned, reason });
				}}
				isLoading={banMutation.isPending}
			/>
		</>
	);
}
