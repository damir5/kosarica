import { createFileRoute } from "@tanstack/react-router";

import { PageContainer, Section } from "@/components/public/layout";
import { Heading, Text } from "@/components/public/primitives";

export const Route = createFileRoute("/_public/privacy")({
	head: () => ({
		meta: [{ title: "Privatnost | Tvoja Košarica" }],
	}),
	component: PrivacyPage,
});

function PrivacyPage() {
	return (
		<PageContainer>
			<Section spacing="hero">
				<Heading level={1} size="xl">
					Pravila privatnosti
				</Heading>
				<Text className="mt-4 text-tk-text-secondary max-w-2xl">
					Zadnja izmjena: veljača 2025.
				</Text>
			</Section>

			<div className="space-y-8 pb-8 max-w-2xl">
				<div>
					<Heading level={2} size="lg" className="mb-2">
						Prikupljanje podataka
					</Heading>
					<Text className="text-tk-text-secondary">
						Tvoja Košarica prikuplja minimalne podatke potrebne za rad
						aplikacije. Kada kreiraš korisnički račun, spremamo tvoju
						e-mail adresu i postavke alarma. Ne prikupljamo osobne podatke
						poput imena, adrese ili podataka o plaćanju.
					</Text>
				</div>

				<div>
					<Heading level={2} size="lg" className="mb-2">
						Kolačići i lokacija
					</Heading>
					<Text className="text-tk-text-secondary">
						Koristimo tehničke kolačiće potrebne za prijavu i rad aplikacije.
						Ako dozvoliš pristup lokaciji, koristimo je isključivo za prikaz
						najbližih trgovina. Lokacija se ne sprema na naše poslužitelje.
					</Text>
				</div>

				<div>
					<Heading level={2} size="lg" className="mb-2">
						Analitika
					</Heading>
					<Text className="text-tk-text-secondary">
						Za poboljšanje korisničkog iskustva koristimo anonimiziranu
						analitiku koja ne prati pojedinačne korisnike niti koristi
						kolačiće trećih strana.
					</Text>
				</div>

				<div>
					<Heading level={2} size="lg" className="mb-2">
						Dijeljenje podataka
					</Heading>
					<Text className="text-tk-text-secondary">
						Ne prodajemo, ne dijelimo i ne prosljeđujemo tvoje osobne
						podatke trećim stranama. Podaci o cijenama koje prikazujemo
						javno su dostupni i prikupljeni iz javnih izvora.
					</Text>
				</div>

				<div>
					<Heading level={2} size="lg" className="mb-2">
						Tvoja prava
					</Heading>
					<Text className="text-tk-text-secondary">
						U svakom trenutku možeš zatražiti uvid, ispravak ili brisanje
						svojih podataka. Za sve upite vezane uz privatnost obrati nam se
						na{" "}
						<a
							href="mailto:info@tvojakosarica.hr"
							className="text-tk-accent hover:underline"
						>
							info@tvojakosarica.hr
						</a>
						.
					</Text>
				</div>
			</div>
		</PageContainer>
	);
}
