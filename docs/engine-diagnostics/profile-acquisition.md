# Acquisition guidée par le profil

PR29 expérimente l’acquisition de candidats pour Sélection. Le classement, les exclusions, les politiques éditoriales et le Laboratoire restent ceux du moteur 1.6.0. Sélection conserve l’acquisition historique. Le comparateur exécute la variante sur des copies temporaires.

## Audit de l’acquisition historique

- Pour moi et les genres utilisent des flux de popularité récente, d’avis favorables par décennie et d’avis avec un plafond de votes. Toutes les quatre recherches, un flux pré-1970 ajoute jusqu’à deux fiches. Les pages 1 à 4 et les périodes sont déterminées par le numéro de séance global, y compris lorsque la catégorie change.
- Cultes interroge le répertoire par nombre de votes puis par note dans une période. Pépites combine faible popularité et bonnes évaluations dans une période, avec un minimum de votes. Ces deux catégories ignoraient les pays et les langues préférés et les sélections de plusieurs langues obligatoires. Une seule langue obligatoire et la durée maximale s’appliquaient déjà à tous les flux.
- Les résultats des pages sont entrelacés et dédupliqués par identifiant TMDB. Le cache des détails est valable 30 jours. Le budget fixe de 18 détails pouvait être consacré à des films déjà vus, refusés, bloqués ou récents. Les films manquant d’indices de pertinence, les incompatibilités éditoriales et les exclusions de contenu apparaissaient seulement au classement.
- Le client conserve son espacement de 250 ms, son délai réseau de cinq secondes, un maximum de trois détails concurrents et le délai de reprise fourni par HTTP 429. Les films en cache restent disponibles sans TMDB. L’import par identifiant fiable et le traitement des correspondances ambiguës restent communs aux deux stratégies.

## Variante

| Étape | Politique |
| --- | --- |
| Signaux | Identifiants de réalisateurs des crédits TMDB avec le rôle Director, et identifiants des mots-clés TMDB. On réutilise la valeur des signaux existants. Il faut au moins deux films associés à un signal positif, davantage de films positifs que négatifs et un soutien net d’au moins 1. |
| Thèmes | Le seuil de fréquence exclut les mots-clés figurant dans plus de 10 % des fiches renseignées. Les libellés génériques relevés lors des audits sont écartés de l’acquisition. Un recouvrement de Jaccard de 75 % des films sources positifs suffit à écarter un thème redondant. Les mots-clés du classement restent intacts. |
| Planification | Deux pages générales au départ. Un flux géographique éventuel et les flux personnalisés occupent les autres places disponibles. La variante parcourt un réalisateur et un mot-clé par séance au maximum, en alternant les sources lorsque la place manque. Chaque page personnalisée transmet jusqu’à quatre résultats. |
| Adaptation | Après le premier passage, jusqu’à neuf détails, le moteur mesure les admissibles après rotation. En dessous de 20, l’acquisition puise dans les pages de réserve et le solde du budget, toujours plafonné à six pages Discover et 18 détails. Le seuil correspond à deux sélections théoriques. Il reste distinct du quota de composition et de l’effet des rotations futures. |
| Persistance | Les identifiants de réalisateurs rejoignent le cache TMDB lors d’une récupération de détails avec crédits. Les anciennes fiches restent utilisables et se complètent au fil des rafraîchissements normaux. Il n’y a aucun rattrapage massif ni rapprochement par nom. |

[TMDB Discover Movie](https://developer.themoviedb.org/reference/discover-movie) propose `with_crew`, `with_keywords`, `with_genres`, `with_origin_country` et `with_original_language`. Les [crédits du film](https://developer.themoviedb.org/reference/movie-credits) permettent de vérifier le rôle de réalisateur. Un candidat issu exclusivement du flux réalisateur doit avoir un crédit de réalisation correspondant. Le pays d’origine de Discover oriente une partie de l’acquisition. Les pays de production des détails restent la source des contraintes strictes, y compris pour les coproductions. Les langues obligatoires passent avant les préférées sur le flux ciblé. Le filtre local reste appliqué à tous les résultats. Tous les flux des cinq catégories de genre conservent le filtre TMDB correspondant.

Les seuils de soutien, de fréquence et de recouvrement limitent le bruit de la recherche. Ils restent expérimentaux et n’encodent pas un degré de pertinence. Les principales limites sont la couverture historique des identifiants, la fréquence fondée sur le catalogue local et les différences de pagination entre catégories et flux.

## Comparer sur une base locale

```sh
npm run diagnose:acquisition -- \
  --sqlite "$HOME/Library/Application Support/After Dark/after-dark.sqlite" \
  --date 2026-11-25 \
  --output "$(mktemp -d)/after-dark-acquisition" \
  --network
```

Sans `--network`, le rapport isole le vivier local et l’effet de la rotation. Avec `--network`, le client lit `tmdb.json` à côté de la base source ou la variable `AFTER_DARK_TMDB_READ_TOKEN` et envoie à TMDB les paramètres Discover et identifiants nécessaires. Le rapport reste local. `--criteria <json>` permet de réutiliser les mêmes contraintes pour les huit catégories.

La commande capture d’abord la base et son WAL, vérifie que la source est stable, puis crée une copie jetable pour chaque catégorie et chaque stratégie. Chaque bras simule deux séances et écrit ses propres fiches et historiques uniquement dans sa copie. Les rapports Markdown et JSON sont créés hors du dépôt avec les permissions `0600`. Ils contiennent des titres et des signaux dérivés du profil. Les deux bras partagent le plafond de 18 détails. L’ancienne acquisition utilise deux à quatre pages Discover et la variante jusqu’à six en fonction du vivier. Le rapport publie les coûts réalisés et les durées.

Consulter séparément le rendement en nouveaux admissibles, le renouvellement, l’affinité des nouveaux films et le coût. Les deux bras partent avec les mêmes films pour leur première séance. Les catalogues et rotations divergent ensuite par construction. Le contrôle de la date et de l’instantané SQLite ne fige pas les résultats réseau ou la latence TMDB. Les tests simulés couvrent le déterminisme sur des réponses fixes.

La variante reste expérimentale. Deux séances et un seul profil peuvent révéler un meilleur usage des requêtes. L’intérêt réel pour les films et le bénéfice durable sur plusieurs rotations restent à établir avant activation.
