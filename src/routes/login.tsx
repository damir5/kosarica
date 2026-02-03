import { createFileRoute, redirect } from "@tanstack/react-router";
import { LoginForm } from "@/components/auth/LoginForm";
import { checkSetupRequired, getSession } from "@/lib/auth-server";

export const Route = createFileRoute("/login")({
	validateSearch: (search: Record<string, unknown>) => {
		const redirect =
			typeof search.redirect === "string" ? search.redirect : undefined;
		const safeRedirect =
			redirect?.startsWith("/") && !redirect.startsWith("//")
				? redirect
				: undefined;
		return {
			redirect: safeRedirect,
		};
	},
	beforeLoad: async ({ search }) => {
		// Redirect to setup if no users exist
		const needsSetup = await checkSetupRequired();
		if (needsSetup) {
			throw redirect({ to: "/setup" as const });
		}

		// Redirect to home if already logged in
		const session = await getSession();
		if (session) {
			throw redirect({ to: search.redirect ?? "/" });
		}
	},
	component: LoginPage,
});

function LoginPage() {
	return (
		<div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-zinc-900 to-black p-4">
			<LoginForm />
		</div>
	);
}
