# Calibration des affinités dans Découvertes

## Défaut observé

`buildAffinity()` convertit les notes numériques autour du point neutre 6, conserve les demi-points et prend la moyenne des évaluations disponibles pour chaque film. Les appréciations qualitatives reconnues ont leur propre échelle. Les favoris spontanés, films mémorables et envies de revoir ajoutent respectivement 0,45, 0,25 et 0,20. Chaque trait du film reçoit le même signal. Les commentaires libres ne sont pas des entrées.

Dans `affinityDetails()`, la contribution actuelle par trait est `poids × somme / (nombre + 1)`. Les poids sont 2,5, 1, 0,7 et 1,4 pour la réalisation, le genre, le pays et le mot-clé. `rankCandidates()` somme les contributions des genres, pays et réalisateurs ainsi que les trois mots-clés dont la contribution absolue est la plus élevée. Cette limite empêche un nombre illimité de termes de contribuer, mais offre davantage de chances de remplir les trois places aux fiches riches. Trois mots-clés peuvent peser autant que 4,2 fois un signal moyen. Un terme fréquent peut disposer de nombreux exemples et produire un score élevé même s’il discrimine peu les films.

Découvertes écrête cette somme à ±4. L’indice `evidence` ne conserve que les contributions positives supérieures à 0,08, les atténue au plus de moitié selon leur fréquence dans le pool admissible, puis écrête la somme à 2. « Vos affinités » combine `fit + 0,65 × evidence`, d’où le plafond simultané à 5,3. Sur l’instantané local, les huit films retenus avaient huit sommes brutes différentes, de 4,55 à 7,41, mais partageaient ce même score de base. Le total brut classait donc déjà les films différemment. Relever le plafond laisserait en place le poids des mots-clés et leur sélection par ordre de contribution absolue. Sur le pool local, ce budget a omis 12 contributions négatives de mots-clés, dont deux pour les films sélectionnés. Le profil peut aussi opposer des retours positifs et négatifs au sein d’un même trait, qui se compensent dans la moyenne.

À score égal, les catégories de pertinence, la pénalité de similarité, les sélections des autres modes, la rotation et le départage par graine influencent la liste. La rotation s’applique aux candidats du meilleur niveau de pertinence et à 0,48 point au plus du meilleur score ajusté s’il y a un historique récent. La diversité pénalise le recoupement avec le film déjà sélectionné le plus similaire selon le genre, la réalisation, la production et la décennie. Cette expérimentation conserve ces règles et leurs coefficients.

## Protocole `discovery-calibration-v1`

| Configuration | Affinités | Préférences explicites |
| --- | --- | --- |
| A | Actuelles | Désactivées |
| B | Actuelles | Activées |
| C | Calibrées | Désactivées |
| D | Calibrées | Activées |

Pour C et D, la contribution d’un trait unique est :

```text
poids × somme des signaux / (n signaux + 2)
      × (1 − films portant le trait / films au catalogue)
      / nombre de traits de la même famille renseignés sur la fiche
```

Les poids existants restent la référence. La régularisation correspond à deux observations neutres. Un seul retour compte pour un tiers de son intensité avant fréquence et taille de famille. L’accumulation de termes ne peut plus augmenter le budget d’une famille. Les termes sans retour comptent au dénominateur, ce qui pénalise les fiches denses dont peu de traits concordent. Une famille manquante reste neutre. Le facteur de fréquence élimine un trait ubiquitaire et ne surpondère jamais un trait rare. Les fréquences sont non supervisées et calculées sur le catalogue complet de l’instantané. Toutes les contributions signées renseignées sont comptées. Le lissage est symétrique et des avis contradictoires peuvent se compenser. En présence d’une majorité d’avis positifs, aucun total négatif n’est garanti.

Pour la somme brute `r`, `fit = 4 × tanh(r / 4)` et `evidence = 2 × tanh(max(0, r) / 2)`. Les échelles historiques 4 et 2 servent d’asymptotes. Le bonus utilise le signal net pour éviter de redonner du crédit à un candidat dont les contributions négatives annulent les positives. L’indice d’évidence reste une fonction du même signal que le fit et ne constitue pas une mesure indépendante de confiance. Les trois modes réutilisent leurs formules de base existantes.

B et D retirent un cran de préférence existant (0,9 point ajusté) aux productions dont les pays contiennent `IN`, y compris les coproductions. À partir d’un premier film de 1960–1979 dont les pays connus n’incluent ni `FR` ni `US`, le même coût s’applique aux films suivants de ce groupe. Les deux coûts peuvent se cumuler. Une coproduction française ou américaine est exemptée du coût de période. L’absence de pays ou d’année ne déclenche pas le coût de période, et la langue originale n’intervient pas. Le maximum d’un sur huit est une cible souple. Un avantage de pertinence ou une offre insuffisante peut produire des exceptions. Ces coûts s’appliquent après le niveau de pertinence et avant la rotation, ce qui conserve l’admissibilité des films. Les deux règles peuvent être désactivées séparément.

## Mesures

Les quatre configurations utilisent le même instantané, la même politique de contenu, les mêmes exclusions, la même date, le même historique et la même graine à chaque comparaison. Le renouvellement est mesuré à historique commun (liste A précédente) et à historique propre à chaque configuration. Dans les deux cas, la seconde visite utilise le suffixe de graine `:next`. Les nombres ci-dessous proviennent de la graine `calibration-1` sauf indication contraire. Les parts par famille sont calculées sur la somme des valeurs absolues des contributions.

### Fixture fictive

86 films, 22 films sources de signaux, 60 candidats admissibles.

| « Vos affinités » | A | B | C | D |
| --- | ---: | ---: | ---: | ---: |
| Fit saturé parmi les candidats | 24/60 | 24/60 | 0/60 | 0/60 |
| Fit / evidence saturés dans la liste | 8 / 8 | 7 / 8 | 0 / 0 | 0 / 0 |
| Scores de base distincts dans la liste | 1 | 2 | 5 | 5 |
| Part absolue mots-clés dans le pool | 47,5 % | 47,5 % | 22,7 % | 22,7 % |
| Productions indiennes dans la liste | 3 | 0 | 3 | 0 |
| Productions 1960–1979 hors France et États-Unis dans la liste | 1 | 1 | 4 | 1 |
| Réalisateurs / pays / décennies dans la liste | 3 / 4 / 5 | 4 / 4 / 6 | 1 / 4 / 3 | 2 / 3 / 5 |
| Renouvelés sur historique propre | 8 | 8 | 6 | 5 |
| Recall@8 (13 cibles admissibles) | 7/13 | 4/13 | 6/13 | 6/13 |
| NDCG@8 | 0,272 | 0,172 | 0,318 | 0,249 |

Sur les trois graines et les trois modes, B et D ont au plus un film de la période visée par liste et aucune production indienne. Le test de forte pertinence couvre des exceptions, que cette fixture de comparaison ne déclenche pas. La mesure hors échantillon varie avec la graine. A retrouve entre 2 et 7 films sur 13, et C entre 3 et 7. B retrouve entre 1 et 4 cibles, ce qui signale un coût possible des préférences explicites sur la récupération historique.

### Instantané privé du 23 novembre 2026

667 films, 138 films sources de signaux, 457 candidats admissibles. Cet instantané diffère de l’export de huit films cité dans la demande. Seuls des agrégats sont publiés.

| « Vos affinités » | A | B | C | D |
| --- | ---: | ---: | ---: | ---: |
| Fit saturé parmi les candidats | 251/457 | 251/457 | 0/457 | 0/457 |
| Evidence saturée parmi les candidats | 330/457 | 330/457 | 0/457 | 0/457 |
| Scores de base distincts dans le pool | 166 | 166 | 420 | 420 |
| Écart-type du score de base dans le pool | 1,63 | 1,63 | 0,68 | 0,68 |
| Scores de base distincts dans la liste | 1 | 1 | 8 | 8 |
| Écart-type du score de base dans la liste | 0,00 | 0,00 | 0,39 | 0,39 |
| Part absolue mots-clés dans la liste | 54,8 % | 54,8 % | 11,8 % | 11,8 % |
| Part absolue réalisation dans la liste | 5,6 % | 5,6 % | 59,8 % | 59,8 % |
| Genres / réalisateurs / pays / décennies | 11 / 8 / 10 / 5 | 11 / 8 / 10 / 5 | 8 / 6 / 4 / 5 | 8 / 6 / 4 / 5 |
| Renouvelés sur historique propre | 8 | 8 | 4 | 4 |
| Recall@8 (13 cibles admissibles sur 15) | 0/13 | 0/13 | 4/13 | 4/13 |
| NDCG@8 | 0,000 | 0,000 | 0,159 | 0,159 |

A et C n’ont partagé aucun film dans « Vos affinités » pour les trois graines. Quand seule la graine change, C conserve 7 à 8 films sur 8 par rapport à la première graine, contre 1 sur 8 pour A. Lors d’une véritable rotation simulée, C renouvelle 4 sur 8 dans ce mode à chaque graine. Dans les deux autres modes, C renouvelle 8 sur 8 contre 7 sur 8 pour A. L’étendue des genres et pays dans « Vos affinités » diminue avec C et D. La baisse du poids des mots-clés laisse davantage de place aux réalisateurs, qui dominent la liste C de cet instantané. La part des mots-clés sur le pool passe de 45,6 % à 18,2 %. Aucun candidat local n’a de fit net négatif dans les deux modèles, malgré des contributions négatives individuelles. La fixture fournit le cas d’un fit net négatif.

Le pool contenait huit productions indiennes et quatre films concernés par la préférence de période. Parmi les neuf listes initiales A (trois graines, trois modes), un seul film indien apparaît, en « Vos affinités », et B l’écarte. Toutes les listes locales respectaient déjà la cible de période. La fixture est donc plus informative sur l’action des préférences, tandis que leur effet sur la variété ou l’intérêt réel à long terme reste à observer.

### Validation hors échantillon

On retient les films dont la moyenne des notes numériques est d’au moins 8, demi-points inclus. On répartit leurs identifiants par ordre de hash dans cinq plis déterministes. Par pli, les cibles perdent tous leurs signaux personnels et leur statut vu ordinaire pour ce classement. Les exclusions explicites et la politique de qualité restent actives. La couverture compte les cibles encore admissibles. Les métadonnées du film restent dans la fréquence de catalogue, car elles sont disponibles au moment de la recommandation. Le cutoff est huit, la pertinence binaire et le NDCG moyen porte sur les plis avec au moins une cible éligible. Sous dix cibles potentielles, le rapport laisse les métriques indéfinies. Dix est un seuil de publication descriptif, insuffisant à lui seul pour valider un modèle.

Sur les trois graines locales, A retrouve 0 à 1 cible et C retrouve 4 cibles dans chaque exécution. Il s’agit des mêmes plis et de trajectoires de départage différentes, donc les graines ne constituent pas des observations indépendantes. Le nombre de cibles est faible, les notes historiques sont biaisées par les films choisis et une partie des préférences explicites vise précisément à s’écarter de cet historique.

## Décision et vote

Conserver A comme défaut de production. La variante C départage mieux le haut du classement sur cet instantané et mérite un essai à l’aveugle. D permet de tester l’apport des préférences exprimées. La contraction de la diversité et le renouvellement de seulement quatre films sur huit dans « Vos affinités » empêchent de recommander une activation générale sur ces chiffres. Comparer l’envie de voir, les refus et les films déjà vus sur plusieurs sessions avec des graines différentes avant toute promotion. Les rangs et métadonnées des films peuvent varier d’un bras à l’autre. Le mode de vote évite les doublons par appariement, favorise les rangs élevés parmi les affectations possibles et affiche la couverture réellement obtenue. Un film proposé par plusieurs bras ne constitue pas plusieurs observations indépendantes.

## Reproduire

```sh
node scripts/calibrate-affinity.mjs \
  --seed calibration-1 --seed calibration-2 --seed calibration-3
```

Pour un profil local, fournir un instantané SQLite ou le fichier local indiqué ci-dessous. La commande utilise une copie temporaire incluant le WAL si nécessaire, ouvre la copie en lecture seule et récupère l’historique et les exclusions de Découvertes. Utiliser le même instantané pour répliquer exactement les résultats. Le JSON contient des titres qui reflètent le profil. Stocker les sorties privées hors du dépôt.

```sh
(
  umask 077
  node scripts/calibrate-affinity.mjs \
    --sqlite "$HOME/Library/Application Support/After Dark/after-dark.sqlite" \
    --date 2026-11-23 --seed calibration-1 --seed calibration-2 --seed calibration-3 \
    > "$HOME/after-dark-calibration.json"
)
```

Ajouter `--no-less-indian-cinema` ou `--no-prefer-fr-us-1960-1979` pour désactiver une préférence dans B et D. Avec `--blind affinities` (ou `gems`, `offbeat`), fournir une seule graine. Les cartes et les questions s’affichent dans le terminal, puis le bilan JSON révèle les bras et leurs rangs après le dernier vote. Taper `q` abandonne sans bilan. Les votes ne sont écrits dans aucune base. Les préférences ne s’activent que dans les expériences B et D. Aucune migration ou modification des notes, sessions et explorations existantes.
