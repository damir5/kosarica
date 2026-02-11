import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";

export function LoginForm() {
	const navigate = useNavigate();
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [passkeyAvailable, setPasskeyAvailable] = useState(false);
	const location = useRouterState({ select: (s) => s.location });
	const redirectParam = new URLSearchParams(location.searchStr).get("redirect");
	const redirectTo =
		redirectParam?.startsWith("/") && !redirectParam.startsWith("//")
			? redirectParam
			: "/";

	useEffect(() => {
		if (window?.PublicKeyCredential) {
			const checkPasskey =
				window.PublicKeyCredential.isConditionalMediationAvailable;
			if (checkPasskey) {
				checkPasskey().then((available) => {
					if (available) {
						setPasskeyAvailable(true);
					}
				});
			}
		}
	}, []);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setError(null);
		setLoading(true);

		try {
			const result = await authClient.signIn.email({
				email,
				password,
			});

			if (result.error) {
				throw new Error(result.error.message);
			}

			navigate({ to: redirectTo });
		} catch (err) {
			setError(err instanceof Error ? err.message : "Login failed");
		} finally {
			setLoading(false);
		}
	};

	const handlePasskeyLogin = async () => {
		setError(null);
		setLoading(true);
		try {
			const result = await authClient.signIn.passkey();
			if (result?.error) {
				throw new Error(result.error.message);
			}
			navigate({ to: redirectTo });
		} catch (err) {
			setError(err instanceof Error ? err.message : "Passkey login failed");
		} finally {
			setLoading(false);
		}
	};

	return (
		<div className="w-full max-w-md p-8 rounded-[var(--tk-radius-lg,14px)] bg-tk-surface border border-tk-border shadow-tk-md">
			<h1 className="text-2xl font-bold font-tk-sans text-tk-text mb-6">Sign In</h1>

			<form onSubmit={handleSubmit} className="space-y-4">
				<div>
					<label
						htmlFor="email"
						className="block text-sm font-medium font-tk-sans text-tk-text-secondary mb-1"
					>
						Email
					</label>
					<input
						id="email"
						type="email"
						placeholder="you@example.com"
						value={email}
						onChange={(e) => setEmail(e.target.value)}
						autoComplete="username webauthn"
						className="w-full h-12 px-4 rounded-[var(--tk-radius-md,10px)] bg-tk-surface-alt text-tk-text border border-tk-border placeholder:text-tk-text-tertiary focus:ring-2 focus:ring-tk-accent/50 focus:border-tk-accent focus:outline-none transition-[color,box-shadow,border-color]"
						required
					/>
				</div>

				<div>
					<label
						htmlFor="password"
						className="block text-sm font-medium font-tk-sans text-tk-text-secondary mb-1"
					>
						Password
					</label>
					<input
						id="password"
						type="password"
						placeholder="Your password"
						value={password}
						onChange={(e) => setPassword(e.target.value)}
						autoComplete="current-password"
						className="w-full h-12 px-4 rounded-[var(--tk-radius-md,10px)] bg-tk-surface-alt text-tk-text border border-tk-border placeholder:text-tk-text-tertiary focus:ring-2 focus:ring-tk-accent/50 focus:border-tk-accent focus:outline-none transition-[color,box-shadow,border-color]"
						required
					/>
				</div>

				{error && <p className="text-red-500 text-sm">{error}</p>}

				<button
					type="submit"
					disabled={loading}
					className="w-full h-12 bg-tk-accent hover:bg-tk-accent-hover disabled:opacity-50 disabled:cursor-not-allowed text-tk-accent-foreground font-medium font-tk-sans rounded-[var(--tk-radius-md,10px)] transition-colors shadow-tk-sm"
				>
					{loading ? "Signing in..." : "Sign In"}
				</button>
			</form>

			{passkeyAvailable && (
				<div className="mt-4 pt-4 border-t border-tk-border">
					<button
						type="button"
						onClick={handlePasskeyLogin}
						disabled={loading}
						className="w-full h-12 bg-tk-surface-alt hover:bg-tk-border disabled:opacity-50 disabled:cursor-not-allowed text-tk-text font-medium font-tk-sans rounded-[var(--tk-radius-md,10px)] transition-colors flex items-center justify-center gap-2"
					>
						<span>🔐</span>
						<span>Sign in with Passkey</span>
					</button>
				</div>
			)}
		</div>
	);
}
