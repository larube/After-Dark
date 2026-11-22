# Ce soir · Prototype visuel

Ouvrir [index.html](index.html) dans Chrome sur macOS. Le prototype charge ses assets depuis ce dossier et fonctionne sans serveur. Les radios, les listes déroulantes et le panneau de justification permettent d’essayer les contrôles. « Trouve-moi un film » annonce l’humeur sélectionnée et mène à la sélection fixe en gardant les critères saisis. La sélection initiale illustre le résultat d’une séance « Suspense et tension » avec trois films fixes. La navigation sert à juger la composition.

[Capture Chrome à 1160 × 780 px](../../screenshots/prototype-ce-soir-1160.png) · [Capture Chrome à 520 × 1040 px](../../screenshots/prototype-ce-soir-520.png)

## Comparaison avec « After Dark_ Suspense au cinéma.png »

| Élément | Référence, ramenée à 1160 px | Prototype rendu |
| --- | --- | --- |
| Marge et grille | Sidebar de 184 px environ. Les recommandations commencent vers 350 px. | Sidebar de 174 px. Les recommandations commencent vers 356 px. Le bandeau garde six choix sur une rangée et reprend les scènes photographiques de la référence dans six vignettes originales générées pour le prototype. |
| Photographie | La façade lumineuse occupe surtout la moitié droite du haut. Le portrait monochrome prend le bas de la marge. | La marquise monte jusqu’au bord droit et reste visible derrière les cartes d’humeur. Le regard en similigravure réapparaît dans le bas de la sidebar. Les deux recadrages viennent d’un décor généré pour le prototype. |
| Typographie et papier | Le titre incliné occupe environ 350 px. Les lettres sont hautes et étroites. | Le titre sur papier orange et ivoire occupe environ 430 px. Barlow Condensed est plus massif, et la superposition avec le décor commence plus loin vers la droite. La marquise vierge laisse le titre porter la lecture. |
| Film vedette | Environ 61 % de la sélection en largeur. Affiche en collage sépia d’environ 260 × 390 px. | Environ 63 % de la sélection. L’affiche d’environ 235 × 350 px garde sa couleur et son graphisme. Un fond rouge décalé, un bord ivoire et une bande adhésive au bord supérieur donnent trois plans au montage. |
| Propositions secondaires | Deux films empilés avec des affiches d’environ 92 px de large. Une rangée d’actions occupe le bas. | Deux films empilés avec des affiches de 84 px de large, des inclinaisons opposées et un retrait sur le second film. La recherche est placée à droite des filtres comme dans « Votre Séance Personnelle ». |

## Fixtures

Les rôles, résumés courts et raisons forment un exemple de composition. Le prototype est indépendant de React, Electron, IPC, SQLite et des données du profil. La direction artistique du décor suit la référence, et les affiches appartiennent aux films représentés.

- [Prisoners · affiche TMDB](https://image.tmdb.org/t/p/w500/tuZhZ6biFMr5n9YSVuHOJnNL1uU.jpg)
- [Nightcrawler · affiche TMDB](https://image.tmdb.org/t/p/w342/j9HrX8f7GbZQm1BrBiR40uFQZSb.jpg)
- [Under the Skin · affiche du distributeur Diaphana](https://diaphana.fr/wp-content/uploads/2014/03/120x160-under-the-skin_hd.pdf)
- Barlow Condensed et IBM Plex Sans sont chargés localement. Leurs licences OFL accompagnent les polices dans `assets/`.

Captures Chrome sur macOS à un facteur d’échelle de 1. À 520 px, les humeurs passent sur deux rangées, le CTA suit les filtres et les films secondaires passent sous la vedette. Vérification des images, de l’absence de débordement horizontal, des flèches sur les radios et de la soumission avec Entrée à 1160, 520 et 410 px.
