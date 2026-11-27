# PR35 — Votre séance personnelle

La [maquette d’origine](../../../After%20Dark_%20Votre%20Se%CC%81ance%20Personnelle.png) associe une caméra dans la navigation, une composition typographique ample et un portrait sur fond sombre. Dans la [PR34](../pr34/README.md), les photographies et les affiches papier donnent déjà une identité forte à la page. Le titre flottait sur une image qui se prolongeait derrière les tuiles, et les trois colonnes à 1160 px comprimaient les actions des alternatives.

Le bandeau délimite désormais la présentation de Sélection. Il reprend le portrait existant, avec un cadrage distinct pour les fenêtres étroites. La caméra et le liseré orange identifient la page dans la navigation. Les huit photographies restent monochromes. La bordure, la coche et le focus clavier distinguent les radios.

La vedette garde son affiche montée sur papier et gagne une marge autour du titre. L’explication et l’avertissement précèdent toujours les actions. Les alternatives passent en deux colonnes à 1160 px, une à 410 px et trois dès 1280 px. Visuels et polices proviennent du dépôt.

## Comparaison Electron

Captures réalisées avec la même fixture SQLite isolée, hors ligne. Un titre a été allongé et son affiche retirée dans la fixture pour vérifier les cas limites. Les préférences de pays, de langue et d’ambiance font apparaître un avertissement réel sur cette alternative.

| Vue | Avant | Après |
| --- | --- | --- |
| Programme · 1160 px | [Capture](programme-avant-1160.jpg) | [Capture](programme-apres-1160.jpg) |
| Programme · 410 px | [Capture](programme-avant-410.jpg) | [Capture](programme-apres-410.jpg) |
| Résultats · 1160 px | [Capture](resultats-avant-1160.jpg) | [Capture](resultats-apres-1160.jpg) |
| Résultats · 410 px | [Capture](resultats-avant-410.jpg) | [Capture](resultats-apres-410.jpg) |

Vérifications Electron à 410, 780, 1160 et 1440 px. Navigation native des radios à la flèche, filtres, affiches chargées et manquantes, Informations, annulation de « Pas ce soir », enregistrement des intentions et du visionnage, épuisement et déblocage des propositions récentes. Le test renderer couvre aussi l’annonce de chargement, l’alerte d’erreur et le message indiquant une sélection incomplète.
