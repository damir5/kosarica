import { createFileRoute, redirect } from "@tanstack/react-router";
import { SetupWizard } from "@/components/auth/SetupWizard";
import { checkSetupRequired } from "@/lib/auth-server";

export const Route = createFileRoute("/setup")({
	beforeLoad: async () => {
		const needsSetup = await checkSetupRequired();
		if (!needsSetup) {
			throw redirect({ to: "/" });
		}
	},
	component: SetupPage,
});

function SetupPage() {
	return (
		<div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-zinc-900 to-black p-4">
			<SetupWizard />
		</div>
	);
}
