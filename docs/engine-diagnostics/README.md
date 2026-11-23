# Diagnostic du moteur

Depuis la racine du dépôt, avec Node 22.13 ou plus et les dépendances du projet installées.

```sh
npm run diagnose -- --input docs/engine-diagnostics/fixture.json --output "$(mktemp -d)"
npm run diagnose -- --input docs/engine-diagnostics/candidate-quality-fixture.json --output "$(mktemp -d)" \
  --reference-date 2026-11-23 --compare-policy
```

Ouvrir `report.html` dans un navigateur. Les tableaux, les ancres et les sections dépliables fonctionnent hors ligne. `report.json` conserve les valeurs numériques sans arrondi d’affichage. Avec `--baseline`, le HTML ajoute la comparaison et la commande écrit aussi `comparison.json`. Utiliser un répertoire neuf ou vide. La commande refuse d’écraser les fichiers existants.

[Exemple comparatif PR 9A](candidate-quality-example/report.html) · [Politique de séance et résultats](candidate-quality.md) · [Archives PR 8 HTML](example/report.html) et [JSON](example/report.json) · [Observations de la PR 8](findings.md)

## Profil SQLite local

Quitter After Dark avant de lire son profil pour obtenir une vue cohérente. Donner le chemin de `after-dark.sqlite` dans le dossier de données utilisé par l’application.

```sh
npm run diagnose -- --sqlite "/chemin/vers/after-dark.sqlite" --output "$(mktemp -d)"
```

La commande copie le fichier principal et son éventuel journal WAL dans un dossier temporaire privé. Elle vérifie que ces fichiers sources sont stables pendant la copie, interroge uniquement la copie en mode `query_only`, puis la supprime. Elle réutilise la lecture de catalogue et d’historique de la production sans migration, écriture d’historique, enrichissement TMDB ou lecture de la configuration et du jeton. Une base doit déjà être au format actuel de l’application. Les rapports d’un profil SQLite doivent être écrits hors du dépôt. Le JSON et le HTML affichent des données privées, dont des titres et notes de l’échantillon. Garder les rapports et les éventuels jeux de données dérivés en local.

## Règles de scoring depuis le moteur 1.1.0

| Mécanisme | Calcul en production | Limite |
| --- | --- | --- |
| Catalogue | SQLite écarte les identifiants de démonstration. Toute évaluation enregistrée fait traiter le film comme vu lors de la lecture du catalogue. | Le diagnostic utilise le cache local. En ligne, la production peut découvrir ou enrichir des titres avant de lancer le moteur. |
| Éligibilité | Exclut les films vus. Un filtre strict exige au moins un pays de production ou une langue originale de la liste correspondante. Chaque filtre actif doit passer. La durée doit être connue et inférieure ou égale au maximum demandé. | Une valeur manquante échoue au filtre actif. Un film peut cumuler plusieurs causes. Une langue originale est une valeur unique par film. |
| Politique de séance (1.2.0) | Applique la classification et les dates au pool admissible avant le classement. | Les cas ambigus sont conservés. Voir [la politique](candidate-quality.md). |
| Historique | Les identifiants des 15 dernières lignes de recommandation, triées par séance décroissante puis rang croissant, sont retirés après éligibilité. Le diagnostic utilise le même ensemble pour chaque scénario. | La répétition d’un identifiant compte plusieurs lignes dans la fenêtre. Une petite sélection peut être épuisée. Une demande autorisant les propositions récentes en production équivaut à un historique vide. |
| Vote personnel | Pour une note numérique `n`, le vote est `(n − 6) / 4` à partir de 6 et `(n − 6) / 6` en dessous. Les appréciations reconnues détesté, bof, bien, beaucoup aimé et adoré valent respectivement −1, −0,65, 0,25, 0,7 et 1. Les votes reconnus sont moyennés par film, puis les favoris spontané, mémorable et à revoir ajoutent 0,45, 0,25 et 0,2. | Les films sans vote reconnu ou favori ne contribuent pas. Un texte libre ne donne aucun vote en dehors du lexique. Pas de pondération par date ou provenance des évaluations. |
| Traits et affinité | Un film source compte au plus une fois pour chaque trait normalisé. Pour un candidat, chaque contribution vaut `somme des votes par film / (nombre de films sources + 1) × poids`. Poids de 2,5 pour le réalisateur, 1 pour le genre, 0,7 pour le pays et 1,4 pour le mot-clé. La somme est bornée à ±4, puis multipliée par 1,6 dans le score de base. | Dépend du vocabulaire des métadonnées. Les traits positifs et négatifs peuvent se compenser ou atteindre le plafond. Les explications de production ne montrent qu’une partie des traits qui ont contribué. |
| Humeurs et ambiance évitée | Lexiques fixes du domaine. Deux points par genre reconnu, trois par mot-clé reconnu, plafonnés à quatre. Coefficient de 1,4 pour l’humeur demandée et −1,5 pour l’ambiance évitée. Surprends-moi laisse la composante d’humeur à zéro. | Un genre et un mot-clé suffisent à saturer la composante. Une ambiance évitée est une préférence souple. Les champs manquants n’apportent aucun indice. |
| Pays et langue préférés | +1,4 pour au moins un pays préféré, +1,2 pour une langue originale préférée. | Plusieurs pays correspondants ne cumulent pas de bonus. |
| Énergie héritée | En mode faible énergie, +0,7 jusqu’à 100 minutes et −0,7 au-delà de 135 minutes. | Le contrôle n’est plus dans le renderer. Le moteur accepte encore ce champ. |
| Exploration | Avec une popularité TMDB `p`, l’indice vaut `1 / (1 + p / 10)`, ou zéro si elle manque. Le score de base l’utilise avec un coefficient de 1,5 pour Surprends-moi et de 0,5 ailleurs. | Échelle absolue de TMDB, sensible à la fraîcheur des données. La popularité ne mesure ni la qualité ni la rareté historique. |
| Diversité | Pour chaque film déjà choisi, divise le nombre de traits communs par la taille du plus petit ensemble de traits, avec un dénominateur d’au moins 1. Multiplie par 3 et ajoute 0,6 si la langue est connue et identique. Retient la plus grande pénalité parmi les comparaisons. | Sélection gloutonne. Une fiche pauvre peut recouper tous ses traits avec un autre film. Un seul voisin suffit à fixer la pénalité. |
| Catégories | Ordre Valeur sûre, Pépite, Wildcard, Valeur sûre, Pépite. Le score d’un emplacement vaut score de base moins pénalité de diversité, plus bonus. Bonus de l’affinité bornée pour Valeur sûre, du double de l’indice d’exploration pour Pépite, et de −0,6 fois l’affinité positive pour Wildcard. Départage par identifiant croissant. | Les catégories imposent un ordre de choix. Elles ne certifient ni l’appréciation ni la découverte d’un film. Si le catalogue autorisé est trop petit, la sélection contient moins de cinq films. |

Le rapport distingue le rang de base, le rang par emplacement et la position de sélection. L’ordre du rang de base est descriptif. Le moteur décide sur chaque classement par emplacement. Les compteurs d’exclusion s’appliquent à tout le catalogue et peuvent se cumuler. Le nombre « écartés à cette étape » compte uniquement les films récents qui passaient l’éligibilité. La diversité décrit les valeurs distinctes, les métadonnées manquantes et les intersections par paire. Pour la découverte, « sous la médiane » signifie strictement sous la médiane des valeurs TMDB présentes dans ce catalogue.

## Protocole hors échantillon

`evaluateHoldout()` exécute déjà le moteur avec les signaux des films retenus retirés, leurs statuts neutralisés et un historique entièrement vide. Son rang est une position parmi les cinq propositions. Le rapport partage la préparation des candidats et ajoute un protocole documenté.

1. Un film est apprécié si sa moyenne arithmétique des notes numériques valides atteint 8/10. Les notes manuelles et historiques sont traitées comme elles le sont par la lecture SQLite de production, y compris les demi-points et le milieu exact de chaque intervalle historique. Les appréciations qualitatives et les favoris n’établissent pas la pertinence de test. Les signaux des autres films restent disponibles pour l’apprentissage.
2. Les cibles sont triées par SHA-256 d’un identifiant versionné et distribuées en rotation dans un maximum de cinq échantillons disjoints, sans échantillon vide. Chaque tirage retire **tous** les signaux des films retenus, y compris chaque note, appréciation et favori. Le statut de ces films devient inconnu et leurs identifiants sont retirés de l’historique pour neutraliser ces deux causes. La politique de séance peut encore les exclure. Les rapports indiquent la couverture et les causes. Les cibles exclues restent au dénominateur. L’historique des autres films et les métadonnées des films évalués sont conservés.
3. Chaque échantillon utilise Surprends-moi sans filtre. Le rang de base couvre les candidats éligibles après historique. Le rang final ne couvre que les places proposées. Recall@5 divise le nombre de cibles proposées par le nombre de cibles du tirage. NDCG@5 attribue une pertinence binaire de 1 aux cibles et 0 aux autres candidats, avec décote logarithmique par position. Les agrégats sont des moyennes non pondérées des échantillons. Sans cible, les agrégats sont absents (`null`).
4. Les autres films susceptibles de plaire sont souvent sans étiquette, et des signaux plus récents que le visionnage évalué peuvent rester dans l’apprentissage. Le protocole teste la récupération de films appréciés connus dans un catalogue fixe. Il ne mesure pas la précision réelle, la satisfaction future ni la capacité de découverte en ligne.

## Comparer deux versions

Le rapport porte `formatVersion: 2` et la version du moteur. Son empreinte SHA-256 couvre le catalogue, les métadonnées, les évaluations et favoris normalisés, les critères, l’historique dédupliqué la configuration du holdout et la date UTC de référence. L’ordre des tableaux significatifs est conservé. La version du moteur et la politique évaluée sont indiquées séparément. Les rapports de format 1 restent consultables dans les archives. Une comparaison est refusée si le format ou l’empreinte diffère. Lancer `--compare-policy` pour évaluer le chemin historique 1.1.0 et la politique actuelle sur un seul instantané. Pour comparer ensuite les rapports de format 2 avec `--baseline`, repasser la date de référence enregistrée dans le rapport de référence.

Le fichier [production-v1.1.0.json](production-v1.1.0.json) a été obtenu avec le moteur de `main` avant instrumentation (`fea99c8`). Les lectures ajoutées à cette version ont enregistré les scores de base et les valeurs déjà calculées par le comparateur de chaque emplacement. Les tests comparent ce relevé aux traces actuelles, ainsi qu’aux sorties de production.
