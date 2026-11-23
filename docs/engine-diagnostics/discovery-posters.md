# Affiches de Découvertes et accès Allociné

## Audit des affiches

La lecture locale des trois dernières explorations a trouvé 24 propositions. Toutes avaient un chemin d’affiche exploitable. Neuf fichiers JPEG étaient présents dans le cache et quinze étaient absents. Ce relevé mesure l’état du disque. Il ne permet pas de distinguer une requête jamais lancée d’un téléchargement qui a échoué.

Dans une fixture Electron, l’affiche d’un film de la sélection a été ajoutée au catalogue pendant que Découvertes était ouvert. Le build avant correction gardait le placeholder après l’écriture. Le chargement progressif dépendait de la sélection et du mode, sans tenir compte du signal d’enrichissement que l’application interroge déjà. Le build corrigé recharge les affiches encore manquantes lorsque le nombre de fiches enrichies change.

| Situation | Comportement |
| --- | --- |
| Aucun identifiant TMDB vérifié et aucun chemin local | Placeholder. Le chargement d’affiches n’effectue pas de recherche par titre. |
| Identifiant TMDB connu, chemin absent | Le client TMDB recherche le chemin par identifiant exact. Une réponse sans chemin est mise en cache pendant 24 heures. |
| Chemin connu, fichier absent | Le CDN fournit l’image si elle est disponible. Le chargeur existant limite les téléchargements à deux et déduplique les demandes. Les erreurs courantes temporisent les nouvelles tentatives. Le délai indiqué par un HTTP 429 est respecté. |
| Fichier incomplet ou illisible | Le diagnostic signale `invalid_file`. Hors ligne, le placeholder reste visible. En ligne, une copie valide remplace le fichier par renommage atomique. Si Electron ne peut toujours pas décoder l’image, la carte affiche le placeholder. |
| Métadonnées ajoutées après ouverture | Les affiches manquantes sont relues à partir du catalogue et du cache. Les images déjà chargées restent visibles. Le mode et la sélection persistent, sans nouvelle exploration. |

Un changement de mode ou une reconnexion signalée par Electron permet aussi de relancer la lecture. Une erreur temporaire peut laisser un placeholder jusqu’à un nouveau passage sur la page, une reconnexion ou un nouvel enrichissement. Un chemin disponible et un fichier absent ne prouvent pas qu’une affiche soit accessible au moment du diagnostic.

## Accès Allociné

Le bouton envoie uniquement le titre et l’année au processus principal. Le catalogue n’expose aucun identifiant Allociné vérifié pour construire une fiche directe. Le processus principal encode le titre et, lorsqu’elle est plausible, l’année dans la recherche de films Allociné. Il vérifie l’origine HTTPS et le chemin exact avant d’ouvrir le navigateur système. L’utilisateur peut choisir le bon résultat lorsque plusieurs films portent le même titre. Le bouton apparaît dans Découvertes, Ce soir, Ma collection et sur la proposition du Laboratoire. [Recherche de films Allociné](https://www.allocine.fr/rechercher/movie/?q=Alien)

## Captures Electron

Les captures utilisent la même fixture pour le cas d’enrichissement. Elles proviennent de l’application macOS packagée.

- [Découvertes avant enrichissement visible](../screenshots/pr16/discovery-avant-780.jpg)
- [Découvertes après enrichissement, 780 px](../screenshots/pr16/discovery-apres-780.jpg)
- [Découvertes après enrichissement, 410 px](../screenshots/pr16/discovery-apres-410.jpg)
- [Vedette de Ce soir](../screenshots/pr16/discovery-ce-soir-780.jpg)
- [Proposition du Laboratoire](../screenshots/pr16/discovery-laboratoire-780.jpg)
