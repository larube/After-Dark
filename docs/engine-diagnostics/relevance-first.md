# Recommandations de séance et pertinence

## Audit et périmètre

Le moteur 1.3.0 pouvait accorder jusqu’à 1,5 point à la faible popularité en mode Surprends-moi et jusqu’à 2 points supplémentaires aux places Pépite. La place Valeur sûre ajoutait l’affinité au classement, même quand aucun candidat ne disposait d’un indice favorable. Le sélecteur remplissait cinq places si le catalogue le permettait. La moyenne et le volume de votes TMDB servaient déjà à l’acquisition via Discover, mais le moteur local ne les lisait pas. La lecture SQLite joignait les statuts et les évaluations, en omettant le refus explicite de `movie_feedback`.

Le moteur de séance 1.4.0 lit désormais le refus et la confirmation de visionnage. Les statuts et les évaluations historiques restent inchangés. Une confirmation sans note ni autre signal explicite reste sans contribution d’affinité. Un favori explicite reste un signal indépendant. Les catégories historiques restent dans le contrat IPC et n’ajoutent aucun bonus. Le Laboratoire conserve la politique de classement 1.3.0 et les explorations Découvertes conservent leur propre politique. Le refus explicite est aussi disponible dans les entrées partagées.

## Acquisition et seuils

- Une quatrième requête Discover alterne 1900–1949, 1950–1959, 1960–1969 et 1970–1979. Elle utilise les critères d’humeur et les contraintes transmissibles des requêtes ciblées existantes. Ses résultats sont entrelacés avec les autres et partagent le plafond existant de 18 recherches de détails par séance.
- Les détails TMDB stockent la moyenne brute et le nombre de votes ensemble dans le cache JSON SQLite. Les fiches déjà en cache reçoivent ces champs à leur prochain enrichissement réussi. Les métadonnées incomplètes ou invalides peuvent toujours être utilisées pour les autres champs. Aucun rafraîchissement global ni migration.
- La contribution communautaire vaut `1,5 × (moyenne − 6,5) × votes / (votes + 50)`, bornée entre −3 et +3. Sans moyenne valide ni volume positif, elle vaut zéro. Le point neutre 6,5 est une convention de classement. À 50 votes, le moteur retient la moitié de l’écart à ce point, ce qui limite l’effet des tout petits échantillons. Même au maximum, la contribution communautaire reste inférieure au maximum de l’affinité personnelle (+6,4) ou de l’humeur (+5,6).
- Pour être proposé, un film doit obtenir au moins 1,5 au score de base et présenter un indice autonome. Il faut une affinité d’au moins 1 sur l’échelle existante de −4 à +4, un indice d’humeur de poids au moins 2 (équivalent à un genre compatible), ou une contribution communautaire d’au moins 1,5. Un seul genre issu d’une seule note maximale ne suffit pas à ouvrir la voie de l’affinité. Les préférences souples aident à trier mais ne suffisent pas seules. Le seuil total permet aux signaux défavorables de contrebalancer les indices positifs. Ces seuils sont des garde-fous initiaux.
- La faible popularité ne rapporte plus de points. La diversité conserve la mesure de recoupement existante, avec 20 % de sa pénalité (maximum 0,72). Elle peut départager des scores proches après la première place. L’identifiant local départage les égalités exactes. La sélection s’arrête si le vivier convaincant est épuisé. Les exclusions de contenu, de franchise et d’historique récent restent applicables.

[TMDB Movie Details](https://developer.themoviedb.org/reference/movie-details) · [TMDB Discover Movie](https://developer.themoviedb.org/reference/discover-movie)

## Avant / après reproductible

```sh
npm run diagnose -- --input docs/engine-diagnostics/relevance-fixture.json \
  --reference-date 2026-11-23 --compare-ranking --output /tmp/after-dark-relevance
```

Le répertoire de sortie doit être neuf. Le diagnostic écrit `legacy.json`, `report.json`, `comparison.json` et `report.html`. Il compare deux classements sur les mêmes métadonnées fictives, les mêmes signaux et la même politique de contenu. Les refus sont honorés des deux côtés pour isoler le changement de classement. Un test SQLite couvre séparément le chemin de production du refus.

| Scénario | Avant · identifiants retenus | Après · identifiants retenus |
| --- | --- | --- |
| Surprends-moi | 2, 3, 1, 4, 5 | 2, 1 |
| Envie de rire | 2, 3, 1, 4, 5 | 2, 3, 1 |
| Suspense et tension | 2, 1, 3, 4, 5 | 1, 2 |
| Étrange, Émotion et Immersion | 2, 3, 1, 4, 5 | 2, 1 |

Le classique fictif de 1963 (#1, 8,5/10 sur 500 votes) obtient 2,727 points en Surprends-moi. Il devient premier lorsqu’on retire les signaux personnels. Le film de niche (#2), dépourvu de votes, obtient 2,800 grâce aux notes de 8,5 et 9,5 de deux films partageant son réalisateur et son genre. La faible popularité du film #3 rapportait 1,485 point en Surprends-moi. Il obtient désormais zéro dans ce scénario mais entre dans Envie de rire grâce à son genre. Le vote unique de 10/10 du film #4 rapporte 0,103 point. La fiche vide (#5) reste à zéro.

Sur les deux seules cibles du holdout fictif, Recall@5 passe de 0,50 à 1,00 et NDCG@5 de 0,215 à 0,500. Les deux films partagent des traits choisis pour exercer ce cas. Ce résultat démontre le comportement de la politique sur une fixture construite.

## Limites et suite de l’évaluation

Les votes TMDB reflètent une communauté et une couverture inégales selon le pays, la période ou la diffusion. Le volume tempère les extrêmes sans corriger ces biais. La première acquisition d’un film rare peut toujours être freinée par les seuils de vote appliqués aux recherches ciblées. Un film sans réputation peut entrer grâce à l’affinité ou à l’humeur. Hors ligne, un petit catalogue faiblement renseigné peut produire très peu de résultats. Le calcul d’affinité existant peut encore saturer et valoriser des traits génériques. L’évolution de la pertinence pour l’utilisateur reste à mesurer en confrontant des sélections à son jugement.
