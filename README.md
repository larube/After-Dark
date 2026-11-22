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
3. Vérifiez les compteurs par libellé : **6 enregistrés**, **1 vu**, **4 évalués**, **1 explicitement non vu**. Le favori **Les Échos du large (film fictif)** doit apparaître.
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

- `src/main` possède la connexion SQLite, ouvre le sélecteur de fichier natif et autorise deux canaux IPC. Il vérifie le document appelant, les arguments et les réponses.
- `src/preload` expose uniquement `summary()` et `importProfile()` via `contextBridge` et valide leurs réponses. `src/renderer` utilise cette API avec React. Le renderer est isolé, sandboxé, sans Node.js, avec une CSP spécifique au développement et une CSP de production qui interdit les connexions réseau.
- `src/shared` contient les contrats Zod. `src/domain` contient les fonctions TypeScript pures. `src/db` contient les schémas et requêtes et `src/import` gère l’import. Le futur moteur peut vivre dans `src/domain` sans dépendre d’Electron ou de SQLite.
- Le Main ouvre `after-dark.sqlite` dans `app.getPath("userData")`. Les clés étrangères, le délai d’attente d’écriture et le journal WAL sont activés. Les migrations Drizzle s’appliquent au démarrage. Une base existante reste en place si une migration échoue.
- Après une modification de schéma, lancez `npm run db:generate -- --name=nom_de_la_migration`, relisez le SQL, puis versionnez `drizzle/` avec le schéma. Forge copie ce dossier dans `Contents/Resources/drizzle`. Forge place le binaire libSQL macOS précompilé hors d’ASAR. Le Main utilise exclusivement le client fichier de libSQL, avec l’adaptateur officiel de Drizzle. Le module natif utilise Node-API, dont l’ABI est stable entre versions de Node et d’Electron compatibles.

## Importer un profil

Cliquez sur **Importer un profil** et choisissez un fichier JSON v1. [L’exemple](examples/profile.v1.json) reprend seulement trois évaluations citées dans le brief et emploie des films fictifs pour illustrer les favoris et les statuts. Le dataset complet sera fourni séparément. Gardez-le localement en dehors du dépôt.

- Chaque entrée comporte un objet `movie` avec un `canonicalId` stable et un `displayTitle`. Ajoutez, quand ils sont connus, `originalTitle`, `year`, `tmdbId`, `externalIds` (par exemple `{"imdb":"…"}`), `aliases` et `metadata`. Identifiants cohérents ou variante de titre et année permettent le rapprochement. Un titre seul ne suffit pas. Pour Seven / Se7en, indiquez explicitement l’alias ou fournissez une identité commune.
- Une évaluation reçoit un couple `source` / `sourceId` stable et unique, avec une date `evaluatedOn` facultative au format `AAAA-MM-JJ`. Les formats sont `score` (entier JSON de 0 à 10), `historical_score` (texte tel que `"8,50"`), `historical_range` (bornes texte `min` et `max`) et `qualitative` (texte `appreciation`). Le texte historique conserve séparateur et précision. Les déceptions peuvent être des appréciations qualitatives. Fournissez un nouvel identifiant de provenance pour une évaluation distincte ou révisée.
- `status` est facultatif. `seen` désigne un film vu, `unseen` un film explicitement non vu, `unknown` une mention explicite d’incertitude. Une évaluation seule laisse le statut tel quel. Un film explicitement non vu ne peut recevoir d’évaluation que si son statut est corrigé vers `seen` dans la même entrée.
- `favorites` est un tableau facultatif. Chaque objet a une `source` et les préférences connues `spontaneous`, `memorable` et `rewatch`, indépendantes. Les champs omis laissent la valeur existante intacte.
- Zod vérifie tout le document avant de modifier la base. Les entrées valides sont traitées en ordre dans une transaction. Une ambiguïté ou un conflit entraîne l’annulation de l’entrée concernée. Le rapport indique quelles entrées corriger. Une réimportation identique de données non contradictoires laisse le profil inchangé.

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
