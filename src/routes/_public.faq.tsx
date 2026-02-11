import { createFileRoute } from "@tanstack/react-router";

import { PageContainer, Section } from "@/components/public/layout";
import { Heading, Text } from "@/components/public/primitives";

export const Route = createFileRoute("/_public/faq")({
	head: () => ({
		meta: [{ title: "FAQ | Tvoja Košarica" }],
	}),
	component: FaqPage,
});

const faqs = [
	{
		question: "Odakle dolaze podaci o cijenama?",
		answer:
			"Cijene prikupljamo iz javno dostupnih kataloga i web-stranica trgovačkih lanaca. Podaci se ažuriraju svakodnevno kako bi bili što točniji.",
	},
	{
		question: "Je li Tvoja Košarica besplatna?",
		answer:
			"Da, aplikacija je potpuno besplatna za korištenje. Ne naplaćujemo pristup niti prikazujemo oglase.",
	},
	{
		question: "Kako mogu postaviti alarm za cijenu?",
		answer:
			"Pronađi željeni proizvod putem pretraživanja, otvori stranicu proizvoda i klikni na \"Postavi alarm\". Odaberi ciljanu cijenu i obavijestit ćemo te kada cijena padne ispod tog iznosa.",
	},
	{
		question: "Cijena na stranici ne odgovara cijeni u trgovini. Što da napravim?",
		answer:
			"Cijene se mogu razlikovati ovisno o lokaciji i trenutnim akcijama u pojedinoj poslovnici. Ako primijećuješ stalnu netočnost, javi nam se na info@tvojakosarica.hr kako bismo to ispravili.",
	},
	{
		question: "Koje trgovine pokrivate?",
		answer:
			"Trenutno pokrivamo 11 trgovačkih lanaca u Hrvatskoj: Konzum, Lidl, Plodine, Kaufland, Spar, Studenac, Eurospin, Tommy, KTC, DM i Interspar. Redovito radimo na dodavanju novih.",
	},
];

function FaqPage() {
	return (
		<PageContainer>
			<Section spacing="hero">
				<Heading level={1} size="xl">
					Često postavljana pitanja
				</Heading>
				<Text className="mt-4 text-tk-text-secondary max-w-2xl">
					Odgovori na najčešća pitanja o korištenju Tvoje Košarice.
				</Text>
			</Section>

			<div className="space-y-6 pb-8 max-w-2xl">
				{faqs.map((faq) => (
					<div key={faq.question}>
						<Heading level={3} size="md" className="mb-2">
							{faq.question}
						</Heading>
						<Text className="text-tk-text-secondary">{faq.answer}</Text>
					</div>
				))}
			</div>
		</PageContainer>
	);
}
