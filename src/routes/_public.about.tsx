import { createFileRoute } from "@tanstack/react-router";

import { PageContainer, Section } from "@/components/public/layout";
import { Heading, Text } from "@/components/public/primitives";
import { STORE_DISPLAY_NAMES } from "@/components/public/domain/store-colors";

export const Route = createFileRoute("/_public/about")({
	head: () => ({
		meta: [{ title: "O nama | Tvoja Košarica" }],
	}),
	component: AboutPage,
});

const stores = Object.values(STORE_DISPLAY_NAMES);

function AboutPage() {
	return (
		<PageContainer>
			<Section spacing="hero">
				<Heading level={1} size="xl">
					O nama
				</Heading>
				<Text className="mt-4 text-tk-text-secondary max-w-2xl">
					Tvoja Košarica je besplatna web-aplikacija koja ti pomaže pronaći
					najpovoljnije cijene namirnica u Hrvatskoj. Uspoređujemo cijene iz{" "}
					{stores.length} trgovačkih lanaca kako bi svaki odlazak u dućan bio
					pametniji.
				</Text>
			</Section>

			<Section title="Kako funkcioniramo?">
				<div className="space-y-4 max-w-2xl">
					<Text className="text-tk-text-secondary">
						Svakodnevno prikupljamo javno dostupne podatke o cijenama iz
						kataloga i web-stranica trgovačkih lanaca. Algoritmi uspoređuju
						proizvode između različitih trgovina te prikazuju najaktualniju
						cijenu za svaki artikl.
					</Text>
					<Text className="text-tk-text-secondary">
						Osim toga, pratimo akcije i popuste te ti šaljemo obavijesti kada
						cijena proizvoda koji te zanima padne ispod željenog iznosa.
					</Text>
				</div>
			</Section>

			<Section title="Podržane trgovine">
				<div className="flex flex-wrap gap-2">
					{stores.map((name) => (
						<span
							key={name}
							className="rounded-full bg-tk-surface-alt px-3 py-1 text-sm text-tk-text-secondary"
						>
							{name}
						</span>
					))}
				</div>
			</Section>

			<Section title="Kontakt">
				<Text className="text-tk-text-secondary max-w-2xl">
					Imaš pitanje, prijedlog ili si primijetio netočnu cijenu? Javi nam
					se na{" "}
					<a
						href="mailto:info@tvojakosarica.hr"
						className="text-tk-accent hover:underline"
					>
						info@tvojakosarica.hr
					</a>
					.
				</Text>
			</Section>
		</PageContainer>
	);
}
