# Recommandations de séance et pertinence

## Audit et périmètre

Le moteur 1.3.0 pouvait accorder jusqu’à 1,5 point à la faible popularité en mode Surprends-moi et jusqu’à 2 points supplémentaires aux places Pépite. La place Valeur sûre ajoutait l’affinité au classement, même quand aucun candidat ne disposait d’un indice favorable. Le sélecteur remplissait cinq places si le catalogue le permettait. La moyenne et le volume de votes TMDB servaient déjà à l’acquisition via Discover, mais le moteur local ne les lisait pas. La lecture SQLite joignait les statuts et les évaluations, en omettant le refus explicite de `movie_feedback`.

Le moteur de séance 1.4.0 lit désormais le refus et la confirmation de visionnage. Les statuts et les évaluations historiques restent inchangés. Une confirmation sans note ni autre signal explicite reste sans contribution d’affinité. Un favori explicite reste un signal indépendant. Les catégories historiques restent dans le contrat IPC et n’ajoutent aucun bonus. Le Laboratoire conserve la politique de classement 1.3.0 et les explorations Découvertes conservent leur propre politique. Le refus explicite est aussi disponible dans les entrées partagées.

## Acquisition et seuils

- Les trois requêtes principales commencent en 1970. La recherche ciblée alterne les décennies, de 1970 à la décennie en cours. Une quatrième requête s’ajoute une fois sur quatre, alterne 1900–1949, 1950–1959 et 1960–1969 et ne fournit que deux candidats à la fois. Toutes les requêtes partagent le plafond de 18 recherches de détails par séance.
- Les détails TMDB stockent la moyenne brute et le nombre de votes ensemble dans le cache JSON SQLite. Les fiches déjà en cache reçoivent ces champs à leur prochain enrichissement réussi. Les métadonnées incomplètes ou invalides peuvent toujours être utilisées pour les autres champs. Aucun rafraîchissement global ni migration.
- La contribution communautaire vaut `1,5 × (moyenne − 6,5) × votes / (votes + 50)`, bornée entre −3 et +3. Sans moyenne valide ni volume positif, elle vaut zéro. Le point neutre 6,5 est une convention de classement. À 50 votes, le moteur retient la moitié de l’écart à ce point, ce qui limite l’effet des tout petits échantillons. Le classement retient 65 % de la contribution positive, soit au plus 1,95 point. Une affinité de 1,25 vaut à elle seule 2 points. La contribution négative garde son poids. Le seuil d’admissibilité continue de lire la contribution entière, ce qui conserve la possibilité de proposer un film étayé lorsque le profil est peu renseigné.
- Pour être proposé, un film doit obtenir au moins 1,5 au score de base et présenter un indice autonome. Il faut une affinité d’au moins 1 sur l’échelle existante de −4 à +4, un indice d’humeur de poids au moins 2 (équivalent à un genre compatible), ou une contribution communautaire d’au moins 1,5. Un seul genre issu d’une seule note maximale ne suffit pas à ouvrir la voie de l’affinité. Les préférences souples aident à trier mais ne suffisent pas seules. Le seuil total permet aux signaux défavorables de contrebalancer les indices positifs. Ces seuils sont des garde-fous initiaux.
- La faible popularité ne rapporte plus de points. La diversité conserve la mesure de recoupement existante, avec 20 % de sa pénalité (maximum 0,72). Elle peut départager des scores proches après la première place. L’identifiant local départage les égalités exactes. La sélection s’arrête si le vivier convaincant est épuisé. Les exclusions de contenu, de franchise et d’historique récent restent applicables.

[TMDB Movie Details](https://developer.themoviedb.org/reference/movie-details) · [TMDB Discover Movie](https://developer.themoviedb.org/reference/discover-movie)

## Préférences souples et composition

- Un film daté d’avant 1970 se présente comme exception avec une affinité d’au moins 2 sur 4, ou avec un indice d’humeur d’au moins 2 et une contribution communautaire brute d’au moins 2,5. En Surprends-moi, seule l’affinité ouvre cette exception. Une date manquante reste dans le groupe « Inconnue ».
- La préférence de période retire 0,8 point aux exceptions admissibles, soit la moitié de l’apport d’une affinité de 1. La composition limite la liste à une exception, même si plusieurs films anciens franchissent le seuil. Une pénalité de 0,35 pour une décennie déjà représentée favorise les listes variées lorsque les scores sont proches.
- L’animation reçoit une pénalité de 0,45 au classement. Elle ne change ni l’admissibilité ni la contribution de l’affinité. Un film d’animation peut donc être retenu avec un dossier favorable, même s’il est le seul candidat.
- Les valeurs par défaut sont regroupées dans `tonight-preferences.ts`. Le service de séance et le diagnostic acceptent les mêmes préférences typées. Le choix de période peut être désactivé et les pénalités mises à zéro. L’UI et le stockage des préférences personnelles restent hors de cette PR.

## Avant / après reproductible

Le diagnostic compare la première version de la PR #21 à sa révision. Le catalogue, l’historique récent, les filtres et les signaux sont identiques à l’intérieur de chaque comparaison.

```sh
npm run diagnose -- --input docs/engine-diagnostics/period-fixture.json \
  --reference-date 2026-11-23 --compare-pr21 --output /tmp/after-dark-pr21-warm

node -e 'const fs = require("node:fs"); const f = require("./docs/engine-diagnostics/period-fixture.json"); fs.writeFileSync("/tmp/after-dark-pr21-cold.json", JSON.stringify({...f, signals: []}));'
npm run diagnose -- --input /tmp/after-dark-pr21-cold.json \
  --reference-date 2026-11-23 --compare-pr21 --output /tmp/after-dark-pr21-cold
```

Choisir des répertoires de sortie neufs. Chaque diagnostic produit un rapport HTML et les données JSON, avec les candidats après historique, les films admissibles avant composition et les propositions finales par décennie. `--compare-ranking` reste disponible pour comparer la version révisée au moteur 1.3.0 sur le même vivier.

### Surprends-moi

| Décennie | Candidats dans chaque scénario | Sans signaux, avant → après | Avec signaux, avant → après |
| --- | ---: | ---: | ---: |
| 1940 | 1 | 1 → 0 | 1 → 0 |
| 1950 | 1 | 1 → 0 | 1 → 0 |
| 1960 | 1 | 1 → 0 | 1 → 1 |
| 1970 | 1 | 1 → 1 | 1 → 1 |
| 1980 | 1 | 1 → 1 | 0 → 1 |
| 1990 | 1 | 0 → 1 | 0 → 1 |
| 2000 | 1 | 0 → 0 | 1 → 1 |
| 2020 | 2 | 0 → 2 | 0 → 0 |

Sans historique personnel, les trois classiques plafonnent à 3 points dans la version initiale et occupent les trois premières places. Le nouveau classement retient cinq films de 1970 ou plus récents, dont un film d’animation à la cinquième place. Avec les notes fictives de 8,5 et 9,5, le film de 1965 atteint une affinité de 2,45 grâce au réalisateur, au genre et à un mot-clé communs. Il arrive premier, seul film d’avant 1970 de la liste. Dans un duel entre un film de 1983 à réputation maximale et le film de 2004 sans votes mais avec une affinité de 1,75, le classement s’inverse. La version initiale donne 3 contre 2,8. La révision donne 1,95 contre 2,8.

## Limites et suite de l’évaluation

Les votes TMDB reflètent une communauté et une couverture inégales selon le pays, la période ou la diffusion. Le volume tempère les extrêmes sans corriger ces biais. La première acquisition d’un film rare peut toujours être freinée par les seuils de vote appliqués aux recherches ciblées. Un film sans réputation peut entrer grâce à l’affinité ou à l’humeur. Hors ligne, un petit catalogue faiblement renseigné peut produire très peu de résultats. Le calcul d’affinité existant peut encore saturer et valoriser des traits génériques. L’évolution de la pertinence pour l’utilisateur reste à mesurer en confrontant des sélections à son jugement.

Avec le profil réel, il reste à mesurer le renouvellement par décennie sur plusieurs sessions, la fréquence des exceptions et de l’animation, la taille effective des listes et la part des propositions qui donnent envie. La couverture du cache, les retours réels de TMDB et la fréquence de chaque trait peuvent modifier ces résultats.
