"use client";

import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";

import { getSession } from "@/lib/auth-server";
import { useSession, signOut } from "@/lib/auth-client";
import { PageContainer, Section } from "@/components/public/layout";
import {
	Heading,
	Text,
	TkButton,
	TkCard,
	TkCardContent,
	TkSkeleton,
} from "@/components/public/primitives";
import { ThemeToggle } from "@/components/public/domain";

export const Route = createFileRoute("/_public/profile")({
	beforeLoad: async ({ location }) => {
		const session = await getSession();
		if (!session) {
			throw redirect({
				to: "/login",
				search: { redirect: location.pathname },
			});
		}
	},
	head: () => ({
		meta: [{ title: "Profil | Tvoja Košarica" }],
	}),
	component: ProfilePage,
});

function ProfilePage() {
	const navigate = useNavigate();
	const { data: session, isPending } = useSession();

	const handleSignOut = async () => {
		await signOut();
		navigate({ to: "/" });
	};

	if (isPending) {
		return (
			<PageContainer>
				<Heading level={1} size="xl" className="mb-6">
					Profil
				</Heading>
				<TkSkeleton className="h-32 w-full" />
			</PageContainer>
		);
	}

	return (
		<PageContainer>
			<Heading level={1} size="xl" className="mb-6">
				Profil
			</Heading>

			{/* Account info */}
			<Section title="Račun">
				<TkCard>
					<TkCardContent className="pt-4">
						<div className="space-y-3">
							<div>
								<Text variant="caption" className="text-tk-text-secondary">
									Ime
								</Text>
								<Text className="font-medium">
									{session?.user?.name ?? "—"}
								</Text>
							</div>
							<div>
								<Text variant="caption" className="text-tk-text-secondary">
									Email
								</Text>
								<Text className="font-medium">
									{session?.user?.email ?? "—"}
								</Text>
							</div>
						</div>
					</TkCardContent>
				</TkCard>
				<div className="mt-4">
					<TkButton variant="outline" onClick={handleSignOut}>
						Odjava
					</TkButton>
				</div>
			</Section>

			{/* Settings */}
			<Section title="Postavke">
				<TkCard>
					<TkCardContent className="pt-4">
						<div className="flex items-center justify-between">
							<div>
								<Text className="font-medium">Tema</Text>
								<Text variant="caption" className="text-tk-text-secondary">
									Prebaci između svijetle i tamne teme
								</Text>
							</div>
							<ThemeToggle />
						</div>
					</TkCardContent>
				</TkCard>
			</Section>
		</PageContainer>
	);
}
