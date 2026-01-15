import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import type { User } from "./UserTable";

interface UserDeleteModalProps {
	user: User | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onConfirm: (userId: string) => Promise<void>;
	isLoading?: boolean;
}

export function UserDeleteModal({
	user,
	open,
	onOpenChange,
	onConfirm,
	isLoading,
}: UserDeleteModalProps) {
	if (!user) return null;

	const handleConfirm = async () => {
		await onConfirm(user.id);
		onOpenChange(false);
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Delete User</DialogTitle>
					<DialogDescription>
						Are you sure you want to delete this user? This action cannot be
						undone.
					</DialogDescription>
				</DialogHeader>
				<div className="py-4">
					<div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
						<p className="text-sm font-medium">{user.name}</p>
						<p className="text-sm text-muted-foreground">{user.email}</p>
					</div>
					<p className="mt-4 text-sm text-muted-foreground">
						Deleting this user will permanently remove their account and all
						associated data, including sessions and passkeys.
					</p>
				</div>
				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button
						variant="destructive"
						onClick={handleConfirm}
						disabled={isLoading}
					>
						{isLoading ? "Deleting..." : "Delete User"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
