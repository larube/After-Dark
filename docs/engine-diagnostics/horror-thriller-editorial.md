# Cohérence éditoriale Horreur et Thriller

## Audit

Les stratégies `baseline` et `profile` reprennent les filtres Discover TMDB Horreur (27) et Thriller (53). Dans la version 1.6.0, le même genre, reconnu par ID ou par libellé, validait le filtre local. Un film pouvait donc entrer dans Horreur avec le double marquage Horreur et Familial. Le classement personnalisé et la composition intervenaient ensuite, après les filtres de contenu, les contraintes et les exclusions personnelles.

Les deux Scooby-Doo de référence portent les genres Animation, Familial, Mystère et Horreur. *Sur l’île aux zombies* a les mots-clés `cartoon` et `cartoon dog`. *Joyeux Halloween* a `talking dog`. En revanche, *Vampire Hunter D: Bloodlust* et *Unicorn Wars* portent `adult animation`. [Scooby-Doo sur l’île aux zombies](https://www.themoviedb.org/movie/13151) · [Joyeux Halloween](https://www.themoviedb.org/movie/721656) · [Vampire Hunter D](https://www.themoviedb.org/movie/15999) · [Unicorn Wars](https://www.themoviedb.org/movie/587092)

*Perfect Blue* est un Thriller d’animation selon TMDB et possède également le mot-clé `psychological horror`. *Cure* possède les genres Horreur, Mystère et Crime et les mots-clés `psychological thriller` et `psychological horror`. *Prisoners* porte le genre Thriller. *The Witch* et *Evil Dead 2* portent le genre Horreur. La date de sortie principale TMDB peut différer de l’année de festival conservée dans le profil. Les fixtures identifient les films par ID TMDB. [Perfect Blue](https://www.themoviedb.org/movie/10494) · [Cure](https://www.themoviedb.org/movie/36095) · [Prisoners](https://www.themoviedb.org/movie/146233) · [The Witch](https://www.themoviedb.org/movie/310131) · [Evil Dead 2](https://www.themoviedb.org/movie/765)

Sur l’instantané local audité, 842 fiches sur 1 432 ont des événements de sortie, et aucune certification d’âge n’est stockée. TMDB fournit des certifications par pays et événement via la réponse de dates de sortie déjà demandée. Les valeurs sont parfois absentes, multiples ou variables selon le pays. Les deux Scooby-Doo ont par exemple `TP` en France et `PG` au Royaume-Uni. *The Witch* a plusieurs valeurs en France. Les certifications ont aidé à vérifier les cas de référence. La décision de production fonctionne avec les champs déjà stockés. [Documentation TMDB des dates de sortie et certifications](https://developer.themoviedb.org/reference/movie-release-dates)

## Politique 1.7.0

- **Horreur.** Le genre Horreur reste requis. Le motif `familyHorror` est déclenché par le genre Familial et au moins un marqueur jeunesse distinct parmi `cartoon`, `cartoon dog`, `talking dog` et `horror for children`. Le marqueur explicite `adult animation` neutralise cette exclusion en cas de signaux contradictoires. Des mots-clés de décor tels que `zombie` ou `haunted house` peuvent figurer dans des films familiaux et des films d’horreur adulte.
- **Thriller.** Le genre Thriller suffit. En l’absence de ce genre, le mot-clé précis `psychological thriller` doit être corroboré par le genre Crime ou Mystère. Un film peut donc correspondre aux deux catégories. Les genres d’origine restent en base.
- Un film au genre Horreur renseigné peut rester admissible lorsque les autres données sont trop pauvres pour établir une orientation jeunesse. Les films sans genre restent hors des catégories strictes. Les règles utilisent les mêmes champs normalisés et bruts dans les deux stratégies. Les filtres Discover, la fréquence des appels, l’affinité et l’ordre de départage suivent le parcours existant.

Cette approche privilégie la précision de l’exclusion. Certains films familiaux restent ambigus avec les champs disponibles. Ajouter des marqueurs nécessite des exemples comparés et une mesure sur le vivier. Les anciens diagnostics de Sélection se rejouent avec la politique de genre de leur version.

## Reproduire la comparaison sur une copie en lecture seule

```sh
npm run diagnose:selection -- \
  --sqlite "$HOME/Library/Application Support/After Dark/after-dark.sqlite" \
  --date 2026-11-27 --output "$(mktemp -d)" --genre-editorial
```

Le rapport local Markdown et JSON compare le moteur 1.6.0 et la nouvelle admissibilité sur le même instantané, à catalogue fixe. Il indique les titres entrants et sortants, les motifs, les longs métrages d’animation admissibles et trois sélections successives. La simulation avance la rotation à partir des 30 entrées existantes. Une liste courte reflète le vivier local à ce stade. Les acquisitions futures et l’appréciation subjective ne sont pas mesurées.

Sur l’instantané de validation, Horreur passe de 18 à 17 admissibles avant rotation et de 10 à 9 après rotation. *Joyeux Halloween, Scooby-Doo !* sort de la première sélection. Deux œuvres d’animation restent admissibles. Thriller passe de 47 à 48 admissibles avant rotation avec l’entrée de *Cure*. Le vivier après rotation reste à 40.

La première séance Horreur passe de dix à neuf propositions. Les deux séances suivantes, simulées à catalogue fixe, sont épuisées avec les deux politiques. Thriller conserve dix films à chacune des trois séances.
