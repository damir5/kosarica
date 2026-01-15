import { Badge } from "@/components/ui/badge";
import { CopyableCell } from "@/components/ui/copyable-cell";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import type { User } from "./UserTable";

interface UserViewModalProps {
	user: User | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

export function UserViewModal({
	user,
	open,
	onOpenChange,
}: UserViewModalProps) {
	if (!user) return null;

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>User Details</DialogTitle>
					<DialogDescription>
						View complete information about this user.
					</DialogDescription>
				</DialogHeader>
				<div className="space-y-4">
					<div className="grid grid-cols-2 gap-4">
						<div>
							<span className="text-sm font-medium text-muted-foreground">
								ID
							</span>
							<CopyableCell
								value={user.id}
								label="ID"
								mono
								className="-ml-2 mt-1"
							/>
						</div>
						<div>
							<span className="text-sm font-medium text-muted-foreground">
								Role
							</span>
							<p className="mt-1">
								<Badge
									variant={user.role === "superadmin" ? "default" : "secondary"}
								>
									{user.role || "user"}
								</Badge>
							</p>
						</div>
					</div>

					<div>
						<span className="text-sm font-medium text-muted-foreground">
							Name
						</span>
						<CopyableCell
							value={user.name}
							label="Name"
							className="-ml-2 mt-1"
						/>
					</div>

					<div>
						<span className="text-sm font-medium text-muted-foreground">
							Email
						</span>
						<CopyableCell
							value={user.email}
							label="Email"
							className="-ml-2 mt-1"
						/>
					</div>

					<div className="grid grid-cols-2 gap-4">
						<div>
							<span className="text-sm font-medium text-muted-foreground">
								Email Verified
							</span>
							<p className="mt-1">
								<Badge variant={user.emailVerified ? "default" : "outline"}>
									{user.emailVerified ? "Verified" : "Not Verified"}
								</Badge>
							</p>
						</div>
						<div>
							<span className="text-sm font-medium text-muted-foreground">
								Status
							</span>
							<p className="mt-1">
								{user.banned ? (
									<Badge variant="destructive">Banned</Badge>
								) : (
									<Badge variant="outline">Active</Badge>
								)}
							</p>
						</div>
					</div>

					{user.banned && user.bannedReason && (
						<div>
							<span className="text-sm font-medium text-muted-foreground">
								Ban Reason
							</span>
							<p className="mt-1 text-sm text-destructive">
								{user.bannedReason}
							</p>
						</div>
					)}

					{user.banned && user.bannedAt && (
						<div>
							<span className="text-sm font-medium text-muted-foreground">
								Banned At
							</span>
							<p className="mt-1 text-sm">
								{new Date(user.bannedAt).toLocaleString()}
							</p>
						</div>
					)}

					<div className="grid grid-cols-2 gap-4">
						<div>
							<span className="text-sm font-medium text-muted-foreground">
								Created At
							</span>
							<p className="mt-1 text-sm">
								{new Date(user.createdAt).toLocaleString()}
							</p>
						</div>
						<div>
							<span className="text-sm font-medium text-muted-foreground">
								Updated At
							</span>
							<p className="mt-1 text-sm">
								{new Date(user.updatedAt).toLocaleString()}
							</p>
						</div>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}
