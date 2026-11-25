# Calibration éditoriale · PR27

Depuis le dépôt, lancez la commande sur une base locale et vers un nouveau dossier hors du dépôt.

```sh
npm run diagnose:selection -- --editorial \
  --sqlite "$HOME/Library/Application Support/After Dark/after-dark.sqlite" \
  --date 2026-11-25 \
  --output "$HOME/after-dark-calibration-pr27"
```

Les sorties privées `editorial-calibration.md` et `editorial-calibration.json` contiennent les variantes, les titres et la provenance des signaux d’affinité. Ne les partagez pas sans vérifier leur contenu. La commande réutilise le snapshot SQLite en lecture seule et la validation de destination PR26. Toutes les simulations utilisent le même instantané et ne contactent pas TMDB. Pour reproduire un rapport ultérieurement, réutilisez le même état de la base et du WAL, la même date et, si utilisé, le même JSON `--criteria`.

## Protocole

Le mode PR27 utilise explicitement la politique 1.5.0 comme référence historique. Les variantes expérimentales sont passées à `diagnoseRecommendation`. Depuis la PR28, deux variantes servent aussi de politique par défaut du moteur 1.6.0.

### Cultes

Chaque politique de période est comparée avec 100 %, 75 %, 50 % et 25 % du bonus éditorial de réputation. La réputation standard et la règle d’admissibilité éditoriale restent fixes.

| Politique | Affinité minimale et quota avant 1970 | Pénalité de période | Répétition de décennie |
| --- | --- | ---: | ---: |
| current | Production | −0,8 | −0,35 |
| admit | Levés | −0,8 | −0,35 |
| half | Levés | −0,4 | −0,35 |
| none | Levés | 0 | −0,35 |
| no-decade | Levés | 0 | 0 |

La contribution standard est la réputation ajustée multipliée par `0,65 × (1 − clamp(affinité, 0, 1))` lorsqu’elle est positive. La contribution éditoriale actuelle est la réputation ajustée entière. Elles peuvent donc cumuler surtout pour les affinités faibles. Le rapport les expose séparément.

### Pépites

Les seuils 1, 0,9, 0,8 et 0,7 sont comparés à l’absence de seuil éditorial, avec et sans doublement du terme d’affinité pour le classement. Ce dernier est un test de sensibilité. Le seuil général de pertinence continue de décider de l’admissibilité sur les contributions d’origine. Les conditions d’exposition et de réputation restent identiques.

La sélection suivante simulée ajoute les titres proposés à l’historique, tronque à 30 entrées puis déduplique. Elle mesure la capacité immédiate du vivier local, à catalogue, critères et signaux fixes. Les recoupements sont mesurés contre les autres catégories de production, avec et sans rotation.

## Lecture de l’affinité

Les titres demandés servent uniquement à retrouver les fiches à inspecter. Les homonymes restent distincts. Les preuves proviennent des caractéristiques présentes localement, des statistiques de fréquence du catalogue et des valeurs d’apprentissage calculées par le moteur pour les films sources. Le rapport sépare le rang éditorial, les exclusions et le score d’affinité. Il ne valide pas l’exactitude des mots-clés ni l’indépendance de traits proches comme `friends` et `friendship`.

Une différence sur quelques films peut découler de l’accumulation de traits proches, d’un étiquetage asymétrique ou d’un vivier trop étroit. La distinguer d’une préférence générale demande plusieurs instantanés et des jugements d’intérêt à l’aveugle. Les variantes restent expérimentales.

## Production et rejeu historique · PR28

La configuration 1.6.0 applique `admit / 25 %` à Cultes et le seuil 0,8 à Pépites. Les autres paramètres restent identiques. Le rollback consiste à restaurer `productionEditorialPolicy` à partir de `previousEditorialPolicy` et à versionner le changement. Les captures 1.5.0 se rejouent avec la politique historique. Les historiques existants gardent leur version enregistrée.

Pour comparer la politique historique et la production sur un seul instantané, remplacez `--editorial` par `--editorial-production` et choisissez un nouveau dossier privé. Le rapport contient les listes et contributions avant/après, avec et sans rotation, ainsi qu’au tour suivant. Il inclut un contrôle avec les variantes retenues de PR27.

Sur le profil réel, la nouvelle production a reproduit les résultats archivés des deux variantes. Ce contrôle porte sur le classement et la rotation, à catalogue local fixe. La validation de l’intérêt des titres en usage reste ouverte.
