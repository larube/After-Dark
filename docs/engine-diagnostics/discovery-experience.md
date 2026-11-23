# Découvertes et questionnaires à l’aveugle

## Audit

Le client TMDB tronquait son aperçu dès la première phrase complète. Les anciennes fiches n’ont donc généralement qu’un extrait, même lorsque TMDB disposait d’un synopsis plus long. La disponibilité des crédits et des autres métadonnées dépend aussi de l’enrichissement de la fiche.

Le cache ne conservait pas `belongs_to_collection`. Ce champ peut être absent ou nul et décrit une collection TMDB. Une franchise éditoriale peut traverser plusieurs collections, partager une collection avec d’autres œuvres ou contenir un film isolé. Un titre, un mot-clé, la langue et les pays de production n’établissent pas une appartenance. [Détails TMDB d’un film](https://developer.themoviedb.org/reference/movie-details) · [Détails d’une collection](https://developer.themoviedb.org/reference/collection-details)

## Questionnaire

```sh
npm run calibrate:affinity -- --blind gems --sqlite /chemin/after-dark.sqlite --date 2026-11-23 --seed calibration-3
```

Le questionnaire affiche les crédits et les pays de production renseignés, un extrait court de l’aperçu local et une recherche Allociné au titre seul. L’année reste affichée pour distinguer les homonymes. La touche `s` affiche le texte intégral disponible, avec un avertissement sur l’intrigue. Les textes affichés viennent des métadonnées. Un extrait peut rester insuffisant pour juger le film et une fiche ancienne peut ne pas disposer du texte intégral.

Avec `--enrich-cards`, le client TMDB existant demande les détails des seules propositions déjà sélectionnées pour lesquelles un identifiant est connu et le synopsis complet manque, soit quatre requêtes de détails au maximum. Il s’arrête au premier échec réseau et conserve les données locales. Les détails reçus servent uniquement à l’affichage. La sélection est établie avant cette étape et la base SQLite reste en lecture seule. Pour reproduire exactement ce que le spectateur a lu, utiliser le même instantané de fiches et rester hors ligne, car les textes TMDB peuvent changer.

Le protocole `discovery-calibration-blind-v3` ajoute **Pas assez d’informations pour me décider**. Les bilans v1/v2 restent importables avec leurs libellés d’origine. `--results` compte séparément les cinq réponses et donne un nombre de votes évaluables qui exclut « Déjà vu » et le manque d’informations. Toute proposition d’une séance terminée compte dans l’historique anti-répétition, même si la réponse est non évaluable. Les statistiques restent exploratoires et sont groupées par protocole et par mode. L’attribution des films et le faible nombre de votes limitent les comparaisons entre bras.

[Exemple du terminal](questionnaire-terminal.txt)

## Exclusions de franchise

Depuis une recommandation, ouvrir **Franchise** puis choisir **Exclure la franchise**. Si aucune appartenance n’est connue, l’interface le signale. La vérification sur TMDB peut mettre à jour une ancienne fiche identifiée. **Ma collection → Franchises exclues** affiche les films identifiés dans le catalogue local et permet de réautoriser une franchise. Harry Potter et Godzilla y sont proposés comme choix explicites et restent autorisés au départ.

La migration SQLite ajoute une table pour les préférences locales. Le cache des films conserve l’identifiant et le libellé TMDB de la collection ou la valeur nulle déclarée. Le registre des franchises peut associer plusieurs collections et des identifiants de films distincts. Harry Potter couvre la série principale. Godzilla couvre les collections Shōwa, Heisei, Millennium et animée, ainsi que des titres isolés et des crossovers identifiés individuellement. Par exemple, le MonsterVerse entier ne sert pas de critère pour Godzilla, car il contient aussi des films centrés sur Kong. [Collection Harry Potter](https://www.themoviedb.org/collection/1241) · [Registre des collections Godzilla de Kometa](https://metamanager.wiki/en/nightly/defaults/movie/franchise/) · [Shin Godzilla](https://www.themoviedb.org/movie/315011)

Les exclusions retirent les films admissibles des nouvelles sélections Ce soir et Laboratoire et des trois modes Découvertes. Les quatre bras de calibration partagent le même ensemble d’exclusions, inclus dans l’empreinte de l’expérience. Découvertes masque aussi les films désormais exclus lors de la lecture d’une ancienne exploration. Les explorations enregistrées, questionnaires en cours et résultats historiques restent consultables selon leur parcours habituel. Les notes et les signaux d’affinité restent utilisables. Une franchise sans collection connue ni identifiant de film répertorié peut encore apparaître.

## Validation

- Lint, typecheck, 155 tests, build et packaging Electron macOS arm64.
- Parcours Electron hors ligne sur un catalogue de validation de 23 films comprenant des titres réels et des fiches fictives. Exclusion depuis une fiche, retrait des cartes, redémarrage, réautorisation et conservation des notes.
- Questionnaire interactif sur le même catalogue isolé. Vérification de l’affichage aveugle, de la lecture du synopsis sur demande, de l’exclusion commune et du bilan v3.

[Franchise depuis une fiche, 780 px](../screenshots/pr20/franchise-fiche-780.jpg) · [Ma collection, 520 px](../screenshots/pr20/franchises-collection-520.jpg)
