# Comparer les affinités sur une séance « Ce soir »

Le comparateur utilise une capture de séance et une copie temporaire en lecture seule du catalogue SQLite, WAL compris. Il reprend la date UTC, les critères, les préférences de séance et l’historique de rotation antérieur à cette séance. Les statuts, refus, franchises et signaux proviennent de la copie SQLite. Toutes les variantes travaillent sur cette même copie, sans requête réseau. Le résultat indique si le catalogue a évolué depuis la capture et si chaque sélection reproduit ses identifiants. Pour une reproduction exacte, conserver une copie cohérente de la base au moment de la capture.

```sh
npm run --silent diagnose:tonight-affinity -- \
  --sqlite "/chemin/vers/after-dark.sqlite" \
  --capture "/chemin/vers/tonight.json"
```

La commande affiche les titres sélectionnés et le top 35 dans le terminal uniquement sur demande explicite. Éviter de publier ce résultat, qui contient des informations liées aux goûts du profil. Elle compare `current`, `normalized`, `rarity` et `hybrid` avec le même classement de pertinence 1.4.0, puis teste le modèle `personal` avec les deux pondérations de réputation. Le top 35 est calculé par score de base avant la composition de la sélection. La part de contribution est calculée selon la valeur absolue des contributions. Un mot-clé est compté comme fréquent s’il apparaît dans au moins 5 % du catalogue. La comparaison sans réputation masque les votes de tous les candidats tout en conservant les mêmes autres métadonnées et signaux.

## Correction retenue dans « Ce soir » 1.5.0

Le modèle `personal` reprend le lissage et la pondération par fréquence de `hybrid`. Pour les mots-clés, la contribution est divisée par le nombre de traits au-delà du budget existant de trois, au lieu de sa racine carrée. Les traits présents sur un seul film source apportent la moitié de leur contribution si elle est positive. Les contributions négatives conservent leur signe et ne subissent pas l’atténuation supplémentaire de `hybrid`. Le score final utilise une compression continue `4 × tanh(score brut / 4)` au lieu d’un plafonnement abrupt. Les autres modèles gardent leurs formules pour les comparaisons et le Laboratoire.

La réputation TMDB inconnue ou sans vote apporte zéro. Une réputation défavorable suffisamment documentée peut retirer des points. La bonification positive de la version précédente est multipliée par `1 − clamp(affinité, 0, 1)`. Elle reste entière sans affinité positive, diminue avec le signal personnel et s’annule à partir du seuil d’affinité de 1 déjà utilisé par le moteur. Le filtre d’admissibilité conserve l’échelle de réputation d’origine. Les votes peuvent donc encore rendre admissible un film faiblement renseigné du point de vue personnel. Ce compromis conserve le démarrage à froid.

La comparaison mesure la dispersion, la dépendance aux votes et le classement sur un catalogue donné. Elle ne vérifie ni les prérequis narratifs ni l’envie réelle de découvrir les films. Une couverture identique sous masquage sur un instantané ne garantit pas le même résultat sur chaque profil.
