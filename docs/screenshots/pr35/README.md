# PR35 — Votre séance personnelle

## Lecture de la maquette

La [maquette originale à la racine du dépôt](../../../After%20Dark_%20Votre%20Se%CC%81ance%20Personnelle.png) a été examinée à sa taille native de 1536 × 1024. Le tableau compare cette composition à la première version de la PR35 et à sa reprise.

| Élément | Maquette originale | Première PR35 | Reprise |
| --- | --- | --- | --- |
| Bandeau | Composition à fond perdu. Le portrait de droite se prolonge derrière les contrôles. Le titre incliné traverse un grand geste orange. | Portrait enfermé dans un bandeau rectangulaire, séparé des tuiles. Le titre reposait sur un trait orange mince. | Le portrait court du titre à la rangée de commandes. Le titre incliné traverse une bande orange irrégulière ancrée au bord gauche. Le texte d’introduction garde ses deux lignes. |
| Catégories | Vignettes verticales inclinées sur une rangée. Photographie chaude en haut, légende condensée centrée en pied. La sélection colore la légende et l’image en rouge. | Deux rangées de tuiles larges, monochromes, légendes alignées à gauche. La bordure et la coche portaient toute la sélection. | Huit vignettes en une rangée à 1160 px, quatre par rangée à 410 px. Photo traitée séparément, pied de carte et sélection rouge, coche et focus clavier visibles. |
| Navigation | Logotype ivoire étroit et incliné, signature cinéphile, pictogrammes au trait, clap sombre dans un aplat orange. Photographie de projection en pied. | Logo bicolore et pictogrammes hétérogènes. L’entrée active utilisait un fond brun avec un liseré. | Lettrage ivoire incliné, signature sur deux lignes, pictogrammes homogènes et clap inscrit dans le bandeau orange actif. Le visuel de projection existant remplace le gros plan en pied. À 410 px, le menu passe en haut et garde son pictogramme Sélection. |
| Films | Ruban papier prolongé d’un filet. Vedette illustrée à gauche avec texte à côté, puis deux cartes à image dominante et titre superposé. | Vedette pleine largeur dans un bloc brun. Alternatives sous la vedette, chacune avec une petite affiche encadrée. | Le bandeau des résultats retrouve le ruban et le filet. À 1160 px, la vedette partage la première rangée avec deux alternatives. Leurs affiches occupent toute la largeur et portent le titre. La vedette conserve une accroche de papier orange en pied. À 410 px, elle précède les alternatives. |

Les huit catégories et leur ordre suivent l’application. « Affiner » reste repliable. Les affiches verticales du catalogue remplacent les illustrations de films de la planche. Les alternatives gardent leurs explications, avertissements et actions sous l’affiche. Le titre d’une affiche manquante apparaît en pied du visuel de remplacement. Les badges de la maquette restent omis, conformément à la présentation actuelle des recommandations. La reprise utilise les assets et polices du dépôt.

## Comparaison Electron

Captures sur le même catalogue de test hors ligne, avec un titre de test volontairement long, un avertissement produit par le moteur et une affiche manquante. Les vues du programme et des résultats sont capturées séparément pour montrer chaque zone à sa taille de rendu.

| Vue | Avant PR35 | Première PR35 | Reprise |
| --- | --- | --- | --- |
| Programme · 1160 px | [Capture](programme-avant-1160.jpg) | [Capture](programme-apres-1160.jpg) | [Capture](reprise-programme-apres-1160.jpg) |
| Programme · 410 px | [Capture](programme-avant-410.jpg) | [Capture](programme-apres-410.jpg) | [Capture](reprise-programme-apres-410.jpg) |
| Résultats · 1160 px | [Capture](resultats-avant-1160.jpg) | [Capture](resultats-apres-1160.jpg) | [Capture](reprise-resultats-apres-1160.jpg) |
| Résultats · 410 px | [Capture](resultats-avant-410.jpg) | [Capture](resultats-apres-410.jpg) | [Capture](reprise-resultats-apres-410.jpg) |

Contrôles Electron à 410, 780, 1160 et 1440 px. Radios natives au clavier, ouverture d’Affiner et d’Informations, « Pas ce soir » et son annulation, intentions, visionnage et rotation. Les tests renderer couvrent également les annonces de chargement, d’échec et de sélection incomplète.
