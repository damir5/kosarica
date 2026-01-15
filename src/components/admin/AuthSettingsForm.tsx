import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

interface AuthSettings {
	requireEmailVerification: boolean | null;
	minPasswordLength: number | null;
	maxPasswordLength: number | null;
	passkeyEnabled: boolean | null;
}

interface AuthSettingsFormProps {
	settings: AuthSettings | null;
	onSave: (settings: Partial<AuthSettings>) => Promise<void>;
	isLoading?: boolean;
}

export function AuthSettingsForm({
	settings,
	onSave,
	isLoading,
}: AuthSettingsFormProps) {
	const id = useId();
	const minPasswordLengthId = `${id}-minPasswordLength`;
	const maxPasswordLengthId = `${id}-maxPasswordLength`;
	const [requireEmailVerification, setRequireEmailVerification] = useState(
		settings?.requireEmailVerification ?? false,
	);
	const [minPasswordLength, setMinPasswordLength] = useState(
		settings?.minPasswordLength ?? 8,
	);
	const [maxPasswordLength, setMaxPasswordLength] = useState(
		settings?.maxPasswordLength ?? 128,
	);
	const [passkeyEnabled, setPasskeyEnabled] = useState(
		settings?.passkeyEnabled ?? true,
	);

	useEffect(() => {
		if (settings) {
			setRequireEmailVerification(settings.requireEmailVerification ?? false);
			setMinPasswordLength(settings.minPasswordLength ?? 8);
			setMaxPasswordLength(settings.maxPasswordLength ?? 128);
			setPasskeyEnabled(settings.passkeyEnabled ?? true);
		}
	}, [settings]);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		await onSave({
			requireEmailVerification,
			minPasswordLength,
			maxPasswordLength,
			passkeyEnabled,
		});
	};

	return (
		<Card>
			<CardHeader>
				<CardTitle>Authentication Settings</CardTitle>
				<CardDescription>
					Configure password requirements and authentication options.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<form onSubmit={handleSubmit} className="space-y-6">
					<div className="flex items-center justify-between">
						<div>
							<span className="text-sm font-medium">
								Require Email Verification
							</span>
							<p className="text-sm text-muted-foreground">
								Users must verify their email before accessing the app.
							</p>
						</div>
						<Switch
							checked={requireEmailVerification}
							onCheckedChange={setRequireEmailVerification}
						/>
					</div>

					<div className="flex items-center justify-between">
						<div>
							<span className="text-sm font-medium">
								Enable Passkey Authentication
							</span>
							<p className="text-sm text-muted-foreground">
								Allow users to use passkeys for passwordless login.
							</p>
						</div>
						<Switch
							checked={passkeyEnabled}
							onCheckedChange={setPasskeyEnabled}
						/>
					</div>

					<div className="grid grid-cols-2 gap-4">
						<div>
							<label
								htmlFor={minPasswordLengthId}
								className="text-sm font-medium"
							>
								Min Password Length
							</label>
							<Input
								id={minPasswordLengthId}
								type="number"
								className="mt-2"
								value={minPasswordLength}
								onChange={(e) =>
									setMinPasswordLength(parseInt(e.target.value, 10) || 8)
								}
								min={6}
								max={64}
							/>
						</div>
						<div>
							<label
								htmlFor={maxPasswordLengthId}
								className="text-sm font-medium"
							>
								Max Password Length
							</label>
							<Input
								id={maxPasswordLengthId}
								type="number"
								className="mt-2"
								value={maxPasswordLength}
								onChange={(e) =>
									setMaxPasswordLength(parseInt(e.target.value, 10) || 128)
								}
								min={16}
								max={256}
							/>
						</div>
					</div>
					<p className="text-sm text-muted-foreground">
						Password length requirements for new user registrations.
					</p>

					<Button type="submit" disabled={isLoading}>
						{isLoading ? "Saving..." : "Save Changes"}
					</Button>
				</form>
			</CardContent>
		</Card>
	);
}
