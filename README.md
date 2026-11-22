# After Dark

After Dark est une application macOS personnelle pour importer et consulter son profil cinéma. Elle fonctionne hors ligne, avec une base SQLite locale. La première version affiche le catalogue, les films vus, les évaluations, les films explicitement non vus et quelques favoris spontanés. Elle prépare la persistance des séances et des critères du soir.

## Installation sur macOS

Prérequis : macOS 13 ou version ultérieure, Node.js 22 LTS (22.13 ou plus récent), npm 10 ou ultérieur et Git. Utilisez un Node natif pour votre Mac (`arm64` sur Apple Silicon, `x64` sur Intel). Le premier téléchargement des dépendances et le packaging requièrent une connexion.

```sh
git clone https://github.com/larube/After-Dark.git ~/Work/after-dark
cd ~/Work/after-dark
git switch codex/pr1-desktop-foundations  # tant que la PR est en revue
npm ci
```

Les versions exactes sont fixées dans `package-lock.json`. Les principales versions utilisées sont Electron 45.4.1, Forge 7.11.2, React 19.3.1, Vite 6.4.6, TypeScript 5.9.3, Tailwind CSS 4.3.5, libSQL local 0.17.4, Drizzle ORM 0.45.4, Drizzle Kit 0.31.11, Zod 4.6.7 et Vitest 3.2.7. La fenêtre utilise les éléments HTML natifs et Tailwind pour son interface minimale.

## Test manuel en développement

Depuis la racine, créez un dossier de données vide pour que l’exemple reste séparé de votre profil personnel. Conservez le même Terminal et la même valeur de la variable pour toutes les étapes de persistance.

```sh
export AFTER_DARK_USER_DATA="$(mktemp -d "${TMPDIR:-/tmp}/after-dark-manual.XXXXXX")"
printf 'Base de test : %s\n' "$AFTER_DARK_USER_DATA/after-dark.sqlite"
npm start
```

1. Vérifiez que la fenêtre **After Dark** affiche **Base locale prête**, quatre compteurs à zéro et aucun favori.
2. Cliquez sur **Importer un profil** et choisissez `examples/profile.v1.json` dans le checkout. Dans la boîte de dialogue macOS, `⌘⇧G` permet de saisir le dossier `~/Work/after-dark/examples`. Attendez **6 créées, 0 mises à jour, 0 inchangées, 0 ambiguïté, 0 erreur**.
3. Vérifiez les compteurs par libellé : **6 enregistrés**, **4 vus**, **4 évalués**, **1 explicitement non vu**. Le favori **Les Échos du large (film fictif)** doit apparaître.
4. Réimportez le même fichier. Le rapport doit indiquer **6 inchangées** et zéro création, mise à jour, ambiguïté ou erreur. Les compteurs restent identiques. Un clic sur **Annuler** dans la boîte de dialogue doit afficher **Import annulé**.
5. Quittez complètement avec **⌘Q**. Fermer la fenêtre avec le bouton rouge peut laisser le processus actif sous macOS. Quand le Terminal rend la main, lancez `ls -l "$AFTER_DARK_USER_DATA/after-dark.sqlite"`, puis relancez `npm start`. Les quatre valeurs et le favori doivent réapparaître dès l’ouverture, avant tout nouvel import. Le rapport d’import décrit la session de la fenêtre et redémarre vide.

## Test manuel de l’application packagée

Quittez l’application de développement avec **⌘Q**. Dans le même Terminal, laissez `AFTER_DARK_USER_DATA` tel quel pour vérifier que le paquet relit la base venant du développement.

```sh
npm run package
APP="$PWD/out/After Dark-darwin-$(node -p process.arch)/After Dark.app"
test -d "$APP"
"$APP/Contents/MacOS/After Dark"
```

1. Vérifiez **Base locale prête**, les mêmes quatre compteurs et le même favori. Le programme lancé depuis `Contents/MacOS` hérite du dossier de test exporté dans le Terminal. Le lancement par Finder utilise le dossier de données normal.
2. Quittez avec **⌘Q**, relancez `npm run package`, puis exécutez de nouveau `"$APP/Contents/MacOS/After Dark"`. Vérifiez que les valeurs ont survécu à la reconstruction. Quittez l’application.
3. Pour vérifier la migration depuis une base vierge dans le paquet lui-même, lancez-le avec un second dossier vide : `AFTER_DARK_USER_DATA="$(mktemp -d "${TMPDIR:-/tmp}/after-dark-package.XXXXXX")" "$APP/Contents/MacOS/After Dark"`. Les quatre compteurs doivent être à zéro. Importez à nouveau l’exemple et vérifiez que l’état se remplit. Aucun serveur de développement ne doit être en cours.
4. Après le test, utilisez `unset AFTER_DARK_USER_DATA` pour revenir au profil normal dans ce Terminal.

Le produit de Forge est une application locale de développement, sans signature Apple Developer ID ni notarisation. macOS peut bloquer une copie téléchargée ou transférée. Le build local depuis les sources est le parcours de vérification prévu. Le packaging cible l’architecture du Node qui exécute Forge.

## Architecture et migrations

- `src/main` possède la connexion SQLite, ouvre le sélecteur de fichier natif et autorise quatre canaux IPC. Il vérifie le document appelant, les arguments et les réponses.
- `src/preload` expose `summary()`, `importProfile()`, `enrichment()` et `recommend(criteria, allowRecent)` via `contextBridge` et valide leurs réponses. `src/renderer` utilise cette API avec React. Le renderer est isolé, sandboxé, sans Node.js, avec une CSP spécifique au développement et une CSP de production qui interdit les connexions réseau.
- `src/shared` contient les contrats Zod. `src/domain` contient les fonctions TypeScript pures. `src/db` contient les schémas et requêtes et `src/import` gère l’import. Le moteur pur vit dans `src/domain/recommendation.ts`. Le Main orchestre la découverte et le cache, le moteur applique les filtres et classe les candidats, puis une transaction enregistre la session, le rang, la version et les explications. La PR 2 réutilise les migrations et les tables existantes.
- Le Main ouvre `after-dark.sqlite` dans `app.getPath("userData")`. Les clés étrangères, le délai d’attente d’écriture et le journal WAL sont activés. Les migrations Drizzle s’appliquent au démarrage. Une base existante reste en place si une migration échoue.
- Après une modification de schéma, lancez `npm run db:generate -- --name=nom_de_la_migration`, relisez le SQL, puis versionnez `drizzle/` avec le schéma. Forge copie ce dossier dans `Contents/Resources/drizzle`. Forge place le binaire libSQL macOS précompilé hors d’ASAR. Le Main utilise exclusivement le client fichier de libSQL, avec l’adaptateur officiel de Drizzle. Le module natif utilise Node-API, dont l’ABI est stable entre versions de Node et d’Electron compatibles.

## Importer un profil

Cliquez sur **Importer un profil** et choisissez un fichier JSON v1. [L’exemple](examples/profile.v1.json) reprend seulement trois évaluations citées dans le brief et emploie des films fictifs pour illustrer les favoris et les statuts. Le dataset complet sera fourni séparément. Gardez-le localement en dehors du dépôt.

- Chaque entrée comporte un objet `movie` avec un `canonicalId` stable et un `displayTitle`. Ajoutez, quand ils sont connus, `originalTitle`, `year`, `tmdbId`, `externalIds` (par exemple `{"imdb":"…"}`), `aliases` et `metadata`. Identifiants cohérents ou variante de titre et année permettent le rapprochement. Un titre seul ne suffit pas. Pour Seven / Se7en, indiquez explicitement l’alias ou fournissez une identité commune.
- Une évaluation reçoit un couple `source` / `sourceId` stable et unique, avec une date `evaluatedOn` facultative au format `AAAA-MM-JJ`. Les formats sont `score` (entier JSON de 0 à 10), `historical_score` (texte tel que `"8,50"`), `historical_range` (bornes texte `min` et `max`) et `qualitative` (texte `appreciation`). Le texte historique conserve séparateur et précision. Les déceptions peuvent être des appréciations qualitatives. Fournissez un nouvel identifiant de provenance pour une évaluation distincte ou révisée.
- `status` est facultatif. `seen` désigne un film vu, `unseen` un film explicitement non vu, `unknown` une mention explicite d’incertitude. Toute évaluation valide établit que le film est vu, y compris une évaluation historique importée sans statut ou avec `unknown`. Si un import précédent indiquait `unseen`, l’import d’une évaluation fait passer le film à `seen`. Déclarer `unseen` avec une évaluation dans la même entrée, ou pour un film déjà évalué, est refusé. Une migration marque aussi comme vus les films déjà évalués dont le statut était inconnu ou absent.
- `favorites` est un tableau facultatif. Chaque objet a une `source` et les préférences connues `spontaneous`, `memorable` et `rewatch`, indépendantes. Les champs omis laissent la valeur existante intacte.
- Zod vérifie tout le document avant de modifier la base. Les entrées valides sont traitées en ordre dans une transaction. Une ambiguïté ou un conflit entraîne l’annulation de l’entrée concernée. Le rapport indique quelles entrées corriger. Une réimportation identique de données non contradictoires laisse le profil inchangé.

## Ce soir et configuration de TMDB

**Ce soir** est disponible dès le démarrage. Pour découvrir de nouveaux films, récupérez le **jeton d’accès en lecture API** dans [les paramètres développeur TMDB](https://www.themoviedb.org/settings/api). L’application lit `tmdb.json` dans le même dossier que la base, normalement `~/Library/Application Support/After Dark/`. Avec `AFTER_DARK_USER_DATA`, placez le fichier dans le dossier de test.

```json
{"tmdbReadToken":"REMPLACEZ_PAR_VOTRE_JETON_D_ACCES_EN_LECTURE"}
```

Gardez ce fichier hors du dépôt et limitez son accès avec `chmod 600`. La variable d’environnement `AFTER_DARK_TMDB_READ_TOKEN` est également lue par le Main et prend la priorité. Le fichier fonctionne aussi quand on lance le paquet depuis Finder. Le Main relit le jeton lorsque la découverte ou l’enrichissement en a besoin. Les évaluations, favoris et explications restent dans la base locale. Le Main envoie les filtres de découverte et peut rechercher les films importés par identifiant, titre ou variante. Pour rester entièrement local, utilisez l’application sans jeton.

### Enrichissement du profil

Au démarrage et après un import, After Dark enrichit progressivement les films importés en arrière-plan. L’écran indique combien sont enrichis, sans rapprochement certain ou encore en attente. Le résultat de chaque film est enregistré dans SQLite. Après réouverture, l’enrichissement reprend les films en attente. Un import identique ne relance pas les rapprochements incertains. Une correction de titre, d’alias, d’année ou d’identifiant remet le film concerné en attente.

Les recommandations restent disponibles pendant ce travail. Une recherche au premier plan est prioritaire et utilise les métadonnées déjà disponibles. L’enrichissement et la découverte partagent un espacement de 250 ms entre débuts de requête. En cas d’erreur réseau, la file est conservée et réessayée. TMDB peut imposer une pause via `Retry-After`.

Sans jeton ou en cas d’erreur réseau, de quota ou d’authentification, After Dark classe les films déjà enregistrés. Les affiches déjà téléchargées restent disponibles dans le dossier local `posters/`. Les films importés servent aussi de candidats s’ils restent à découvrir. Les entrées fictives du profil d’exemple sont écartées de « Ce soir ». L’application indique explicitement quand le profil est insuffisant pour personnaliser la sélection.

### Vérifier le parcours sur Mac

1. Si vous voulez préserver votre profil normal, lancez `npm start` avec `AFTER_DARK_USER_DATA` pointant vers un dossier temporaire absolu. Ouvrez **Ce soir**, choisissez une humeur et lancez la recherche. Sur une base vierge sans jeton, vérifiez que le catalogue vide est annoncé.
2. Ajoutez `tmdb.json` dans ce dossier, puis relancez la recherche. Vérifiez les titres, les métadonnées disponibles et les raisons de la sélection. Après l’import d’un profil, observez le compteur d’enrichissement, lancez une recommandation pendant le traitement, puis vérifiez que le compteur reprend après **⌘Q** et réouverture. Essayez **Autres propositions**. Avec un catalogue assez fourni, les résultats récents doivent disparaître de la nouvelle sélection.
3. Dans les filtres facultatifs, essayez `ES` en pays de production obligatoire puis `es` en langue originale obligatoire. Un film coproduit en Espagne satisfait le filtre `ES`. Vérifiez aussi une durée maximale et un jeu de contraintes sans correspondance. Une contrainte non satisfaite ne doit jamais être assouplie automatiquement.
4. Quittez avec **⌘Q**. Exécutez `npm run package`, puis lancez le binaire du paquet avec **le même dossier de données temporaire**, selon le parcours de packaging ci-dessus. Renommez temporairement `tmdb.json` et retirez la variable d’environnement si vous l’utilisiez. Les métadonnées et l’historique doivent encore servir aux propositions. Si le catalogue a été épuisé, utilisez **Revoir des propositions récentes**. Vérifiez que les affiches déjà téléchargées apparaissent encore.
5. Pour examiner le résultat avec votre profil réel, importez-le dans une autre base isolée. Testez plusieurs humeurs, avec et sans contraintes. Les exemples et les tests ci-dessous ne mesurent pas votre satisfaction personnelle.

### Découverte et classement

La découverte intercale trois recherches TMDB par demande. Elles combinent popularité, périodes de sortie tournantes et une sélection plafonnée en nombre de votes qui explore aussi sans filtre de genre. Les détails TMDB âgés de moins de 30 jours sont réutilisés. La provenance et la date d’actualisation sont stockées dans `movies.metadata.tmdb`. Les recherches sont bornées en volume et en durée par appel. Un HTTP 429 suspend les appels selon `Retry-After` ou pendant 60 secondes en l’absence de valeur exploitable. La déduplication utilise TMDB, IMDb, les titres connus et l’année selon les règles de l’import. Les titres originaux, localisés et alternatifs TMDB peuvent servir au rapprochement. Un décalage d’un an est accepté si TMDB documente l’année locale dans ses dates de première projection ou de sortie en salle. L’année du profil est préservée. Un titre voisin sans preuve suffisante, deux correspondances plausibles ou des identifiants contradictoires laissent le dossier sans rapprochement automatique.

- Les statuts vus, le plafond de durée et les pays et langues obligatoires sont traités avant le classement. Les indices d’une ambiance à éviter restent une préférence souple. Ils pénalisent le score à hauteur de 1,5 fois leur poids et figurent dans l’explication si le film est proposé. Pour plusieurs codes obligatoires dans un champ, un code correspondant suffit. Les filtres pays, langue et durée s’appliquent conjointement. Une durée, un pays ou une langue inconnus échouent au filtre obligatoire correspondant.
- L’affinité pèse 1,6 fois son score borné entre −4 et 4. Elle utilise les signaux par film et les traits partagés, pondérés à 2,5 pour la réalisation, 1,4 pour les mots-clés, 1 pour les genres et 0,7 pour le pays. Les notes numériques sont centrées sur 6. Une fourchette contribue par son milieu au classement seulement. Les valeurs historiques restent intactes. La table `qualitativeWeights` règle séparément les signaux qualitatifs. Les préférences spontanée, marquante et de revisionnage ajoutent respectivement 0,45, 0,25 et 0,2 au signal du film. L’absence d’évaluation n’ajoute aucun signal négatif.
- Le mood pèse 1,4 fois ses indices, avec jusqu’à 4 points d’indices combinés par genres et mots-clés. Le pays préféré ajoute 1,4 et la langue préférée 1,2. Une énergie faible favorise légèrement les séances de 100 minutes ou moins et pénalise celles de plus de 135 minutes. Une énergie élevée laisse la durée libre. Ces indices ne permettent pas d’établir la difficulté réelle d’un film.
- L’exploration favorise une popularité TMDB modérée à hauteur de 0,5, ou 1,5 en mode **Surprends-moi**. La sélection donne un bonus d’affinité au rôle **Valeur sûre**, d’exploration au rôle **Pépite**, et atténue l’avantage des profils familiers pour le **Wildcard**. La proximité des traits et la même langue pénalisent la répétition dans la sélection. Les 15 dernières propositions sont écartées par défaut. La liste peut compter moins de trois films si peu satisfont les critères.
- Les raisons citent les métadonnées et préférences qui ont contribué au choix. Le synopsis affiche au plus la première phrase courte disponible. TMDB fournit ce texte, dont le contenu ne peut pas garantir l’absence de spoiler. Les données manquantes sont fréquentes et les pondérations sont heuristiques.

### Comparaison par masquage

`evaluateHoldout(catalogue, signals, criteria, heldOut)` écarte tous les signaux des identifiants masqués avant le classement. Leurs films redeviennent candidats dans cette comparaison isolée. La fonction renvoie leur rang éventuel et les appréciations réelles pour comparer les choix, sans modifier le statut enregistré dans SQLite. Pour l’utiliser avec un profil complet, chargez une copie de la base avec `readCatalogue`, choisissez explicitement les identifiants à masquer et appelez la fonction avec des critères correspondant à la comparaison souhaitée. Le test Vitest vérifie le mécanisme sur des fixtures. Un petit échantillon permet seulement une lecture descriptive.

## Sauvegarder et restaurer SQLite

Le fichier normal est `~/Library/Application Support/After Dark/after-dark.sqlite`. Quittez complètement l’application avant de copier le fichier. Pour une sauvegarde à chaud, utilisez `sqlite3 "$HOME/Library/Application Support/After Dark/after-dark.sqlite" '.backup after-dark-backup.sqlite'`.

Pour vérifier une restauration, copiez le fichier sauvegardé dans un nouveau dossier sous le nom `after-dark.sqlite` puis lancez l’application avec `AFTER_DARK_USER_DATA` pointant sur ce dossier absolu. Conservez la base d’origine tant que le profil restauré n’a pas été vérifié.

## Vérifications et modules natifs

```sh
npm run lint
npm run typecheck
npm test
npm run build
npm run package
```

Vitest ouvre une base temporaire et applique les migrations. `build` compile les trois cibles Vite sans démarrer de fenêtre. `package` reconstruit les cibles avec Forge et crée le paquet macOS.

Le pilote libSQL fournit des binaires précompilés Apple Silicon et Intel via les dépendances facultatives de npm. Si le chargement du binaire échoue, vérifiez `node -p process.arch` et lancez `npm ci --include=optional` avec un Node de l’architecture voulue. Si Electron n’a pas encore téléchargé son binaire, lancez `npm exec -- install-electron` avec une connexion.

Pour mettre Electron à jour, utilisez `npm install -D --save-exact electron@latest`, puis relancez le lint, TypeScript, les tests, le build et les deux parcours macOS. Gardez le même dossier temporaire avant et après le changement de version afin de vérifier la compatibilité de la base.
