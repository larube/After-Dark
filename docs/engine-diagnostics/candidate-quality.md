# Qualité des candidats de séance

## Audit des données

| Source | Données exploitées avant la PR 9A | Données supplémentaires conservées |
| --- | --- | --- |
| Recherche et découverte de films, recherche par identifiant externe | Identité, titres, année dérivée de la date de sortie, contrôle adulte. Les listes TMDB exposent aussi des identifiants de genres, mais le cache utilise les détails. | Aucune. |
| Détail du film | Durée positive, libellés de genres, langue, pays, popularité, affiche et phrase d’aperçu si disponible. | Date principale, statut de sortie, durée brute et identifiants de genres quand renseignés. |
| Sous-réponses du détail | Réalisateurs, libellés de mots-clés, titres alternatifs et années des sorties de types 1 à 3 pour le rapprochement d’identité. | Identifiants des mots-clés quand présents et événements de sortie avec date brute, type et pays. |
| Ancien cache SQLite et imports | Champs normalisés disponibles selon les films. Une année de rapprochement ou de profil peut refléter plusieurs dates. | Le bloc facultatif `metadata.tmdb.data.release` garde la provenance dans l’enveloppe TMDB et les valeurs brutes reçues. Les anciens enregistrements restent lisibles. |

Le type d’une sortie TMDB décrit son canal, de la première à la diffusion TV. La catégorie « film » de l’API et le genre « Téléfilm » ne suffisent pas à établir le format éditorial. L’endpoint de détail et ses sous-réponses étaient déjà appelés ensemble. L’extension JSON fonctionne avec les migrations existantes. Les nouvelles valeurs arrivent au fil des enrichissements et des renouvellements déjà prévus par le cache. [Détails TMDB](https://developer.themoviedb.org/reference/movie-details) · [Mots-clés](https://developer.themoviedb.org/reference/movie-keywords) · [Types de sortie](https://developer.themoviedb.org/reference/movie-release-dates) · [Sous-réponses](https://developer.themoviedb.org/docs/append-to-response)

## Règles

- Les marqueurs de format exacts, comme `concert film`, `filmed play` ou `tv special`, permettent d’écarter les contenus correspondants. Un téléfilm accompagné d’un indice de format épisodique ou dérivé de série est classé comme programme spécial. Plusieurs marqueurs de formats incompatibles produisent une classification incertaine.
- Une durée strictement inférieure à 40 minutes, ou le marqueur explicite de court métrage sans durée connue, écarte le titre de la séance classique. Un court métrage reste dans le catalogue. Un marqueur de court métrage et une durée d’au moins 40 minutes produisent une classification incertaine en l’absence d’un autre format précis.
- Une durée d’au moins 40 minutes sans marqueur de format incompatible permet d’inférer un long métrage, y compris en animation, documentaire et cinéma expérimental. Un téléfilm sans indice de programme spécial et un film à la fiche trop pauvre restent inconnus et passent ce filtre. Le titre et la popularité ne sont pas des indices de classification.
- La date de référence est une date civile UTC. La date principale et les événements de types 1 à 6 fournissent les dates candidates. Si toutes les dates valides sont futures, le film est retiré, sauf si le statut « Released » contredit ces dates. Un événement passé, première comprise, suffit à conserver le film à cette étape. Cela ne renseigne pas sur la disponibilité sur une plateforme ou dans le pays de l’utilisateur.
- La politique s’applique au pool avant le classement. Les films dont le format est écarté peuvent toujours alimenter les affinités depuis leurs notes et favoris. Les évaluations, les commentaires et les séances restent dans leurs tables actuelles.

## Comparer à données constantes

```sh
npm run diagnose -- --input docs/engine-diagnostics/candidate-quality-fixture.json \
  --output "$(mktemp -d)" --reference-date 2026-11-23 --compare-policy

npm run diagnose -- --sqlite "/chemin/vers/after-dark.sqlite" \
  --output "$(mktemp -d)" --reference-date 2026-11-23 --compare-policy
```

`--compare-policy` produit `legacy.json`, `report.json`, `comparison.json` et `report.html`. La référence 1.1.0 emprunte le même chemin de scoring avec le filtre de contenu désactivé. Le relevé historique de la PR 8 vérifie ses scores et ses classements. La commande lit un seul instantané et exécute les onze scénarios ainsi que le holdout avec la même date, les mêmes signaux et les mêmes métadonnées. Une variation de métadonnées change l’empreinte et invalide une comparaison directe. Pour mesurer l’effet du filtre après enrichissement, exécuter les deux politiques de nouveau sur le nouvel instantané, puis lire les deux comparaisons indépendamment.

Les effectifs avant et après la politique précèdent les exclusions par historique. Les causes peuvent se cumuler. La part inconnue divise le nombre d’inconnus du pool admissible par la taille de ce pool. Le holdout conserve les cibles exclues au dénominateur et indique leur motif ainsi que la couverture. Une variation du Recall@5 ou de la NDCG@5 mélange donc les effets de couverture et de classement.

## Résultats

- **Fixture fictive.** Le scénario Surprends-moi passe de 10 à 5 candidats avant historique. Les cinq exclusions couvrent un concert, un spectacle, un programme spécial, un court et une sortie future. Le documentaire, l’animation longue, le film expérimental et la fiche inconnue sont conservés. Dans le holdout, les cibles admissibles passent de 2 à 1. Le Recall@5 passe de 0 à 0,5 et la NDCG@5 de 0 à 0,1934. Ce cas construit sert à vérifier le protocole. [Rapport HTML des onze scénarios](candidate-quality-example/report.html)
- **Instantané local de 478 films, sans enrichissement.** Les six humeurs passent de 343 à 309 candidats avant historique. Le filtre retire 18 courts, 13 concerts, deux spectacles et un programme spécial de ce pool. Il reste 24 candidats inconnus, soit 7,8 % après filtrage contre 7,0 % avant. Quatre des onze sélections changent. Le holdout conserve 13 cibles admissibles sur 13 et les deux métriques restent à zéro.
- **Limite observée.** Les cas Mickey et Royal Albert Hall sortent du pool. Operation Z.E.R.O. reste premier en Immersion sur cet instantané. Son ancien cache indique une animation de 73 minutes classée Téléfilm, sans marqueur de format épisodique. Ce classement reste incertain pour éviter d’écarter les longs métrages d’animation conçus pour la télévision. Les événements et mots-clés sont eux-mêmes incomplets et demandent une validation sur d’autres instantanés.
