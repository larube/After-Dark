# Historique de la calibration à l’aveugle

Le protocole `discovery-calibration-blind-v2` conserve ses questionnaires dans
`~/.after-dark/calibration-history.json`. L’option `--history` permet de choisir
un fichier privé par profil. Les votes sur la fixture utilisent par défaut
`~/.after-dark/calibration-fixture-history.json`. Les identifiants de films
appartiennent au catalogue After Dark utilisé pour la séance. Utiliser le même
historique avec les instantanés successifs de ce catalogue et un fichier
distinct pour une autre base ou pour la fixture.

```sh
npm run calibrate:affinity -- --import-results /chemin/prive/bilan-1.json --import-results /chemin/prive/bilan-2.json
npm run calibrate:affinity -- --sqlite /chemin/prive/after-dark.sqlite --date 2026-11-23 --blind affinities --seed calibration-3
npm run calibrate:affinity -- --results
npm run calibrate:affinity -- --history ~/.after-dark/calibration-fixture-history.json --results
```

Chaque ancien bilan JSON doit contenir l’objet émis par le script. Si la
sortie a été redirigée via npm, retirer son en-tête texte ou utiliser
`npm run --silent` lors des prochains exports. L’import est idempotent par
empreinte d’expérience et mode. Les anciens bilans conservent leur version
et leur date de référence. Leur heure de lancement et leur empreinte de
catalogue séparée restent inconnues.

Une séance terminée affiche son bilan JSON et conserve une copie atomique
dans l’historique. Chaque carte et réponse sont enregistrées au fil de la
séance. En cas d’abandon avec `q`, de fermeture de l’entrée ou de signal
d’interruption, les réponses partielles restent privées et sont exclues
des résultats cumulés et de la rotation. Le terminal ne révèle les bras
qu’après le dernier vote. Le fichier d’historique contient l’attribution
et doit rester fermé pendant le questionnaire. L’historique est créé avec
des permissions locales restreintes. Garder les bilans et historiques
hors du dépôt. Après un arrêt forcé qui empêche le nettoyage, retirer le
répertoire vide `calibration-history.json.lock` à côté du fichier, uniquement
après avoir vérifié qu’aucun questionnaire ou import ne tourne encore.

## Sélection et couverture

Les quatre bras utilisent le même instantané, les mêmes critères, la même
date, les exclusions du profil et le filtre de qualité existant. Le calcul
des statistiques et des affinités utilise les mêmes données qu’auparavant.
Avant la diversification, les quatre bras écartent tous les identifiants
présentés dans une séance terminée ou importée, même dans un autre mode.
Les titres homonymes ne sont pas rapprochés automatiquement.

Chaque bras peut chercher des remplaçants dans **tout le catalogue admissible**
avant de construire sa liste de huit. Il conserve le premier niveau de
qualité déjà défini par le mode et ce bras. Dans « Vos affinités », cela exige
un fit supérieur à 0,08 et un trait positif au-dessus de 0,08. Dans « Les
pépites », le fit doit être au moins nul. Dans « Hors piste », le mode admet
les candidats dont le fit est au moins de −1. Cette règle réutilise les
seuils existants. Elle peut épuiser un bras plus tôt, notamment quand le
profil a peu de signaux. Élargir la liste au-delà de huit ne résout pas un
appariement incomplet ici. Avec quatre bras, un conflit bloquant implique
un sous-ensemble dont l’union contient au plus trois films et dont les
listes sont déjà épuisées.

L’appariement maximise la couverture, puis minimise les répétitions des
explorations récentes et la somme des rangs. La graine départage les
attributions et fixe l’ordre de présentation. Une collision compte un
film présent dans plusieurs listes. Le bilan indique les tailles des
listes, les collisions et la couverture. En dessous de quatre bras
distincts, le terminal indique la couverture possible et ne lance pas de
vote. Un nouveau catalogue, une nouvelle graine ou de nouveaux signaux
peuvent changer une attribution, mais l’historique empêche la présentation
répétée des films des séances terminées.

## Lecture des résultats

`--results` regroupe les réponses par protocole, mode et bras. Les « Déjà
vu » sont distincts des « Pas intéressé ». Pour calculer une part d’intérêt,
on peut compter « Très envie de voir » et « Pourquoi pas » parmi les films
évalués comme inconnus du spectateur. Réponses ordinales, collisions, rangs
variables et films retirés de séance en séance limitent la comparabilité.
Deux bilans historiques peuvent contenir le même film sous deux bras.
Les deux réponses sont conservées, mais ne sont pas des observations
indépendantes. Les résultats explorent l’intérêt déclaré et ne mesurent
ni le plaisir après visionnage ni une supériorité statistique.

Un vote « Déjà vu » reste dans l’historique d’expérience. La synchronisation
se fait actuellement via l’action « Déjà vu » de Ma collection. Une
intégration future devrait présenter chaque film associé par son identifiant
et demander une confirmation explicite avant d’appeler la gestion existante
des statuts. Les notes, le Laboratoire et le catalogue de production ne
sont jamais écrits par le questionnaire.
